/**
 * Featured playbooks with cover collages — shared by /playbooks and the Discover
 * "Recommended by Mello" shelf. One bounded query per book (first 5 ads → covers +
 * exact count). Only returns books with ≥3 real covers so nothing renders empty.
 */
import { createAdminClient } from '@/lib/supabase/server'

export type FeaturedBook = { id: string; title: string; slug: string; description?: string; emoji?: string; updated_at: string; covers: string[]; count: number }

export async function getFeaturedPlaybooks(opts: { featuredOnly?: boolean; limit?: number } = {}): Promise<FeaturedBook[]> {
  const admin = createAdminClient() as any
  let q = admin.from('playbooks').select('*')
  if (opts.featuredOnly) q = q.eq('featured', true)
  const { data: books } = await q.order('featured', { ascending: false }).order('sort_order').order('created_at').limit(opts.limit || 24)
  const out: FeaturedBook[] = []
  for (const b of books || []) {
    const [{ data: links }, { count }] = await Promise.all([
      admin.from('playbook_ads').select('ad_id').eq('playbook_id', b.id).order('position').limit(5),
      admin.from('playbook_ads').select('ad_id', { count: 'exact', head: true }).eq('playbook_id', b.id),
    ])
    const ids = (links || []).map((l: any) => l.ad_id)
    if (!ids.length) continue
    const { data: rows } = await admin.from('discovery_ads_index').select('ad_id, discovery_creatives(asset_type, r2_url, poster_url)').in('ad_id', ids)
    const byId = new Map((rows || []).map((r: any) => [r.ad_id, r]))
    const covers = ids.map((id: string) => {
      const r: any = byId.get(id); if (!r) return null
      const cres = Array.isArray(r.discovery_creatives) ? r.discovery_creatives : (r.discovery_creatives ? [r.discovery_creatives] : [])
      const cre = cres.find((c: any) => (c.asset_type === 'video' ? c.poster_url : c.r2_url)) || cres[0]
      return cre ? (cre.asset_type === 'video' ? cre.poster_url : cre.r2_url) : null
    }).filter(Boolean) as string[]
    if (covers.length >= 3) out.push({ id: b.id, title: b.title, slug: b.slug, description: b.description, emoji: b.emoji, updated_at: b.updated_at, covers, count: count || ids.length })
  }
  return out
}

export const agoLabel = (iso: string) => {
  const h = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 3600e3))
  if (h < 1) return 'updated just now'
  if (h < 24) return `updated ${h} hour${h === 1 ? '' : 's'} ago`
  const d = Math.floor(h / 24)
  return d === 1 ? 'updated yesterday' : `updated ${d} days ago`
}
