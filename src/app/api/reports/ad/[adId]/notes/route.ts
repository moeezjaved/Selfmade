/**
 * GET/POST /api/reports/ad/[adId]/notes — team notes on a creative. Stored in R2 (org-scoped key),
 * so it's shared across the workspace with no DB migration.
 */
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getUserOrg } from '@/lib/org'
import { uploadBufferToR2, r2PublicUrl } from '@/lib/r2'

export const dynamic = 'force-dynamic'
const keyFor = (orgId: string, adId: string) => `ad-notes/${orgId}/${adId}.json`

async function load(orgId: string, adId: string): Promise<any[]> {
  const url = r2PublicUrl(keyFor(orgId, adId))
  if (!url) return []
  try { const r = await fetch(url, { cache: 'no-store' }); return r.ok ? (await r.json()) || [] : [] } catch { return [] }
}

async function ctx() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient() as any
  const org = await getUserOrg(admin, user.id)
  return { user, org }
}

export async function GET(_req: NextRequest, { params }: { params: { adId: string } }) {
  const c = await ctx(); if (!c) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ notes: await load(c.org.orgId, params.adId) })
}

export async function POST(req: NextRequest, { params }: { params: { adId: string } }) {
  const c = await ctx(); if (!c) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { text } = await req.json()
  const body = (text || '').trim().slice(0, 4000)
  if (!body) return NextResponse.json({ error: 'Empty note' }, { status: 400 })
  const notes = await load(c.org.orgId, params.adId)
  const entry = { id: randomUUID().slice(0, 12), text: body, author: c.user.user_metadata?.full_name || c.user.email?.split('@')[0] || 'Someone', at: new Date().toISOString() }
  notes.unshift(entry)
  await uploadBufferToR2(Buffer.from(JSON.stringify(notes.slice(0, 200))), keyFor(c.org.orgId, params.adId), 'application/json').catch(() => null)
  return NextResponse.json({ note: entry, notes })
}
