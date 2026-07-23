/**
 * POST /api/knowledge/track — the invisible Trail's collector.
 * Upserts one row per browsing session (session_key from the client) with the full
 * hop path + depth. Works logged-in AND anonymous (user_id null) — public knowledge
 * pages are part of the funnel. Service-role writes; table is not client-readable.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const key = String(body?.session_key || '')
    const path = Array.isArray(body?.path) ? body.path.map((p: any) => String(p)).slice(0, 60) : []
    if (!/^t_[a-z0-9]{6,40}$/.test(key) || !path.length) return NextResponse.json({ ok: false }, { status: 400 })

    let userId: string | null = null
    try {
      const supabase = await createClient()
      const { data: { user } } = await supabase.auth.getUser()
      userId = user?.id || null
    } catch { /* anonymous is fine */ }

    const admin = createAdminClient() as any
    await admin.from('knowledge_paths').upsert(
      { session_key: key, user_id: userId, path, depth: path.length, updated_at: new Date().toISOString() },
      { onConflict: 'session_key' },
    )
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false }, { status: 200 })  // telemetry never errors loudly
  }
}
