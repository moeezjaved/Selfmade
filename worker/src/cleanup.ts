/**
 * Find image hashes that are over-used (clearly not a real creative —
 * a placeholder/UI graphic) and clear thumbnail_url+image_hash for those
 * ads so the worker re-extracts them with the new strict filter.
 *
 * Run via:
 *   docker exec worker node dist/cleanup.js [--threshold=100] [--dry-run]
 *
 * Default threshold: 100 (any hash used by >100 ads is suspect)
 */
import { supabase } from './db.js'

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const thresholdArg = args.find(a => a.startsWith('--threshold='))
  const threshold = thresholdArg ? parseInt(thresholdArg.split('=')[1]) : 100

  console.log(`🧹 Placeholder cleanup ${dryRun ? '(DRY RUN)' : ''}`)
  console.log(`   threshold: a hash used by > ${threshold} ads is treated as bad placeholder\n`)

  // 1. Get all ads with image_hash, count occurrences per hash
  console.log('📊 Counting hash usage...')
  const counts = new Map<string, number>()
  let from = 0
  const PAGE = 1000
  while (true) {
    const { data, error } = await (supabase as any)
      .from('discovery_ads_index')
      .select('image_hash')
      .not('image_hash', 'is', null)
      .range(from, from + PAGE - 1)
    if (error) { console.error('❌ DB error:', error.message); process.exit(1) }
    if (!data || data.length === 0) break
    for (const r of data as any[]) {
      counts.set(r.image_hash, (counts.get(r.image_hash) || 0) + 1)
    }
    from += data.length
    if (data.length < PAGE) break
  }

  // 2. Find suspect hashes
  const suspectHashes = Array.from(counts.entries())
    .filter(([, c]) => c > threshold)
    .sort((a, b) => b[1] - a[1])

  if (suspectHashes.length === 0) {
    console.log(`✅ No hash exceeds the threshold of ${threshold} ads. Nothing to clean.`)
    process.exit(0)
  }

  console.log(`\n🚨 Found ${suspectHashes.length} suspect hash(es):`)
  suspectHashes.forEach(([hash, count]) => {
    console.log(`   ${hash.slice(0, 16)}…  used by ${count} ads`)
  })

  const totalAffected = suspectHashes.reduce((s, [, c]) => s + c, 0)
  console.log(`\n📊 Total ads to reset: ${totalAffected}`)

  if (dryRun) {
    console.log(`\n💡 Dry run — no changes made. Re-run without --dry-run to clean up.`)
    process.exit(0)
  }

  // 3. Clear thumbnail_url + image_hash + creative_extraction_failed_at
  // for all ads with these hashes — worker will re-process them.
  // Tiny chunks + retries to survive lock contention if worker is running.
  let totalCleaned = 0
  const CHUNK = 25
  const MAX_RETRIES = 5
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

  for (const [hash] of suspectHashes) {
    const { data: matches, error: selErr } = await (supabase as any)
      .from('discovery_ads_index')
      .select('ad_id')
      .eq('image_hash', hash)
    if (selErr) {
      console.error(`  ❌ Failed listing hash ${hash.slice(0, 16)}…:`, selErr.message)
      continue
    }
    const ids = (matches || []).map((r: any) => r.ad_id)
    let cleanedForHash = 0

    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK)
      let success = false
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        const { error: updErr } = await (supabase as any)
          .from('discovery_ads_index')
          .update({
            thumbnail_url: null,
            image_hash: null,
            creative_extraction_failed_at: null,
          } as any)
          .in('ad_id', chunk)
        if (!updErr) {
          success = true
          break
        }
        if (attempt === MAX_RETRIES) {
          console.error(`\n     ⚠️  Chunk ${Math.floor(i / CHUNK) + 1} permanently failed after ${MAX_RETRIES} retries:`, updErr.message)
        } else {
          await sleep(500 * attempt) // exponential backoff
        }
      }
      if (success) {
        cleanedForHash += chunk.length
        process.stdout.write('.')
      }
      // Tiny breath between chunks to release locks
      await sleep(50)
    }
    console.log(`\n  ✅ Cleared ${cleanedForHash}/${ids.length} ads with hash ${hash.slice(0, 16)}…`)
    totalCleaned += cleanedForHash
  }

  // 4. Also delete the bad rows in discovery_creatives table
  for (const [hash] of suspectHashes) {
    await (supabase as any)
      .from('discovery_creatives')
      .delete()
      .eq('hash', hash)
      .eq('asset_type', 'image')
  }

  console.log(`\n🎉 Cleanup complete: ${totalCleaned} ads reset`)
  console.log(`   Worker will re-extract these on next pass with the new strict filter.`)
  process.exit(0)
}

main().catch(err => {
  console.error('💀 Fatal:', err)
  process.exit(1)
})
