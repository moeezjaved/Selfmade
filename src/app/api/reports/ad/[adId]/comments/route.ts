/**
 * GET /api/reports/ad/[adId]/comments — comments left on the ad's underlying Page post (Meta).
 *
 * Reading comments on a Page post requires a PAGE access token with pages_read_engagement — the user
 * (ad) token usually can't. So we: resolve the ad → effective_object_story_id ("{pageId}_{postId}") →
 * fetch the user's Pages via /me/accounts (pages_show_list) → use that Page's token to read the post's
 * comments (pages_read_engagement). Degrades gracefully to [] with a reason the UI can render.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveScopedAccount } from '@/lib/meta/scope'
import { decryptToken } from '@/lib/meta/client'

export const dynamic = 'force-dynamic'
const V = process.env.META_API_VERSION || 'v20.0'

export async function GET(_req: NextRequest, { params }: { params: { adId: string } }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  let acct: any
  try { acct = await resolveScopedAccount(admin, user.id) } catch { acct = null }
  if (!acct?.account_id) return NextResponse.json({ comments: [], reason: 'no_account' })
  const userToken = decryptToken(acct.access_token)

  try {
    // 1) Ad → the underlying Page post id ("{pageId}_{postId}").
    const ad = await fetch(`https://graph.facebook.com/${V}/${params.adId}?fields=creative{effective_object_story_id}&access_token=${userToken}`).then(r => r.json())
    const postId: string | undefined = ad?.creative?.effective_object_story_id
    if (!postId || !postId.includes('_')) return NextResponse.json({ comments: [], reason: 'no_post' })
    const pageId = postId.split('_')[0]

    // 2) Find the Page's access token (pages_show_list) — Page-post comments need a Page token.
    let pageToken = userToken
    try {
      const pages = await fetch(`https://graph.facebook.com/${V}/me/accounts?fields=id,access_token&limit=200&access_token=${userToken}`).then(r => r.json())
      const match = (pages?.data || []).find((p: any) => String(p.id) === String(pageId))
      if (match?.access_token) pageToken = match.access_token
    } catch { /* fall back to the user token */ }

    // 3) Read the post's comments (pages_read_engagement).
    const res = await fetch(`https://graph.facebook.com/${V}/${postId}/comments?fields=message,from,created_time,like_count&limit=50&order=reverse_chronological&access_token=${pageToken}`).then(r => r.json())
    if (res?.error) return NextResponse.json({ comments: [], reason: res.error.code === 200 ? 'no_page_access' : 'unavailable' })
    const comments = (res?.data || []).filter((c: any) => c.message).map((c: any) => ({
      id: c.id, message: c.message, author: c.from?.name || 'Facebook user', at: c.created_time, likes: c.like_count || 0,
    }))
    return NextResponse.json({ comments, reason: comments.length ? 'ok' : 'none' })
  } catch {
    return NextResponse.json({ comments: [], reason: 'unavailable' })
  }
}
