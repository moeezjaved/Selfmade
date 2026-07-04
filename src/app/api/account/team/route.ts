/**
 * Team management — list members + pending invites, invite by email, remove members / revoke invites.
 * One shared org per user. Invite/remove gated to owner|admin. Seat-limited by the owner's plan.
 * Stage 1: returns a join link per invite (email delivery + paid overage come in Stage 2).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getUserOrg, getSeatInfo, canManage, type Role } from '@/lib/org'
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
  const site = (process.env.NEXT_PUBLIC_APP_URL || 'https://tryselfmade.ai').replace(/\/$/, '')
  // debug: what the plan lookup sees for the org owner (visible at /api/account/team)
  const { data: subRow } = await admin.from('subscriptions').select('owner_id, plan, status').eq('owner_id', org.ownerId).maybeSingle()
  const { data: profRow } = await admin.from('user_profiles').select('plan_id').eq('user_id', org.ownerId).maybeSingle()
  return NextResponse.json({
    org: { id: org.orgId, name: org.name, role: org.role },
    members: withEmail,
    invites: (invites || []).map((i: any) => ({ ...i, link: `${site}/join?token=${i.token}` })),
    seats,
    _debug: { ownerId: org.ownerId, callerId: c.user.id, subscription: subRow || null, profile_plan: profRow?.plan_id || null },
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
  return NextResponse.json({ invite: data, link: `${site}/join?token=${token}` })
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
