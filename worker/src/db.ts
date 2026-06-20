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
  // ATOMIC claim via RPC (migration 030): marks rows creative_claimed_at=now()
  // with FOR UPDATE SKIP LOCKED and returns them, so concurrent/streaming claims
  // never hand out the same ad twice. This replaces the plain-SELECT claim, which
  // — under the streaming worker + Supabase pooler read-after-write lag — kept
  // returning just-processed ads and re-downloaded ~35% of them. Stale claims
  // (process died) are reclaimable after 3 min.
  if (!process.env.WORKER_PAGE_ID) {
    const { data, error } = await (supabase as any).rpc('claim_creative_ads', { p_batch: batchSize })
    if (!error && Array.isArray(data)) {
      let rows = data as AdRow[]
      if (imagesOnly) rows = rows.filter((r: any) => !/video/i.test(r.format || ''))
      return rows
    }
    // error (e.g. RPC not yet migrated) → fall through to legacy SELECT
    if (error && !/function .*claim_creative_ads.* does not exist|PGRST202|404/i.test(error.message || '')) {
      console.warn(`[claim] rpc error, falling back to SELECT: ${error.message}`)
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
  const { count, error } = await (supabase as any)
    .from('discovery_ads_index')
    .select('*', { count: 'exact', head: true })
    .is('thumbnail_url', null)
    .is('video_url', null)
    .is('creative_extraction_failed_at', null)
    .not('snapshot_url', 'is', null)
  if (error) return -1
  return count ?? 0
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
