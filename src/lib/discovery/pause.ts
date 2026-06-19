/**
 * Shared crawl-pause check for discovery writer crons.
 *
 * The nightly rollup takes a `crawl_paused` lease (system_flags, heartbeat-held,
 * 5-min TTL) while it runs its set-based apply_perf write over discovery_ads_index.
 * Any other writer that fires during that window contends for the same row locks
 * and dies with 55P03 (lock_timeout). So every discovery cron that UPDATEs/UPSERTs
 * discovery_ads_index bails when the lease is held.
 *
 * Bailing is safe: each of these crons drains a backlog of unclassified rows, so a
 * skipped tick loses nothing — the next run picks up exactly where it left off. We
 * can't *wait out* the pause (the rollup window already exceeds Vercel's 300s cap),
 * so skip-and-resume is the only correct option on Vercel.
 */
type Admin = { from: (t: string) => any }

export async function isCrawlPaused(admin: Admin): Promise<boolean> {
  const { data } = await admin
    .from('system_flags')
    .select('until')
    .eq('key', 'crawl_paused')
    .maybeSingle()
  if (!data?.until) return false
  return new Date(data.until).getTime() > Date.now()
}
