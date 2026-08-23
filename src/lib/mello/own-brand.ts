/**
 * Resolve a brand's OWN Meta page_id from its name via the directory the scan uses
 * (search_brand_directory RPC). CONFIDENCE-GUARDED: only returns a page when a directory name matches the
 * brand name EXACTLY (folded — accents stripped, lowercased, alphanumerics only), preferring the highest
 * ad-count match. Returns null on any ambiguity so we never reason over a different brand's ads as the
 * founder's own. Shared by the Strategist (plan) and the fast desk endpoint (panels), so the two agree.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export const fold = (s: string) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')

export async function resolveOwnPageId(admin: SupabaseClient, brandName: string | null): Promise<string | null> {
  const q = (brandName || '').trim()
  if (q.length < 3) return null
  try {
    const { data } = await (admin as any).rpc('search_brand_directory', { p_q: q, p_industry: null, p_limit: 15 })
    const rows = (Array.isArray(data) ? data : []) as { page_id: string; name: string; source_ad_count?: number }[]
    const want = fold(q)
    const exact = rows.filter((r) => fold(r.name) === want)
    if (!exact.length) return null
    exact.sort((a, b) => (b.source_ad_count || 0) - (a.source_ad_count || 0))
    return exact[0].page_id ? String(exact[0].page_id) : null
  } catch { return null }
}
