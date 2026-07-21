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
import { isRateLimited } from '@/lib/rateLimit'

export const dynamic = 'force-dynamic'
export const maxDuration = 300  // gemini-3-pro-image at 2K can exceed 60s → 504; Pro plan allows up to 300s
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

// Does the instruction ask to change the PERSON/model (ethnicity, skin tone, age, gender, hair,
// wardrobe, "make them look…")? If so we must NOT tell the model to keep the person identical — the
// image model preserves faces aggressively, so a generic "keep everything identical" silently cancels
// the recast. We instead give it explicit permission to recast the model while locking pose/product.
function isPersonEdit(instruction: string): boolean {
  const s = instruction.toLowerCase()
  const re = /\b(person|people|model|man|men|woman|women|lady|ladies|guy|guys|girl|boy|male|female|actor|actress|talent|human|face|skin|ethnicit|ethnic|race|nationality|complexion|age|older|younger|elderly|teen|hair|beard|hijab|wardrobe|outfit|clothes|clothing|dress|desi|south\s?asian|pakistan|indian|asian|african|black|white|caucasian|arab|middle\s?eastern|latin|hispanic|europ|brown|dark\s?skin|light\s?skin)\b/i
  return re.test(s)
}

function buildEditPrompt(instruction: string): string {
  const common = [
    `Output ONE photorealistic, ad-ready image at the exact same aspect ratio, with legible text.`,
  ]
  if (isPersonEdit(instruction)) {
    // Recast the talent. Lock everything that must stay, but explicitly ALLOW the person to change.
    return [
      `Edit this advertising image by RECASTING the person shown. Apply this change to the person: "${instruction}".`,
      `You MUST change the person's appearance accordingly — this may include their ethnicity, skin tone, facial features, age, hair, and wardrobe. Fully replace the model; do NOT keep the original person's face or features if the instruction calls for a different look.`,
      `Keep IDENTICAL: the pose and body position, camera framing and crop, the product (its exact shape, packaging, label, and colors and how it is held/placed), the background, all headline/subhead/logo text, and the overall lighting and style.`,
      `The result must look like the same ad reshot with a new model — natural and photorealistic, not a face swap.`,
      ...common,
    ].join(' ')
  }
  return [
    `Edit this advertising image. Apply ONLY this change: "${instruction}".`,
    `Keep EVERYTHING else identical — the person, layout, composition, product (its exact shape, packaging, label, and colors), all other text, and the overall style.`,
    `Do not redesign or restyle anything that the instruction did not ask to change.`,
    ...common,
  ].join(' ')
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Burst guard (fail-open) — cap scripted edit floods.
  if (await isRateLimited(user.id)) return NextResponse.json({ error: 'rate_limited', message: 'Too many edits in a short time — please wait a moment and try again.' }, { status: 429 })
  if (!geminiEnabled) return NextResponse.json({ error: 'Image generation not configured (GEMINI_API_KEY)' }, { status: 503 })

  const { image, instruction, tier, parentId, brandId } = await req.json().catch(() => ({}))
  if (!image || !instruction?.trim()) return NextResponse.json({ error: 'image and instruction required' }, { status: 400 })
  // Recasting the person (ethnicity/look) is the one edit the Pro model (gemini-3-pro-image) refuses —
  // it locks the input face. The standard Nano Banana reshoots the person reliably. So person edits
  // render on the standard model; billing/action still follow the requested tier.
  // Everything (including person recasts in the tweak box) runs on the requested Pro model — no
  // standard-model fallback. isPersonEdit is kept only for the recast prompt wording. We're testing
  // whether Pro will recast in a FOCUSED edit (single change, product already placed) even though it
  // wouldn't during a full clone.
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
    if (!gen.ok) { await refund(); return NextResponse.json({ error: gen.error === 'pro_model_busy' ? 'The Pro image model is busy right now — please try again in a minute. You weren’t charged.' : gen.error }, { status: 502 }) }

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
