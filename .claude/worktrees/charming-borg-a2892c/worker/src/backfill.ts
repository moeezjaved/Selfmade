/**
 * One-time backfill: compute perceptual hashes for all R2-stored creatives
 * that don't have a hash yet (ads processed before the dedup feature).
 *
 * Streams from R2, hashes, updates Supabase. Resumable — re-run if it crashes,
 * picks up where it left off (only ads where hash IS NULL are queried).
 *
 * Run via:
 *   docker exec worker node dist/backfill.js
 *   OR
 *   docker run --rm --env-file .env selfmade-worker node dist/backfill.js
 */
import { supabase } from './db.js'
import { imageHash, videoHash } from './hash.js'

const BATCH_SIZE = 50
const CONCURRENCY = 8

async function fetchBuffer(url: string, timeoutMs = 20_000): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.byteLength < 100) return null
    return buf
  } catch {
    return null
  }
}

interface BackfillStats {
  processed: number
  hashed: number
  failed: number
}

async function backfillType(
  type: 'image' | 'video',
  stats: BackfillStats,
  force: boolean,
): Promise<void> {
  const urlCol = type === 'image' ? 'thumbnail_url' : 'video_url'
  const hashCol = type === 'image' ? 'image_hash' : 'video_hash'

  console.log(`\n🔄 Backfilling ${type} hashes${force ? ' (FORCE re-hash all)' : ''}...`)

  // Cursor for FORCE mode (so we don't re-claim same rows since their hash gets overwritten).
  let cursorLastSeen: string | null = null

  while (true) {
    let q: any = (supabase as any)
      .from('discovery_ads_index')
      .select(`ad_id, last_seen, ${urlCol}`)
      .like(urlCol, '%r2.dev%')
      .order('last_seen', { ascending: false })
      .limit(BATCH_SIZE)

    if (force) {
      // Walk the table top-down; cursor on last_seen avoids infinite loop
      if (cursorLastSeen) q = q.lt('last_seen', cursorLastSeen)
    } else {
      q = q.is(hashCol, null)
    }

    const { data: ads, error } = await q

    if (error) {
      console.error(`❌ DB error: ${error.message}`)
      break
    }
    if (!ads || ads.length === 0) {
      console.log(`✅ No more ${type}s need hashing`)
      break
    }

    // Process this batch with bounded concurrency
    let cursor = 0
    const workers = Array.from({ length: Math.min(CONCURRENCY, ads.length) }, async () => {
      while (cursor < ads.length) {
        const idx = cursor++
        const ad = ads[idx] as any
        const url: string = ad[urlCol]
        const t0 = Date.now()

        const buf = await fetchBuffer(url)
        if (!buf) {
          stats.failed++
          stats.processed++
          console.log(`  ❌ [${idx + 1}/${ads.length}] ${ad.ad_id} download failed`)
          continue
        }

        const hash = type === 'image' ? await imageHash(buf) : videoHash(buf)
        if (!hash) {
          stats.failed++
          stats.processed++
          console.log(`  ❌ [${idx + 1}/${ads.length}] ${ad.ad_id} hash failed`)
          continue
        }

        const { error: updErr } = await (supabase as any)
          .from('discovery_ads_index')
          .update({ [hashCol]: hash })
          .eq('ad_id', ad.ad_id)

        const dt = ((Date.now() - t0) / 1000).toFixed(1)
        if (updErr) {
          stats.failed++
          console.log(`  ❌ [${idx + 1}/${ads.length}] ${ad.ad_id} db update failed (${dt}s)`)
        } else {
          stats.hashed++
          console.log(`  ✅ [${idx + 1}/${ads.length}] ${ad.ad_id} hash=${hash.slice(0, 8)}… (${dt}s)`)
        }
        stats.processed++
      }
    })

    await Promise.all(workers)
    console.log(`📊 Lifetime ${type}: ${stats.hashed} hashed, ${stats.failed} failed, ${stats.processed} total`)

    // Advance the cursor for FORCE mode (else infinite loop, since hash is now set)
    if (force) {
      cursorLastSeen = (ads[ads.length - 1] as any).last_seen
    }

    // If we got fewer than BATCH_SIZE, we're done
    if (ads.length < BATCH_SIZE) break
  }
}

async function main() {
  const force = process.argv.includes('--force') || process.env.BACKFILL_FORCE === '1'
  console.log(`🚀 Hash backfill starting…${force ? ' (FORCE re-hash all)' : ''}`)
  console.log(`   batch=${BATCH_SIZE} concurrency=${CONCURRENCY}`)

  const stats: BackfillStats = { processed: 0, hashed: 0, failed: 0 }

  await backfillType('image', stats, force)
  await backfillType('video', stats, force)

  console.log('\n🎉 Backfill complete')
  console.log(`   Total processed: ${stats.processed}`)
  console.log(`   Total hashed:    ${stats.hashed}`)
  console.log(`   Total failed:    ${stats.failed}`)

  process.exit(0)
}

main().catch((err) => {
  console.error('💀 Fatal:', err)
  process.exit(1)
})
