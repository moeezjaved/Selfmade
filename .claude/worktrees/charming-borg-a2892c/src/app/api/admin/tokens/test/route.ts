/**
 * POST /api/admin/tokens/test  { id }
 * Pings Meta /me with the stored token to verify it's still healthy.
 * Free call — does NOT count against ads_archive rate limit.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { decryptToken } from '@/lib/meta/client'

export const dynamic = 'force-dynamic'
const V = process.env.META_API_VERSION || 'v20.0'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const admin = createAdminClient()
  const { data: row } = await (admin as any)
    .from('indexer_tokens')
    .select('access_token, label')
    .eq('id', id)
    .single()
  if (!row) return NextResponse.json({ error: 'token not found' }, { status: 404 })

  let plain = ''
  try { plain = decryptToken(row.access_token) } catch { return NextResponse.json({ ok: false, error: 'decrypt failed' }) }
  if (!plain) return NextResponse.json({ ok: false, error: 'decrypt returned empty' })

  try {
    const res = await fetch(
      `https://graph.facebook.com/${V}/me?fields=id,name&access_token=${encodeURIComponent(plain)}`,
      { signal: AbortSignal.timeout(10_000) },
    )
    const data = await res.json()
    if (data.error) return NextResponse.json({ ok: false, error: data.error.message })
    return NextResponse.json({ ok: true, name: data.name, id: data.id, label: row.label })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e.message ?? e) })
  }
}
