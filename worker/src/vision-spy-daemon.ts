/**
 * Vision-spy daemon — runs the FULL brand vision pass for every SPIED brand that still has
 * un-vision-classified ads. Spied brands live in discovery_crawl_terms (term_type='brand', added by
 * the brand-spy API at priority 9). After a brand's full crawl + drain, this fills its complete
 * visual playbook — UGC/studio ratio, setting mix, on-screen text — for the Brand Spy dashboard.
 * The user already paid `brand_spy` credits, so this is the depth they bought.
 *
 *   docker run -d --name vision-spy --env-file /opt/worker/.env -e VISION_AS_LIB=1 \
 *     -v /root/Selfmade/worker/src:/app/src selfmade-worker npx tsx src/vision-spy-daemon.ts
 *   # tunables: SPY_VISION_POLL_MS (60000), VISION_CONCURRENCY (20)
 */
import { supabase } from './db.js'
import { runVision } from './vision-classify.js'

const POLL_MS = Math.max(30_000, parseInt(process.env.SPY_VISION_POLL_MS || '60000', 10))
const CONCURRENCY = Math.max(1, parseInt(process.env.VISION_CONCURRENCY ?? '20', 10))
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function nextSpiedBrandNeedingVision(): Promise<{ page_id: string; term: string } | null> {
  // Spied/tracked brands, most-recently-crawled first (a fresh spy gets its playbook quickly).
  const { data: brands } = await (supabase as any)
    .from('discovery_crawl_terms')
    .select('page_id, term')
    .eq('term_type', 'brand')
    .not('page_id', 'is', null)
    .order('last_crawled_at', { ascending: false, nullsFirst: false })
    .limit(300)
  for (const b of (brands || []) as any[]) {
    const { count } = await (supabase as any)
      .from('discovery_ads_index')
      .select('ad_id', { count: 'planned', head: true })
      .eq('page_id', b.page_id)
      .or('visual_classified.is.null,visual_classified.eq.false')
    if ((count || 0) > 0) return b
  }
  return null
}

async function loop() {
  console.log(`👁️  vision-spy daemon started (poll=${POLL_MS}ms, concurrency=${CONCURRENCY})`)
  for (;;) {
    try {
      const brand = await nextSpiedBrandNeedingVision()
      if (!brand) { await sleep(POLL_MS); continue }
      console.log(`▶ full vision pass — spied brand "${brand.term}" (${brand.page_id})`)
      const { done, ok } = await runVision({ pageId: brand.page_id, concurrency: CONCURRENCY })
      console.log(`✓ "${brand.term}": ${ok}/${done} creatives classified`)
    } catch (e: any) {
      console.error('vision-spy loop error:', e?.message ?? e)
      await sleep(POLL_MS)
    }
  }
}

loop()
