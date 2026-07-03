/**
 * Iterative ad edit — the chat-style "tweak this creative" loop (Imaginetive-style).
 * POST { image (data: URL or http URL), instruction, tier?:'default'|'pro' }
 *   → reserve image_edit credits → Nano Banana edits the CURRENT image per the instruction →
 *     commit (or refund on failure) → return { image } (data URL). One edit = one charge.
 * Keeps everything else identical; only applies the requested change — so users can iterate
 * cheaply toward a final creative without re-cloning from scratch each time.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { generateImage, geminiEnabled } from '@/lib/gemini/image'
import { saveGeneration } from '@/lib/creatives'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
export const runtime = 'nodejs'

async function toB64(src: string, fallbackMime = 'image/png'): Promise<{ mimeType: string; dataB64: string } | null> {
  const m = /^data:([^;]+);base64,([\s\S]*)$/i.exec(src)
  if (m) return { mimeType: m[1] || fallbackMime, dataB64: m[2] }
  if (/^https?:\/\//i.test(src)) {
    try {
      const r = await fetch(src)
      if (!r.ok) return null
      return { mimeType: r.headers.get('content-type') || fallbackMime, dataB64: Buffer.from(await r.arrayBuffer()).toString('base64') }
    } catch { return null }
  }
  return null
}

function buildEditPrompt(instruction: string): string {
  return [
    `Edit this advertising image. Apply ONLY this change: "${instruction}".`,
    `Keep EVERYTHING else identical — the layout, composition, product (its exact shape, packaging, label, and colors), all other text, and the overall style.`,
    `Do not redesign or restyle anything that the instruction did not ask to change.`,
    `Output ONE photorealistic, ad-ready image at the same aspect ratio, with legible text.`,
  ].join(' ')
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!geminiEnabled) return NextResponse.json({ error: 'Image generation not configured (GEMINI_API_KEY)' }, { status: 503 })

  const { image, instruction, tier, parentId, brandId } = await req.json().catch(() => ({}))
  if (!image || !instruction?.trim()) return NextResponse.json({ error: 'image and instruction required' }, { status: 400 })
  const useTier: 'default' | 'pro' = tier === 'pro' ? 'pro' : 'default'
  const action = useTier === 'pro' ? 'image_edit_pro' : 'image_edit'

  const admin = createAdminClient()
  const { data: tx, error: rErr } = await admin.rpc('reserve_credits', { p_user: user.id, p_action: action })
  if (rErr) {
    const insufficient = String(rErr.message || '').includes('insufficient_credits')
    return NextResponse.json({ error: insufficient ? 'insufficient_credits' : 'reserve_failed' }, { status: insufficient ? 402 : 500 })
  }
  const txId = Array.isArray(tx) ? tx[0]?.id : (tx as any)?.id
  const refund = async () => { if (txId) await admin.rpc('refund_credits', { p_tx: txId }).then(() => {}, () => {}) }

  try {
    const cur = await toB64(String(image))
    if (!cur) { await refund(); return NextResponse.json({ error: 'could not read the current image' }, { status: 422 }) }

    const gen = await generateImage(buildEditPrompt(String(instruction).trim()), [cur], useTier)
    if (!gen.ok) { await refund(); return NextResponse.json({ error: gen.error }, { status: 502 }) }

    if (txId) await admin.rpc('commit_credits', { p_tx: txId }).then(() => {}, () => {})

    const saved = await saveGeneration({
      userId: user.id, dataB64: gen.dataB64, mimeType: gen.mimeType, type: 'edit', tier: useTier,
      brandId: brandId || null, parentId: parentId || null, prompt: String(instruction).trim(),
    })
    return NextResponse.json({ image: `data:${gen.mimeType};base64,${gen.dataB64}`, url: saved?.url || null, generationId: saved?.id || null, tier: useTier })
  } catch (e: any) {
    await refund()
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 })
  }
}
