/**
 * Carry the free store-audit (the pre-signup theater) into the logged-in product.
 *
 * The theater runs a quick scan and stores it in `audit_scans` (by domain). The in-app SEO + GEO surfaces
 * read their OWN tables (`seo_audit`, `geo_audit`/`geo_checks`), so without this the audit's findings never
 * show up in the app — every page starts empty ("No audit yet") and re-runs from zero, re-charging credits.
 *
 * seedBrandFromScan() bridges that: the first time a brand's SEO/GEO surface is opened with no audit yet, we
 * hydrate it from the brand's stored theater scan (mapped into each surface's shape). Idempotent — once a
 * real audit exists it never re-seeds, and re-running the deep audit overwrites it with richer data.
 *
 * (CRO isn't seeded: the theater never does a vision teardown, so there's nothing to carry — it runs on
 * demand. Identity/website is seeded so the deep audits resolve the right site.)
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadScanForDomain, type ScanResult } from './scan'
import { isAppDomain } from '@/lib/domain-guard'

const clean = (s: string) => s.replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim()

/** Resolve the brand's real site domain: connected Shopify store first, else the brand website. */
async function brandDomain(admin: any, userId: string, brandId: string): Promise<string> {
  try {
    const { resolveStore } = await import('@/lib/shopify/client')
    const store = await resolveStore(admin, userId, brandId).catch(() => null)
    if (store?.shop_domain) return clean(String(store.shop_domain))
  } catch { /* fall through */ }
  try {
    const { data } = await admin.from('brands').select('website, brand_kit').eq('id', brandId).maybeSingle()
    const kit = (data?.brand_kit && typeof data.brand_kit === 'object') ? data.brand_kit : {}
    const d = clean(String(data?.website || kit.website || kit.siteName || ''))
    if (d && !isAppDomain(d)) return d
  } catch { /* ignore */ }
  return ''
}

/**
 * Hydrate this brand's SEO + GEO surfaces from its stored theater scan, if they're empty. Safe to call on
 * every SEO/GEO load: it short-circuits the moment a real audit already exists.
 */
export async function seedBrandFromScan(admin: SupabaseClient, userId: string, brandId: string | null): Promise<void> {
  if (!brandId) return
  const db = admin as any
  try {
    // Already have both? Nothing to do (the common steady-state path — one cheap indexed check each).
    const [{ data: seoRow }, { data: geoRow }] = await Promise.all([
      db.from('seo_audit').select('id').eq('brand_id', brandId).limit(1).maybeSingle(),
      db.from('geo_audit').select('id').eq('brand_id', brandId).limit(1).maybeSingle(),
    ])
    if (seoRow && geoRow) return

    const domain = await brandDomain(db, userId, brandId)
    if (!domain) return
    const scan = await loadScanForDomain(db, domain) as ScanResult | null
    if (!scan) return

    // ── SEO: theater section findings (everything except the AI-visibility section) → seo_audit issues ──
    if (!seoRow) {
      const issues: { severity: 'high' | 'medium' | 'low'; title: string; detail: string; pages: string[] }[] = []
      for (const s of (scan.sections || [])) {
        if (s.key === 'ai') continue   // that's GEO, seeded below
        for (const f of (s.findings || [])) {
          issues.push({ severity: f.severity, title: f.title, detail: f.detail, pages: (f.sample || []).slice(0, 8) })
        }
      }
      if (issues.length) {
        const readSec = (scan.sections || []).find((s) => s.read)
        const pagesCrawled = readSec?.read?.total || 0
        const score = Math.round(scan.websiteScore ?? scan.score ?? 0)
        await db.from('seo_audit').insert({
          brand_id: brandId, user_id: userId, score, issues, pages_crawled: pagesCrawled, site: `https://${domain}`,
        }).then(() => {}, () => {})
      }
    }

    // ── GEO: theater AI-visibility reads → geo_audit + geo_checks ──
    if (!geoRow) {
      const aiSec = (scan.sections || []).find((s) => s.key === 'ai')
      const reads = aiSec?.ai?.reads || scan.ai?.reads || []
      if (reads.length) {
        const checkRows = reads.map((r) => ({
          brand_id: brandId, user_id: userId, prompt_text: r.question, engine: r.engine,
          cited: !!r.mentioned, grounded: !!r.mentioned, competitors_cited: [], answer_excerpt: String(r.answer || '').slice(0, 500),
        }))
        const you = reads.filter((r) => r.mentioned).length
        const sov = reads.length ? you / reads.length : 0
        const engines = Array.from(new Set(reads.map((r) => r.engine)))
        const gaps = reads.filter((r) => !r.mentioned).map((r) => ({ prompt: r.question, rivals: [] as string[] }))
        await db.from('geo_checks').insert(checkRows).then(() => {}, () => {})
        await db.from('geo_audit').insert({
          brand_id: brandId, user_id: userId, score: Math.round(sov * 100), share_of_voice: sov,
          prompts_checked: reads.length, engines, gaps,
        }).then(() => {}, () => {})
      }
    }
  } catch { /* carry-over is best-effort — never break the page */ }
}
