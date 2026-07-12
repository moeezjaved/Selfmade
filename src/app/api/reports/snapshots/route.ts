/**
 * GET    /api/reports/snapshots            — list this org's "Share once" snapshots (newest first).
 * DELETE /api/reports/snapshots?token=xxx  — remove a snapshot from the archive + delete its blob.
 * Snapshots are org-scoped and stored in R2 (no DB), created via /api/reports/share (mode 'once').
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getUserOrg } from '@/lib/org'
import { listSnapshots, removeSnapshot } from '@/lib/reports/snapshots'

export const dynamic = 'force-dynamic'

async function org() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const o = await getUserOrg(createAdminClient() as any, user.id)
  return o?.orgId ? o.orgId : null
}

export async function GET() {
  const orgId = await org()
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const snapshots = await listSnapshots(orgId)
  return NextResponse.json({ snapshots })
}

export async function DELETE(req: NextRequest) {
  const orgId = await org()
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const token = req.nextUrl.searchParams.get('token') || ''
  if (!/^[a-z0-9]{6,40}$/i.test(token)) return NextResponse.json({ error: 'Invalid token' }, { status: 400 })
  await removeSnapshot(orgId, token)
  return NextResponse.json({ ok: true })
}
