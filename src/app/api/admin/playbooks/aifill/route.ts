/**
 * ADMIN · Playbook AI-fill — "both manual and AI."
 * POST {playbookId, niche?, hook?, formatStyle?, count?} → auto-curate the top N
 * winners from the corpus: has_creative + longevity floor, ranked by
 * performance_score. Pure corpus arithmetic (the same signals the Edition trusts) —
 * no LLM needed to pick winners; the market already voted. Appends after existing
 * ads, skipping duplicates, and stamps updated_at so "continuously updated" is true.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminToken } from '@/lib/admin/auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  if (!(await isAdminToken())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const playbookId = String(body.playbookId || '')
  if (!playbookId) return NextResponse.json({ error: 'playbookId required' }, { status: 400 })
  const count = Math.min(Math.max(+body.count || 100, 1), 200)
  const minDays = Math.max(+body.minDays || 14, 0)
  const admin = createAdminClient() as any

  const { data: existing } = await admin.from('playbook_ads').select('ad_id, position').eq('playbook_id', playbookId)
  const have = new Set((existing || []).map((e: any) => e.ad_id))

  let q = admin.from('discovery_ads_index')
    .select('ad_id, performance_score')
    .eq('has_creative', true)
    .not('performance_score', 'is', null)
  if (body.niche) q = q.eq('niche', String(body.niche))
  if (body.hook) q = q.eq('hook_type', String(body.hook))
  if (body.formatStyle) q = q.eq('format_style', String(body.formatStyle))
  if (minDays > 0) q = q.gte('days_running', minDays)
  const { data: winners, error } = await q.order('performance_score', { ascending: false, nullsFirst: false }).limit(count + have.size + 40)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  const fresh = (winners || []).filter((w: any) => !have.has(w.ad_id)).slice(0, count)
  if (!fresh.length) return NextResponse.json({ ok: true, added: 0 })

  let pos = Math.max(-1, ...(existing || []).map((e: any) => e.position)) + 1
  const rows = fresh.map((w: any) => ({ playbook_id: playbookId, ad_id: w.ad_id, position: pos++ }))
  const { error: insErr } = await admin.from('playbook_ads').upsert(rows, { onConflict: 'playbook_id,ad_id', ignoreDuplicates: true })
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 400 })
  await admin.from('playbooks').update({ updated_at: new Date().toISOString() }).eq('id', playbookId)
  return NextResponse.json({ ok: true, added: rows.length })
}
