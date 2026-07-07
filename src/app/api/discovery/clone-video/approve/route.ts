/**
 * Approve a drafted video clone → spend credits + generate. POST { jobId, script? }.
 * Only valid on a job in status='review' (the worker has produced a draft script). Reserves the
 * video_clone credits, stores the final (possibly edited) script, and flips the row to
 * status='processing' so the worker generates the video. Refund is handled by the worker on failure.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { jobId, script } = await req.json().catch(() => ({}))
  if (!jobId) return NextResponse.json({ error: 'jobId required' }, { status: 400 })

  const admin = createAdminClient()
  const { data: row } = await admin
    .from('creative_generations')
    .select('id, user_id, status, clone_meta')
    .eq('id', jobId).eq('user_id', user.id).eq('type', 'video_clone')
    .maybeSingle()
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if ((row as any).status !== 'review') return NextResponse.json({ error: `job is ${(row as any).status}, not awaiting approval` }, { status: 409 })

  const meta = (row as any).clone_meta || {}
  const action = meta.tier === 'fast' ? 'video_clone_fast' : 'video_clone'

  // Reserve now — this is the billable moment (the user has approved the script).
  const { data: tx, error: rErr } = await admin.rpc('reserve_credits', { p_user: user.id, p_action: action })
  if (rErr) {
    const insufficient = String(rErr.message || '').includes('insufficient_credits')
    return NextResponse.json({ error: insufficient ? 'insufficient_credits' : 'reserve_failed' }, { status: insufficient ? 402 : 500 })
  }
  const txId = Array.isArray(tx) ? tx[0]?.id : (tx as any)?.id

  const finalScript = (typeof script === 'string' && script.trim()) ? script.trim() : (meta.script || '')
  const { error } = await admin.from('creative_generations').update({
    status: 'processing', credit_tx: txId, clone_meta: { ...meta, final_script: finalScript },
  }).eq('id', jobId).eq('user_id', user.id)

  if (error) {
    if (txId) await admin.rpc('refund_credits', { p_tx: txId }).then(() => {}, () => {})
    return NextResponse.json({ error: 'could not start generation' }, { status: 500 })
  }
  return NextResponse.json({ jobId, status: 'processing' })
}
