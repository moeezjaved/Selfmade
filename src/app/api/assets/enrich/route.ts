/**
 * Enrich one asset — caption + embedding, and for videos the clip attributes (scene / captions /
 * audio / a-b-roll) via Gemini video understanding (spec §10.3). Charges 1 credit per asset (Atria
 * parity; 1 credit ≫ the Gemini cost → well past 100% profit). Called right after upload; the asset
 * shows 'processing' until done. Idempotent + no double-charge.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getUserOrg } from '@/lib/org'
import { enrichAsset } from '@/lib/assets/enrich'
import { reserveCredits, commitCredits, refundCredits, InsufficientCreditsError } from '@/lib/credits'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300   // video analysis (fetch + Gemini) can take a while

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await req.json().catch(() => ({}))
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const admin = createAdminClient() as any
  const org = await getUserOrg(admin, user.id)
  const { data: a } = await admin.from('assets').select('id, org_id, file_url, mime, file_type, file_name, size_bytes, ai_caption, status').eq('id', id).maybeSingle()
  if (!a || a.org_id !== org.orgId) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  // Already tagged → don't re-charge or re-run.
  if (a.status === 'ready' && a.ai_caption) return NextResponse.json({ ok: true, alreadyTagged: true })

  // Charge 1 credit (org-pooled wallet). Insufficient → mark ready-untagged so the asset still shows.
  let txId: string | null = null
  try {
    const tx = await reserveCredits(admin, user.id, 'asset_ai_tag', a.id)
    txId = tx.id
  } catch (e) {
    if (e instanceof InsufficientCreditsError) {
      await admin.from('assets').update({ status: 'ready' }).eq('id', id).eq('org_id', org.orgId)
      return NextResponse.json({ error: 'insufficient_credits', message: 'Out of credits — asset saved without AI tagging.' }, { status: 402 })
    }
    // credits misconfigured → still enrich (don't block on billing)
  }

  try {
    const r = await enrichAsset(a)
    await admin.from('assets').update({
      ai_caption: r.ai_caption, embedding: r.embedding,
      has_captions: r.has_captions ?? null, audio_kind: r.audio_kind ?? null, scene: r.scene ?? null, roll: r.roll ?? null,
      status: 'ready',
    }).eq('id', id).eq('org_id', org.orgId)
    if (txId) await commitCredits(admin, txId, { asset: a.id, kind: a.file_type }).catch(() => {})
    return NextResponse.json({ ok: true, captioned: !!r.ai_caption, embedded: !!r.embedding, video: a.file_type === 'video' })
  } catch (e: any) {
    if (txId) await refundCredits(admin, txId).catch(() => {})
    await admin.from('assets').update({ status: 'ready' }).eq('id', id).eq('org_id', org.orgId)
    return NextResponse.json({ error: e?.message || 'enrich_failed' }, { status: 500 })
  }
}
