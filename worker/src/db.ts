/**
 * Supabase client (admin/service-role) + queue helpers.
 */
import { createClient } from '@supabase/supabase-js'
import { config } from './config.js'

export const supabase = createClient(config.supabase.url, config.supabase.serviceKey, {
  auth: { persistSession: false },
})

export interface AdRow {
  ad_id: string
  snapshot_url: string
  format: string | null
  page_name: string | null
  // Populated by the indexer from snapshot.images / videos / cards.
  // When set, the worker's fast path downloads these directly via proxy
  // and skips Playwright entirely.
  raw_image_urls: string[] | null
  raw_video_urls: string[] | null
  raw_video_preview_urls: string[] | null
}

/**
 * Atomically claim a batch of ads to process.
 * Uses .order().limit() since Supabase doesn't expose row-level locking via PostgREST.
 * Race-safe enough since we update thumbnail_url to a sentinel right after fetching.
 */
export async function claimAds(batchSize: number, imagesOnly: boolean): Promise<AdRow[]> {
  // WORK-QUEUE claim (migration 034): SKIP LOCKED a batch of pending jobs from
  // creative_queue — O(pending), replacing the old O(corpus) thumbnail_url-IS-NULL
  // scan that hit ~133s at 700K (it scanned most of the table to find the few pending).
  // The worker DELETEs the row (dequeue) on a terminal result; transient failures leave
  // it for the 3-min stale reclaim. Falls back to the legacy SELECT if not yet migrated.
  if (!process.env.WORKER_PAGE_ID) {
    const { data, error } = await (supabase as any).rpc('claim_creative_queue', { p_batch: batchSize })
    if (!error && Array.isArray(data)) {
      let rows = data as AdRow[]
      if (imagesOnly) rows = rows.filter((r: any) => !/video/i.test(r.format || ''))
      return rows
    }
    // error (e.g. RPC not yet migrated) → fall through to legacy SELECT
    if (error && !/function .*claim_creative_queue.* does not exist|PGRST202|404/i.test(error.message || '')) {
      console.warn(`[claim] queue rpc error, falling back to SELECT: ${error.message}`)
    }
  }
  // ── Legacy SELECT fallback (pre-migration-030, or WORKER_PAGE_ID scoping) ──
  let query: any = supabase
    .from('discovery_ads_index')
    .select('ad_id, snapshot_url, format, page_name, raw_image_urls, raw_video_urls, raw_video_preview_urls')
    .is('thumbnail_url', null)
    .is('video_url', null)
    .is('creative_extraction_failed_at', null)
    .or('raw_image_urls.not.is.null,raw_video_urls.not.is.null')   // require at least one raw URL set
    .order('is_active', { ascending: false })
    .order('last_seen', { ascending: false })
    .limit(batchSize)

  if (imagesOnly) {
    query = query.not('format', 'ilike', '%video%')
  }

  // Optional brand scoping for testing or focused crawls.
  // Set WORKER_PAGE_ID=355136938262536 to drain only one brand at a time.
  // Comma-separated list also supported.
  const pageIdFilter = process.env.WORKER_PAGE_ID
  if (pageIdFilter) {
    const ids = pageIdFilter.split(',').map(s => s.trim()).filter(Boolean)
    query = ids.length === 1 ? query.eq('page_id', ids[0]) : query.in('page_id', ids)
  }

  const { data, error } = await query
  if (error) {
    console.error('❌ DB claim error:', error.message)
    return []
  }
  return (data || []) as AdRow[]
}

/**
 * Remove a job from creative_queue once the worker reaches a TERMINAL result
 * (success or give-up). Transient failures are NOT dequeued — they're re-claimed
 * after the 3-min stale window. No-op (best-effort) if the queue isn't migrated.
 */
export async function dequeue(adId: string): Promise<void> {
  const { error } = await (supabase as any).from('creative_queue').delete().eq('ad_id', adId)
  if (error && !/relation .*creative_queue.* does not exist|PGRST205|404/i.test(error.message || '')) {
    console.warn(`  ⚠️  dequeue failed for ${adId}:`, error.message)
  }
}

/**
 * Batched dequeue — DELETE many creative_queue rows in ONE round-trip (one COMMIT)
 * instead of one-DELETE-per-ad. Collapses the drain's fsync storm: with N consumers
 * each doing a per-ad DELETE, we were paying ~1 fsync per ad; batching a flush window
 * of ~100 ads turns that into ~1 fsync per 100. Safe because claim_creative_queue uses
 * a 3-min stale-reclaim window, so a not-yet-deleted claimed row is never re-handed out
 * inside the sub-second flush interval. No durability trade-off (unlike synchronous_commit=off).
 */
export async function dequeueMany(adIds: string[]): Promise<void> {
  if (adIds.length === 0) return
  const { error } = await (supabase as any).from('creative_queue').delete().in('ad_id', adIds)
  if (error && !/relation .*creative_queue.* does not exist|PGRST205|404/i.test(error.message || '')) {
    console.warn(`  ⚠️  dequeueMany failed (${adIds.length} ads):`, error.message)
  }
}

/**
 * Batched terminal-failure mark — one UPDATE for many ads instead of one-per-ad.
 */
export async function markExtractionFailedMany(adIds: string[]): Promise<void> {
  if (adIds.length === 0) return
  const { error } = await (supabase as any)
    .from('discovery_ads_index')
    .update({ creative_extraction_failed_at: new Date().toISOString() })
    .in('ad_id', adIds)
  if (error) console.warn(`  ⚠️  markExtractionFailedMany (${adIds.length} ads):`, error.message)
}

export async function updateAdCreative(
  adId: string,
  thumbnailUrl: string | null,
  videoUrl: string | null,
  imageHash?: string | null,
  videoHash?: string | null,
): Promise<void> {
  if (!thumbnailUrl && !videoUrl && !imageHash && !videoHash) return
  const update: Record<string, string> = {}
  if (thumbnailUrl) update.thumbnail_url = thumbnailUrl
  if (videoUrl) update.video_url = videoUrl
  if (imageHash) update.image_hash = imageHash
  if (videoHash) update.video_hash = videoHash

  const { error } = await (supabase as any)
    .from('discovery_ads_index')
    .update(update)
    .eq('ad_id', adId)
  if (error) console.warn(`  ⚠️  DB update failed for ${adId}:`, error.message)
}

/**
 * Look up an existing R2 URL for a given hash. Checks both the new
 * discovery_creatives table (carousels) and the legacy main-table columns.
 */
export async function findExistingByHash(
  hash: string,
  type: 'image' | 'video',
): Promise<string | null> {
  // Check new creatives table first
  const { data: creative } = await (supabase as any)
    .from('discovery_creatives')
    .select('r2_url')
    .eq('hash', hash)
    .eq('asset_type', type)
    .limit(1)
    .maybeSingle()
  if (creative?.r2_url) return creative.r2_url

  // Fall back to legacy columns
  const hashCol = type === 'image' ? 'image_hash' : 'video_hash'
  const urlCol = type === 'image' ? 'thumbnail_url' : 'video_url'
  const { data, error } = await (supabase as any)
    .from('discovery_ads_index')
    .select(urlCol)
    .eq(hashCol, hash)
    .not(urlCol, 'is', null)
    .limit(1)
    .maybeSingle()
  if (error || !data) return null
  return (data as any)[urlCol] || null
}

export interface CreativeInsert {
  ad_id: string
  position: number
  asset_type: 'image' | 'video'
  r2_url: string
  hash: string | null
  width?: number | null    // original pixel dims (images) → no-reflow grid
  height?: number | null
  poster_url?: string | null   // video poster frame (FB preview, re-hosted to R2)
}

/**
 * Save all creatives for an ad. Idempotent on (ad_id, position, asset_type).
 */
export async function saveCreatives(rows: CreativeInsert[]): Promise<void> {
  if (rows.length === 0) return
  const { error } = await (supabase as any)
    .from('discovery_creatives')
    .upsert(rows, { onConflict: 'ad_id,position,asset_type' })
  if (error) console.warn(`  ⚠️  saveCreatives failed:`, error.message)
}

export async function getQueueDepth(): Promise<number> {
  // O(pending): just count the work-queue (a few thousand rows), not the old
  // O(corpus) thumbnail_url-IS-NULL scan over discovery_ads_index (which timed out
  // → -1 at 700K). Falls back to the legacy scan if creative_queue isn't migrated.
  const { count, error } = await (supabase as any)
    .from('creative_queue')
    .select('*', { count: 'exact', head: true })
  if (!error && count != null) return count
  const { count: legacy } = await (supabase as any)
    .from('discovery_ads_index')
    .select('*', { count: 'exact', head: true })
    .is('thumbnail_url', null).is('video_url', null)
    .is('creative_extraction_failed_at', null).not('snapshot_url', 'is', null)
  return legacy ?? -1
}

/**
 * Mark an ad as failed-to-extract so we stop retrying it forever.
 * Common reasons: ad deactivated, snapshot access token expired.
 */
export async function markExtractionFailed(adId: string): Promise<void> {
  const { error } = await (supabase as any)
    .from('discovery_ads_index')
    .update({ creative_extraction_failed_at: new Date().toISOString() })
    .eq('ad_id', adId)
  if (error) console.warn(`  ⚠️  markExtractionFailed for ${adId}:`, error.message)
}

export interface HeartbeatPayload {
  worker_id: string
  hostname: string
  session_started_at: string  // ISO
  session_processed: number
  session_succeeded: number
  session_failed: number
  last_batch_size: number
  last_batch_seconds: number
  ads_per_min: number
}

/**
 * Upsert this worker's heartbeat. Idempotent on worker_id.
 * Failures are logged but don't break the loop — heartbeats are best-effort.
 */
export async function writeHeartbeat(payload: HeartbeatPayload): Promise<void> {
  const { error } = await (supabase as any)
    .from('worker_heartbeats')
    .upsert(
      {
        ...payload,
        last_active_at: new Date().toISOString(),
      },
      { onConflict: 'worker_id' },
    )
  if (error) console.warn('  ⚠️  heartbeat write failed:', error.message)
}
