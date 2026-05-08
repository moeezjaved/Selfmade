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
  // Use `any` to dodge Supabase's overly-deep generic chain
  let query: any = supabase
    .from('discovery_ads_index')
    .select('ad_id, snapshot_url, format, page_name')
    .not('snapshot_url', 'is', null)
    .is('thumbnail_url', null)
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
): Promise<void> {
  if (!thumbnailUrl && !videoUrl) return
  const update: Record<string, string> = {}
  if (thumbnailUrl) update.thumbnail_url = thumbnailUrl
  if (videoUrl) update.video_url = videoUrl

  const { error } = await supabase
    .from('discovery_ads_index')
    .update(update)
    .eq('ad_id', adId)
  if (error) console.warn(`  ⚠️  DB update failed for ${adId}:`, error.message)
}

export async function getQueueDepth(): Promise<number> {
  const { count, error } = await supabase
    .from('discovery_ads_index')
    .select('*', { count: 'exact', head: true })
    .is('thumbnail_url', null)
    .not('snapshot_url', 'is', null)
  if (error) return -1
  return count ?? 0
}
