/**
 * Save an ad captured by the Chrome extension from Instagram / Facebook Ad Library / TikTok / any
 * page. API-key (Bearer) authed. Unlike the internal /api/discovery/saved (which needs an internal
 * `ad_id`), this accepts an EXTERNAL creative by URL + metadata and persists it:
 *
 *  1. Resolve user → org (saves stamp org_id so team boards aggregate — spec §10.2).
 *  2. Pick the target board: the given board_id (if it belongs to the user/org) else a find-or-create
 *     personal "Saved from Web" board.
 *  3. Persist the media so it survives Instagram/TikTok CDN expiry: prefer the base64 the content
 *     script already fetched in-page (image_data), else best-effort server-side download. Falls back
 *     to the original URL if R2 isn't configured or the fetch is blocked.
 *  4. Upsert into discovery_saved_ads with a deterministic synthetic ad_id so re-saving is a no-op.
 */
import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getUserOrg } from '@/lib/org'
import { userIdFromExtensionToken } from '@/lib/extension-auth'
import { uploadToR2, uploadBufferToR2, isR2Configured } from '@/lib/r2'
import { corsJson, preflight } from '@/lib/cors'
import { createHash, randomUUID } from 'crypto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const DEFAULT_BOARD = 'Saved from Web'

export async function OPTIONS() { return preflight() }

export async function POST(request: NextRequest) {
  const userId = await userIdFromExtensionToken(request)
  if (!userId) return corsJson({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null) as any
  if (!body) return corsJson({ error: 'Invalid body' }, { status: 400 })

  const {
    media_url,            // original CDN url of the image/video
    media_type,           // 'image' | 'video'
    image_data,           // optional data: URL (base64) captured in-page for images
    source_url,           // the page the ad was saved from
    source_platform,      // 'instagram' | 'facebook' | 'tiktok' | 'web'
    brand,                // page/brand name
    ad_copy,              // caption / primary text
    was_video,            // true if the original creative was a video (we saved its poster image)
    board_id: reqBoardId, // optional target board
  } = body

  if (!media_url && !image_data) return corsJson({ error: 'media_url or image_data required' }, { status: 400 })

  const admin = createAdminClient() as any
  const org = await getUserOrg(admin, userId)

  // ── Resolve the target board ──────────────────────────────────────────────
  let boardId: string | null = null
  if (reqBoardId) {
    const { data: b } = await admin.from('discovery_boards')
      .select('id, org_id, created_by, visibility').eq('id', reqBoardId).maybeSingle()
    const ok = b && (b.created_by === userId || (b.org_id === org.orgId && b.visibility === 'team'))
    if (ok) boardId = b.id
  }
  if (!boardId) {
    // Pick the OLDEST existing "Saved from Web" board — NOT .maybeSingle(), which throws when a race
    // (rapid saves) created duplicate boards and then stranded saves in a phantom empty one.
    const { data: existing } = await admin.from('discovery_boards')
      .select('id').eq('created_by', userId).eq('name', DEFAULT_BOARD).order('created_at', { ascending: true }).limit(1)
    if (existing?.[0]?.id) boardId = existing[0].id
    else {
      const { data: created } = await admin.from('discovery_boards')
        .insert({ user_id: userId, org_id: org.orgId, name: DEFAULT_BOARD, emoji: '🌐', visibility: 'personal', created_by: userId })
        .select('id').single()
      boardId = created?.id ?? null
    }
  }
  if (!boardId) return corsJson({ error: 'Could not resolve a board' }, { status: 500 })

  // ── Persist the media (R2) ────────────────────────────────────────────────
  const isVideo = media_type === 'video'
  const ext = isVideo ? 'mp4' : 'jpg'
  const ct = isVideo ? 'video/mp4' : 'image/jpeg'
  const key = `saved/${userId}/${randomUUID()}.${ext}`
  let snapshotUrl: string = media_url || ''

  if (isR2Configured()) {
    let stored: string | null = null
    if (image_data && typeof image_data === 'string' && image_data.startsWith('data:')) {
      try {
        const b64 = image_data.split(',')[1] || ''
        const buf = Buffer.from(b64, 'base64')
        if (buf.byteLength > 500) stored = await uploadBufferToR2(buf, key, ct)
      } catch { /* fall through to url fetch */ }
    }
    if (!stored && media_url) stored = await uploadToR2(media_url, key, ct)
    if (stored) snapshotUrl = stored
  }

  // Deterministic ad_id so the same creative from the same page de-dupes on re-save.
  const adId = 'ext_' + createHash('sha1').update(`${source_url || ''}|${media_url || key}`).digest('hex').slice(0, 24)

  const { data, error } = await admin.from('discovery_saved_ads')
    .upsert({
      user_id: userId, org_id: org.orgId, board_id: boardId, ad_id: adId,
      page_name: brand || null, snapshot_url: snapshotUrl,
      ad_data: {
        source: source_platform || 'web', source_url: source_url || null,
        ad_copy: ad_copy || null, media_type: isVideo ? 'video' : 'image',
        // Poster-only video save: media is an image, but the source ad was a video → the app labels
        // it and points to Discovery for a real video remake (feed videos have no fetchable MP4).
        was_video: !isVideo && !!was_video,
        original_media_url: media_url || null, external: true,
      },
    }, { onConflict: 'user_id,board_id,ad_id' })
    .select('id').single()

  if (error) return corsJson({ error: error.message }, { status: 500 })
  return corsJson({ saved: true, id: data?.id, board_id: boardId, snapshot_url: snapshotUrl })
}
