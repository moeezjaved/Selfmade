/**
 * GET /api/brain/overview — everything the Company Brain screen shows in one call:
 * identity, beliefs (active DNA) + Mello's pending proposals, per-department notebooks + learnings,
 * the recent learning log, CEO prefs, and a simple playbook (the highest-confidence plays).
 */
import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getPrefs } from '@/lib/brain'
import { resolveActiveBrandId } from '@/lib/brand/active'

export const dynamic = 'force-dynamic'

const DEPTS = ['research', 'creative', 'media', 'growth', 'customer', 'store', 'finance']

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  // The Company Brain is the ACTIVE brand's brain (identity, beliefs, learnings) — not the first brand's.
  const brandId = (await resolveActiveBrandId(admin, user.id).catch(() => null)) || null

  const [brandRes, dnaRes, learnRes, prefs, conflictRes] = await Promise.all([
    // Identity = the ACTIVE brand (was brands.limit(1) → always the first brand, e.g. "Co natural", under
    // every project). Falls back to the first brand only in the "All brands" view (no active brand).
    brandId
      ? admin.from('brands').select('name, industry, brand_type').eq('user_id', user.id).eq('id', brandId).limit(1)
      : admin.from('brands').select('name, industry, brand_type').eq('user_id', user.id).order('created_at', { ascending: true }).limit(1),
    admin.from('company_dna').select('id, rule, department, priority, active, created_by, source, evidence, confidence, created_at, brand_id').eq('user_id', user.id).order('created_at', { ascending: false }),
    admin.from('learnings').select('department, event, result, metric, confidence, created_at, brand_id').eq('user_id', user.id).order('created_at', { ascending: false }).limit(200),
    getPrefs(admin, user.id),
    admin.from('brain_conflicts').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('status', 'pending'),
  ])

  // Scope belief + learning rows to the active brand: this brand's own rows + genuinely account-wide ones
  // (brand_id null = a company-wide belief like "always ask before spending"). Excludes ANOTHER brand's
  // rows (e.g. Aura's customer learnings no longer surface under Hair ResQ).
  const inBrand = (r: any) => !brandId || !r.brand_id || r.brand_id === brandId
  const dnaRows = ((dnaRes.data || []) as any[]).filter(inBrand)
  const beliefs = dnaRows.filter(d => d.active)
  const proposals = dnaRows.filter(d => !d.active && d.created_by === 'mello' && d.source === 'reflection')
  // Every pending candidate belief (reflection + observed from Slack/WhatsApp/inbox), newest first.
  const candidates = dnaRows.filter(d => !d.active && d.created_by === 'mello')
  const conflictCount = conflictRes?.count || 0
  // Notebook (mello_memory) — brand-scope resiliently: try with brand_id (mig 152), fall back to the
  // plain select if the column isn't there yet, so the page never breaks during the migration window.
  let mem: any[] = []
  {
    const withBrand = await admin.from('mello_memory').select('id, content, category, department, confidence, source, source_kind, created_at, brand_id').eq('user_id', user.id).order('confidence', { ascending: false }).limit(200)
    if (withBrand.error) {
      const plain = await admin.from('mello_memory').select('id, content, category, department, confidence, source, source_kind, created_at').eq('user_id', user.id).order('confidence', { ascending: false }).limit(200)
      mem = (plain.data || []) as any[]
    } else {
      mem = ((withBrand.data || []) as any[]).filter(inBrand)
    }
  }
  // Learnings are STRICT per-brand (a customer-reply learning belongs to the brand whose customer it was).
  // Legacy null-brand learnings (written before brand tagging) show only under "All brands", not every brand.
  const learns = ((learnRes.data || []) as any[]).filter(l => !brandId || l.brand_id === brandId)

  const departments = DEPTS.map(dept => ({
    department: dept,
    notebook: mem.filter(m => m.department === dept).map(m => ({ content: m.content, category: m.category, confidence: m.confidence, source_kind: m.source_kind })),
    learnings: learns.filter(l => l.department === dept).slice(0, 12),
  })).filter(d => d.notebook.length || d.learnings.length)

  // Playbook = the highest-confidence learnings that carry a result (the plays the company has earned).
  const playbook = learns.filter(l => l.result && l.confidence >= 75).slice(0, 12)

  return NextResponse.json({
    identity: (brandRes.data || [])[0] || null,
    beliefs, proposals, candidates,
    departments,
    learnings: learns.slice(0, 30),
    prefs,
    playbook,
    counts: { beliefs: beliefs.length, proposals: proposals.length, candidates: candidates.length, conflicts: conflictCount, learnings: learns.length },
  })
}
