/**
 * Meta ads playbooks API.
 *   GET  /api/meta/playbooks            → the catalog of playbook agents + account-health snapshot
 *   POST { kind }                       → generate one account-grounded playbook (advisory brief)
 * Advisory only — nothing here changes the ad account. Brand-scoped.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveActiveBrandId } from '@/lib/brand/active'
import { PLAYBOOKS, generatePlaybook } from '@/lib/meta/playbooks'
import { checkAdsHealth } from '@/lib/meta/health'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(_req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient() as any
  const brandId = await resolveActiveBrandId(admin, user.id).catch(() => null)
  const health = await checkAdsHealth(admin, user.id, brandId).catch(() => ({ connected: false, issues: [] as any[] }))
  return NextResponse.json({ playbooks: PLAYBOOKS, health })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient() as any
  const brandId = await resolveActiveBrandId(admin, user.id).catch(() => null)
  const body = await req.json().catch(() => ({}))
  const pb = await generatePlaybook(admin, user.id, brandId, body.kind)
  if (!pb) return NextResponse.json({ error: 'Could not generate that playbook.' }, { status: 400 })
  return NextResponse.json({ ok: true, playbook: pb })
}
