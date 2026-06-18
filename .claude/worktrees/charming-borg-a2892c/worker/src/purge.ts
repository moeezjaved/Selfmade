/**
 * Permanently delete bad ads from the database:
 *   - Ads marked as creative_extraction_failed (no creative on Meta's page)
 *   - Ads with NO R2 creative AND no chance of getting one
 *
 * Run via:
 *   docker exec worker node dist/purge.js [--dry-run]
 *
 * Safety: only deletes rows that have ZERO useful data. Anything with a
 * working R2 thumbnail or video stays.
 */
import { supabase } from './db.js'

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')

  console.log(`🧹 Purging broken ads ${dryRun ? '(DRY RUN)' : ''}\n`)

  // 1. Count what we'll delete
  const [
    { count: failedCount },
    { count: noCreativeCount },
  ] = await Promise.all([
    (supabase as any)
      .from('discovery_ads_index')
      .select('*', { count: 'exact', head: true })
      .not('creative_extraction_failed_at', 'is', null),
    (supabase as any)
      .from('discovery_ads_index')
      .select('*', { count: 'exact', head: true })
      .is('thumbnail_url', null)
      .is('video_url', null)
      .not('creative_extraction_failed_at', 'is', null),
  ])

  console.log(`📊 Stats:`)
  console.log(`   Ads marked as failed extraction:  ${failedCount}`)
  console.log(`   Of those, with NO R2 creative:    ${noCreativeCount}`)
  console.log(`\n🗑  Will delete: ${noCreativeCount} ads (no R2 creative + extraction failed)`)

  if (dryRun) {
    console.log(`\n💡 Dry run — re-run without --dry-run to delete`)
    process.exit(0)
  }

  if (!noCreativeCount || noCreativeCount === 0) {
    console.log(`\n✅ Nothing to delete`)
    process.exit(0)
  }

  // 2. Fetch ad_ids in batches and delete
  const CHUNK = 100
  let totalDeleted = 0

  while (true) {
    const { data: matches } = await (supabase as any)
      .from('discovery_ads_index')
      .select('ad_id')
      .is('thumbnail_url', null)
      .is('video_url', null)
      .not('creative_extraction_failed_at', 'is', null)
      .limit(CHUNK)

    if (!matches || matches.length === 0) break

    const ids = matches.map((r: any) => r.ad_id)

    // Delete from creatives table first (FK constraint)
    await (supabase as any)
      .from('discovery_creatives')
      .delete()
      .in('ad_id', ids)

    // Delete from main table
    const { error } = await (supabase as any)
      .from('discovery_ads_index')
      .delete()
      .in('ad_id', ids)

    if (error) {
      console.error(`  ❌ Delete chunk failed:`, error.message)
      await new Promise(r => setTimeout(r, 1000))
      continue
    }

    totalDeleted += ids.length
    process.stdout.write(`.`)
    if (totalDeleted % 1000 === 0) {
      console.log(` ${totalDeleted} deleted`)
    }
    await new Promise(r => setTimeout(r, 50))
  }

  console.log(`\n\n🎉 Purge complete: ${totalDeleted} ads deleted`)
  console.log(`   Re-crawl will re-index these brands with fresh snapshot URLs.`)
  process.exit(0)
}

main().catch(err => {
  console.error('💀 Fatal:', err)
  process.exit(1)
})
