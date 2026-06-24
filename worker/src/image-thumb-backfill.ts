/**
 * Image thumbnail backfill (B) — generate the 480px webp thumb for the IMAGE back-catalog.
 *
 * The drain now writes a thumb for every NEW image creative (→ discovery_creatives.poster_url).
 * This backfills the existing ones: download the full-res image already in R2, resize to a 480px
 * webp (keyed by hash → deduped), upload, and set poster_url. Serving prefers poster_url, so the
 * feed goes from 300KB–1.8MB full-res to ~30KB thumbs — the real fast-image fix at scale.
 *
 * THROTTLED + keyset by ad_id (indexed). Run it AFTER stopping the crawl so it doesn't fight the
 * DB. Watch DB CPU% — it's light (R2 read + sharp + one tiny UPDATE per row) but pause if it climbs.
 *
 *   docker run -d --name image-thumb --env-file /opt/worker/.env \
 *     -v /opt/worker/src/image-thumb-backfill.ts:/app/src/image-thumb-backfill.ts \
 *     -e THUMB_CONCURRENCY=3 selfmade-worker npx tsx src/image-thumb-backfill.ts
 *   # tunables: THUMB_CONCURRENCY (default 3), THUMB_BATCH (default 200)
 */
import { supabase } from './db.js'
import { uploadThumb } from './r2.js'
import sharp from 'sharp'

const CONCURRENCY = Math.max(1, parseInt(process.env.THUMB_CONCURRENCY ?? '3', 10))
const BATCH = Math.max(20, parseInt(process.env.THUMB_BATCH ?? '200', 10))

type Cre = { id: string; ad_id: string; hash: string | null; r2_url: string; width: number | null; height: number | null }

async function backfillOne(c: Cre): Promise<boolean> {
  if (!c.hash || !c.r2_url) return false
  try {
    const res = await fetch(c.r2_url)
    if (!res.ok) return false
    const buf = Buffer.from(await res.arrayBuffer())
    const url = await uploadThumb(buf, c.hash)
    if (!url) return false
    const update: Record<string, any> = { poster_url: url }
    // Stamp width/height if missing → the masonry pre-sizes the card from these (no reflow,
    // Atria-style stable grid). Free here since we already have the decoded buffer.
    if (c.width == null || c.height == null) {
      try { const m = await sharp(buf, { failOn: 'none' }).metadata(); if (m.width && m.height) { update.width = m.width; update.height = m.height } } catch { /* keep poster_url */ }
    }
    await (supabase as any).from('discovery_creatives').update(update).eq('id', c.id)
    return true
  } catch { return false }
}

async function main() {
  console.log(`🖼️  image-thumb backfill started (concurrency=${CONCURRENCY}, batch=${BATCH})`)
  let cursor: string | null = null
  let done = 0, ok = 0
  for (;;) {
    let q = (supabase as any)
      .from('discovery_creatives')
      .select('id, ad_id, hash, r2_url, width, height')
      .eq('asset_type', 'image')
      .is('poster_url', null)
      .not('r2_url', 'is', null)
      .not('hash', 'is', null)
      // NEWEST ad_id first ≈ feed order (recent/active ads are what the Performance feed
      // front-loads) → the ads users actually SEE get thumbs within the first hour or two,
      // the long tail fills behind it.
      .order('ad_id', { ascending: false })
      .limit(BATCH)
    if (cursor) q = q.lt('ad_id', cursor)
    const { data: cres, error } = await q
    if (error) { console.error('query error:', error.message); break }
    if (!cres || cres.length === 0) break

    for (let i = 0; i < cres.length; i += CONCURRENCY) {
      const chunk = cres.slice(i, i + CONCURRENCY)
      const results = await Promise.all(chunk.map(backfillOne))
      done += chunk.length; ok += results.filter(Boolean).length
    }
    cursor = cres[cres.length - 1].ad_id
    console.log(`  … ${done} processed, ${ok} thumbs written (cursor=${cursor})`)
  }
  console.log(`✅ image-thumb backfill done — ${ok}/${done} thumbs written`)
  process.exit(0)
}

main().catch((e) => { console.error('fatal:', e); process.exit(1) })
