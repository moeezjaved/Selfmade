/**
 * POST /api/ads/action — the one endpoint behind "run your ads by typing".
 *   { mode:'plan', message, attach? }  → a confirm card (or a clarifying question) — NO write.
 *   { mode:'execute', action }         → the founder approved the card → perform the write.
 * Auth = the logged-in founder; all writes hit their own connected Meta account.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { planAction, executeAction } from '@/lib/mello/ads-actions'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))

  if (body.mode === 'plan') {
    if (!body.message || typeof body.message !== 'string') return NextResponse.json({ error: 'Tell me what to do with your ads.' }, { status: 400 })
    const res = await planAction(user.id, { message: body.message, attach: body.attach })
    return NextResponse.json(res)
  }
  if (body.mode === 'execute') {
    if (!body.action || typeof body.action !== 'object') return NextResponse.json({ error: 'Nothing to execute.' }, { status: 400 })
    const res = await executeAction(user.id, body.action)
    return NextResponse.json(res, { status: 'ok' in res && res.ok ? 200 : 400 })
  }
  return NextResponse.json({ error: 'Unknown mode.' }, { status: 400 })
}
