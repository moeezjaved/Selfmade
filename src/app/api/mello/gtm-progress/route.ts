/**
 * GET /api/mello/gtm-progress → a live checklist of what the founder has actually done across the GTM
 * (GEO + SEO), read from the real tables. Powers the "Your progress" tracker on the plan. Brand-scoped,
 * read-only. Every count is a fact from a table — nothing aspirational.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveActiveBrandId } from '@/lib/brand/active'

export const dynamic = 'force-dynamic'
export const maxDuration = 20

type Item = { key: string; label: string; done: boolean; value?: string; href: string }

export async function GET(_req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient() as any
  const uid = user.id
  const brandId = await resolveActiveBrandId(admin, uid).catch(() => null)
  const scope = (q: any) => (brandId ? q.eq('brand_id', brandId) : q)
  const count = async (fn: () => any): Promise<number> => { try { const { count } = await fn(); return count || 0 } catch { return 0 } }

  const [geoAudit, seoAudit, answerPages, crawlAssets, offsite, keywords, briefs] = await Promise.all([
    (async () => { try { const { data } = await scope(admin.from('geo_audit').select('score, share_of_voice').eq('user_id', uid).order('created_at', { ascending: false }).limit(1)).maybeSingle(); return data } catch { return null } })(),
    (async () => { try { const { data } = await scope(admin.from('seo_audit').select('score').eq('user_id', uid).order('created_at', { ascending: false }).limit(1)).maybeSingle(); return data } catch { return null } })(),
    count(() => scope(admin.from('geo_assets').select('id', { count: 'exact', head: true }).eq('user_id', uid).eq('kind', 'answer_page'))),
    count(() => scope(admin.from('geo_assets').select('id', { count: 'exact', head: true }).eq('user_id', uid).in('kind', ['llms_txt', 'schema', 'fact_sheet']))),
    count(() => scope(admin.from('geo_assets').select('id', { count: 'exact', head: true }).eq('user_id', uid).eq('kind', 'offsite'))),
    count(() => scope(admin.from('seo_keywords').select('id', { count: 'exact', head: true }).eq('user_id', uid))),
    count(() => scope(admin.from('seo_pages').select('id', { count: 'exact', head: true }).eq('user_id', uid).eq('kind', 'brief'))),
  ])

  const sov = geoAudit?.share_of_voice != null ? Math.round(Number(geoAudit.share_of_voice) * 100) : null
  const items: Item[] = [
    { key: 'geo_check', label: 'Checked your AI visibility', done: !!geoAudit, value: sov != null ? `${sov}% share of voice` : undefined, href: '/mission/geo' },
    { key: 'answers', label: 'Wrote answer pages for AI gaps', done: answerPages > 0, value: answerPages ? `${answerPages} drafted` : undefined, href: '/mission/geo' },
    { key: 'readable', label: 'Made your site AI-readable (llms.txt / schema)', done: crawlAssets > 0, value: crawlAssets ? `${crawlAssets} generated` : undefined, href: '/mission/geo' },
    { key: 'offsite', label: 'Drafted off-site replies', done: offsite > 0, value: offsite ? `${offsite} drafted` : undefined, href: '/mission/geo' },
    { key: 'seo_audit', label: 'Audited your site for SEO', done: !!seoAudit, value: seoAudit?.score != null ? `score ${seoAudit.score}/100` : undefined, href: '/mission/seo' },
    { key: 'keywords', label: 'Found the keywords worth winning', done: keywords > 0, value: keywords ? `${keywords} keywords` : undefined, href: '/mission/seo' },
    { key: 'briefs', label: 'Created content briefs', done: briefs > 0, value: briefs ? `${briefs} briefs` : undefined, href: '/mission/seo' },
  ]
  const doneCount = items.filter((i) => i.done).length
  return NextResponse.json({ items, done: doneCount, total: items.length }, { status: 200 })
}
