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
}

/**
 * Atomically claim a batch of ads to process.
 * Uses .order().limit() since Supabase doesn't expose row-level locking via PostgREST.
 * Race-safe enough since we update thumbnail_url to a sentinel right after fetching.
 */
export async function claimAds(batchSize: number, imagesOnly: boolean): Promise<AdRow[]> {
  // Need ads that have NEITHER an R2 thumbnail NOR an R2 video,
  // AND haven't already been marked as un-extractable.
  let query: any = supabase
    .from('discovery_ads_index')
    .select('ad_id, snapshot_url, format, page_name')
    .not('snapshot_url', 'is', null)
    .is('thumbnail_url', null)
    .is('video_url', null)
    .is('creative_extraction_failed_at', null)
    .order('last_seen', { ascending: false })
    .limit(batchSize)

  if (imagesOnly) {
    query = query.not('format', 'ilike', '%video%')
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
