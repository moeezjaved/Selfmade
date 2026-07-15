/**
 * Team management — list members + pending invites, invite by email, remove members / revoke invites.
 * One shared org per user. Invite/remove gated to owner|admin. Seat-limited by the owner's plan.
 * Stage 1: returns a join link per invite (email delivery + paid overage come in Stage 2).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getUserOrg, getSeatInfo, canManage, orgAdAccounts, type Role } from '@/lib/org'
import { sendEmail, emailEnabled } from '@/lib/email'
import { randomBytes } from 'crypto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

async function ctx() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient() as any
  const org = await getUserOrg(admin, user.id)
  return { user, admin, org }
}

export async function GET() {
  const c = await ctx(); if (!c) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { admin, org } = c
  const { data: members } = await admin.from('org_members').select('id, user_id, role, created_at').eq('org_id', org.orgId).order('created_at')
  // resolve emails (small teams → per-user lookup is fine)
  const withEmail = await Promise.all((members || []).map(async (m: any) => {
    let email = m.user_id
    try { const { data } = await admin.auth.admin.getUserById(m.user_id); email = data?.user?.email || m.user_id } catch {}
    return { id: m.id, user_id: m.user_id, role: m.role, email, isYou: m.user_id === c.user.id }
  }))
  const { data: invites } = await admin.from('org_invites').select('id, email, role, token, created_at').eq('org_id', org.orgId).eq('status', 'pending').order('created_at', { ascending: false })
  const seats = await getSeatInfo(admin, org.orgId, org.ownerId)

  // Ad-account scoping: the org's shared account pool + each member's assignment (empty = all).
  const accountPool = await orgAdAccounts(admin, org.orgId)
  const { data: assignRows } = await admin.from('org_member_ad_accounts').select('user_id, account_id').eq('org_id', org.orgId)
  const byUser = new Map<string, string[]>()
  for (const r of (assignRows || []) as any[]) { const a = byUser.get(r.user_id) || []; a.push(r.account_id); byUser.set(r.user_id, a) }
  const membersWithAccounts = withEmail.map((m: any) => {
    const assigned = byUser.get(m.user_id) || []
    // owner/admin always see all; a member with no rows = all (default-all)
    const all = m.role === 'owner' || m.role === 'admin' || assigned.length === 0
    return { ...m, accounts: all ? null : assigned, allAccounts: all }
  })

  const site = (process.env.NEXT_PUBLIC_APP_URL || 'https://tryselfmade.ai').replace(/\/$/, '')
  return NextResponse.json({
    org: { id: org.orgId, name: org.name, role: org.role },
    members: membersWithAccounts,
    invites: (invites || []).map((i: any) => ({ ...i, link: `${site}/join?token=${i.token}` })),
    seats,
    accountPool,   // [{ account_id, account_name }] — the org's connected Meta accounts
  })
}

export async function POST(request: NextRequest) {
  const c = await ctx(); if (!c) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { admin, org, user } = c
  if (!canManage(org.role)) return NextResponse.json({ error: 'Only an owner or admin can invite.' }, { status: 403 })
  const { email, role } = await request.json().catch(() => ({}))
  const em = String(email || '').trim().toLowerCase()
  if (!em || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return NextResponse.json({ error: 'Valid email required' }, { status: 400 })
  const r: Role = role === 'admin' ? 'admin' : 'member'
  const seats = await getSeatInfo(admin, org.orgId, org.ownerId)
  if (seats.used >= seats.limit) return NextResponse.json({ error: `Seat limit reached (${seats.limit}). Upgrade or remove a member to add more.`, upsell: true }, { status: 402 })
  const token = 'inv_' + randomBytes(20).toString('hex')
  const { data, error } = await admin.from('org_invites').insert({ org_id: org.orgId, email: em, role: r, token, invited_by: user.id }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const site = (process.env.NEXT_PUBLIC_APP_URL || 'https://tryselfmade.ai').replace(/\/$/, '')
  const link = `${site}/join?token=${token}`
  // Send the invite email (best-effort — the link is also returned so it works even if email fails).
  const inviter = user.email || 'A teammate'
  const html = `<div style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:0 auto;color:#0e1b12">
    <h2 style="font-size:22px;margin:0 0 12px">You're invited to ${org.name} on Selfmade</h2>
    <p style="font-size:15px;line-height:1.6;color:#374151;margin:0 0 20px"><b>${inviter}</b> invited you to join their team on <b>Selfmade</b> — spy on 3M+ winning Meta ads, remake or generate your own with AI, and launch. One shared workspace.</p>
    <p style="margin:0 0 20px"><a href="${link}" style="display:inline-block;background:#0e1b12;color:#dffe95;padding:13px 26px;border-radius:100px;text-decoration:none;font-weight:800;font-size:15px">Join the team →</a></p>
    <p style="color:#9ca3af;font-size:13px;margin:0">Or paste this link into your browser:<br>${link}</p>
  </div>`
  const emailed = await sendEmail(em, `You're invited to ${org.name} on Selfmade`, html).catch(() => false)
  return NextResponse.json({ invite: data, link, emailed, emailEnabled })
}

// Set a member's ad-account assignment. Body: { userId, accountIds: string[] }.
// Empty accountIds → clear all rows → member reverts to seeing ALL org accounts (default-all).
export async function PATCH(request: NextRequest) {
  const c = await ctx(); if (!c) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { admin, org } = c
  if (!canManage(org.role)) return NextResponse.json({ error: 'Only an owner or admin can manage access.' }, { status: 403 })
  const { userId, accountIds } = await request.json().catch(() => ({}))
  if (!userId || !Array.isArray(accountIds)) return NextResponse.json({ error: 'userId + accountIds[] required' }, { status: 400 })

  // Member must belong to this org; never scope the owner (they always see all).
  const { data: mem } = await admin.from('org_members').select('role').eq('org_id', org.orgId).eq('user_id', userId).maybeSingle()
  if (!mem) return NextResponse.json({ error: 'Not a member of this org.' }, { status: 400 })
  if (mem.role === 'owner') return NextResponse.json({ error: 'The owner always has access to all accounts.' }, { status: 400 })

  // Only accept account_ids that are actually in the org pool.
  const pool = new Set((await orgAdAccounts(admin, org.orgId)).map(a => a.account_id))
  const clean = Array.from(new Set((accountIds as string[]).filter(a => pool.has(a))))

  await admin.from('org_member_ad_accounts').delete().eq('org_id', org.orgId).eq('user_id', userId)
  if (clean.length) {
    await admin.from('org_member_ad_accounts').insert(clean.map(account_id => ({ org_id: org.orgId, user_id: userId, account_id })))
  }
  return NextResponse.json({ ok: true, accounts: clean.length ? clean : null, allAccounts: clean.length === 0 })
}

export async function DELETE(request: NextRequest) {
  const c = await ctx(); if (!c) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { admin, org } = c
  if (!canManage(org.role)) return NextResponse.json({ error: 'Only an owner or admin can manage the team.' }, { status: 403 })
  const url = new URL(request.url)
  const inviteId = url.searchParams.get('invite')
  const memberId = url.searchParams.get('member')
  if (inviteId) {
    await admin.from('org_invites').update({ status: 'revoked' }).eq('id', inviteId).eq('org_id', org.orgId)
    return NextResponse.json({ ok: true })
  }
  if (memberId) {
    // never remove the owner
    const { data: m } = await admin.from('org_members').select('role').eq('id', memberId).eq('org_id', org.orgId).maybeSingle()
    if (m?.role === 'owner') return NextResponse.json({ error: 'Cannot remove the owner.' }, { status: 400 })
    await admin.from('org_members').delete().eq('id', memberId).eq('org_id', org.orgId)
    return NextResponse.json({ ok: true })
  }
  return NextResponse.json({ error: 'invite or member id required' }, { status: 400 })
}
