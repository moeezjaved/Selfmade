/**
 * GET /api/reports/ad/[adId]/comments — comments left on the ad's underlying post (Meta).
 * Needs the effective_object_story_id + page engagement permission; returns [] gracefully otherwise.
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
  if (!acct?.account_id) return NextResponse.json({ comments: [], error: 'no_account' })
  const token = decryptToken(acct.access_token)

  try {
    const ad = await fetch(`https://graph.facebook.com/${V}/${params.adId}?fields=creative{effective_object_story_id}&access_token=${token}`).then(r => r.json())
    const postId = ad?.creative?.effective_object_story_id
    if (!postId) return NextResponse.json({ comments: [], reason: 'no_post' })
    const res = await fetch(`https://graph.facebook.com/${V}/${postId}/comments?fields=message,from,created_time,like_count&limit=50&order=reverse_chronological&access_token=${token}`).then(r => r.json())
    if (res?.error) return NextResponse.json({ comments: [], reason: 'unavailable' })
    const comments = (res?.data || []).filter((c: any) => c.message).map((c: any) => ({
      id: c.id, message: c.message, author: c.from?.name || 'User', at: c.created_time, likes: c.like_count || 0,
    }))
    return NextResponse.json({ comments })
  } catch {
    return NextResponse.json({ comments: [], reason: 'unavailable' })
  }
}
