/**
 * POST /api/discovery/clone-video/keyframe  { jobId, sceneIndex, action?, look? }
 * Generates a cheap image KEYFRAME for one storyboard scene — recreating the source beat's composition
 * with the user's product + a fresh (legal) creator, NOT the competitor's pixels. The founder approves
 * the look scene-by-scene before paying video prices; on generate, the worker animates these keyframes.
 * Stores the URL at clone_meta.beat_sheet.beats[i].preview. Only valid on a job in review.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { generateImage, geminiEnabled, geminiImageMime } from '@/lib/gemini/image'
import { uploadBufferToR2 } from '@/lib/r2'

export const dynamic = 'force-dynamic'
export const maxDuration = 120
export const runtime = 'nodejs'

// Turn whatever the user typed (or the auto-derived scene brief) into a concrete, filmable SHOT for
// the image model — users write "person holding facewash"; the model needs shot type + framing +
// product handling + lighting. Grounds it in the product, keeps faces likeness-safe, stays one line.
// Best-effort: if the LLM is unavailable/errors, we fall back to the raw brief unchanged.
async function enhanceShot(brief: string, ctx: { role?: string; scriptLine?: string; productName?: string; isService?: boolean; look?: string }): Promise<string> {
  const key = process.env.OPENAI_API_KEY
  if (!key || !brief.trim()) return brief
  const roleHint = ctx.role === 'hook' ? 'This is the HOOK — a creator/person on camera is ideal.'
    : ctx.role === 'cta' ? 'This is the CTA — end on the product, in-hand or hero.' : 'This is a body/demo beat.'
  const sys = 'You direct ONE shot for a short vertical (9:16) UGC/ad video. Turn the user’s rough idea into a single, concrete, filmable shot description an image model can render as the FIRST FRAME of a clip. '
    + 'Specify: shot type (close-up / medium / wide / over-the-shoulder), framing, the subject’s exact action with the product, and lighting/mood. '
    + (ctx.isService ? 'This is a SERVICE/app — no physical product; lead with the person or an on-phone view. ' : `Keep the product ("${ctx.productName || 'the product'}") exactly as-is, at TRUE real-world size (a small handheld item stays small in the hand, never enlarged). If the idea names a competitor's product/brand, replace it with "${ctx.productName || 'the product'}". `)
    + 'If a person appears, frame to AVOID a clear front-facing face (chin-down, side, or over-the-shoulder) for likeness safety. No on-screen text, no logos. '
    + 'Return ONLY the shot description, one sentence, max 45 words.'
  const user = `Rough idea: "${brief}".${ctx.scriptLine ? ` They say: "${ctx.scriptLine.slice(0, 160)}".` : ''} ${roleHint}${ctx.look && ctx.look.toLowerCase() !== 'match' ? ` Cast a ${ctx.look} person.` : ''}`
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.OPENAI_MODEL_MINI || 'gpt-4o-mini', temperature: 0.6, max_tokens: 120, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }] }),
      signal: AbortSignal.timeout(15000),
    })
    if (!r.ok) return brief
    const j = await r.json()
    const out = String(j?.choices?.[0]?.message?.content || '').trim().replace(/^["']|["']$/g, '')
    return out.length >= 8 ? out.slice(0, 400) : brief
  } catch { return brief }
}

async function fetchImageB64(url: string): Promise<{ mimeType: string; dataB64: string } | null> {
  try {
    const u = /^\/\/[^/]/.test(url) ? `https:${url}` : url
    if (!/^https?:\/\//i.test(u)) return null
    const r = await fetch(u, { signal: AbortSignal.timeout(15000) })
    if (!r.ok) return null
    const buf = Buffer.from(await r.arrayBuffer())
    const mime = geminiImageMime(r.headers.get('content-type'), buf)
    return mime ? { mimeType: mime, dataB64: buf.toString('base64') } : null
  } catch { return null }
}

export async function POST(req: NextRequest) {
  if (!geminiEnabled) return NextResponse.json({ error: 'image generation unavailable' }, { status: 503 })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const b = await req.json().catch(() => ({}))
  const jobId = b?.jobId ? String(b.jobId) : null
  const sceneIndex = Number.isInteger(b?.sceneIndex) ? b.sceneIndex : null
  if (!jobId || sceneIndex == null || sceneIndex < 0) return NextResponse.json({ error: 'jobId and sceneIndex required' }, { status: 400 })

  const admin = createAdminClient()
  const { data: row } = await admin.from('creative_generations').select('id, clone_meta').eq('id', jobId).eq('user_id', user.id).maybeSingle()
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const meta = (row as any).clone_meta || {}
  const beat = meta.beat_sheet || {}
  const beats: any[] = Array.isArray(beat.beats) ? beat.beats : []
  // Single-take UGC analyzes with no beats; the storyboard synthesizes scene cards, so a preview can
  // target an index that has no beat row yet. Pad the array so the preview always has a slot to persist.
  while (beats.length <= sceneIndex) beats.push({ action: '' })
  const action = String(b?.action || b?.scriptLine || beats[sceneIndex]?.action || beats[sceneIndex]?.scriptLine || 'Opening shot').slice(0, 300)
  const look = String(b?.look || meta.character_look || '').trim()
  const productName = meta.product_details?.name || meta.brand_name || ''

  // Product photos ground the render (pixel-perfect product). Cap 3.
  const rawImgs: string[] = Array.isArray(meta.product_image_urls) ? meta.product_image_urls.slice(0, 3) : []
  const productImgs = (await Promise.all(rawImgs.map(fetchImageB64))).filter(Boolean) as { mimeType: string; dataB64: string }[]

  // CLOSEST-TO-REFERENCE: the analysis grabbed the source ad's real frame at this beat (beats[i].thumb).
  // Feed it as a COMPOSITION guide so the keyframe tracks the reference shot-for-shot (framing, angle,
  // subject placement) — while we REPLACE the person with an original creator and swap in the user's
  // product, never reproducing the competitor's pixels or a real face.
  const refFrameUrl = beats[sceneIndex]?.thumb || null
  const refFrame = refFrameUrl ? await fetchImageB64(refFrameUrl) : null

  // SAME PERSON across scenes: once an earlier scene's keyframe exists, use it as a character lock so
  // scene 2/3 aren't a DIFFERENT-looking creator (a UGC/cinematic ad needs one consistent presenter).
  let charLock: { mimeType: string; dataB64: string } | null = null
  if (sceneIndex > 0) {
    for (let j = sceneIndex - 1; j >= 0; j--) {
      if (beats[j]?.preview) { charLock = await fetchImageB64(beats[j].preview); if (charLock) break }
    }
  }

  const isService = meta.product_type === 'service' || meta.product_type === 'app'
  // The reference creator's look (hair colour, age, wardrobe…) + setting, captured by the analysis —
  // so the preview matches the reference person AND stays the SAME person across every scene.
  const avatar = String(beat.avatar || '').trim().slice(0, 240)
  const setting = String(beat.setting || '').trim().slice(0, 160)
  const creatorClause = look && look.toLowerCase() !== 'match'
    ? `If a person is on camera, cast a ${look} creator${avatar ? `, keeping the reference creator's age range, hair style and wardrobe vibe (${avatar})` : ''} — the SAME person in every scene.`
    : avatar
      ? `If a person is on camera, they MUST match the reference creator exactly — ${avatar} — copying gender, age, ethnicity, hair (colour + style) and wardrobe; the SAME person appears in every scene.`
      : 'Cast whatever people the scene naturally needs (or none), kept consistent across scenes.'
  const productClause = isService || !productImgs.length
    ? 'This is a service/brand — do NOT invent a physical product; lead with the person, setting, or an on-phone app view.'
    : `Render the user's product${productName ? ` ("${productName}")` : ''} 1:1 — exact silhouette, label, materials — at its TRUE real-world size relative to the hand/body (a small handheld item stays small in the hand, NEVER enlarged, stretched or out of proportion). Do NOT reshape or invent a different product.`
  // The analysis may name the COMPETITOR's product in the shot text (e.g. "FÜM device") — that always
  // means the USER's product here. Never render a competitor's product, name or logo.
  const brandNeutral = productName ? `Any product named in the shot refers to "${productName}" (the user's product) — never a competitor's product, brand name or logo.` : 'Any product named in the shot is the user\'s product — never a competitor\'s brand or logo.'
  // When a same-creator lock exists it OVERRIDES the descriptive clause — keep that exact person.
  const personClause = charLock
    ? 'The on-camera person MUST be the EXACT SAME creator shown in the same-creator reference image — match their face, hair, skin tone and wardrobe precisely; it is the same person throughout the video.'
    : creatorClause

  // Mello upgrades the raw shot brief into a proper filmable direction before the model sees it —
  // users write "person holding facewash"; this makes it a real shot (framing, action, lighting).
  const shot = await enhanceShot(action, { role: beats[sceneIndex]?.role || (sceneIndex === 0 ? 'hook' : ''), scriptLine: b?.scriptLine || beats[sceneIndex]?.scriptLine, productName, isService, look })

  // Assemble reference images in a FIXED order and describe each by position so the model can't
  // confuse them: composition ref → same-creator ref → product photo(s).
  const genImages: { mimeType: string; dataB64: string }[] = []
  const legend: string[] = []
  if (refFrame) { genImages.push(refFrame); legend.push(`Image ${genImages.length} = COMPOSITION reference (match its framing/angle/layout ONLY; replace the person + product, never copy its pixels or a real face).`) }
  if (charLock) { genImages.push(charLock); legend.push(`Image ${genImages.length} = the SAME CREATOR to keep — match this person's face, hair, skin tone and wardrobe exactly.`) }
  if (!isService && productImgs.length) {
    const first = genImages.length + 1
    for (const p of productImgs) genImages.push(p)
    legend.push(`Image${productImgs.length > 1 ? 's' : ''} ${first}${productImgs.length > 1 ? `–${genImages.length}` : ''} = the user's product (render 1:1, true real-world size).`)
  }

  const prompt = [
    `Create ONE photorealistic vertical 9:16 video KEYFRAME — the FIRST FRAME of a short video clip.`,
    legend.length ? `Attached reference images, in order — ${legend.join(' ')}` : '',
    refFrame
      ? `Recreate the COMPOSITION reference's framing, angle, distance and background layout — but make it an ORIGINAL image: give the on-camera person a NEW face (never reproduce the real person) while KEEPING THE SAME gender, age range, ethnicity, hair and build as the person shown in the reference — do NOT change a man to a woman or vice-versa. Swap in the user's product. Recreate the SHOT, not the pixels.`
      : `Match the scene's shot type (close-up / wide / over-the-shoulder), framing and energy as an ORIGINAL image (never copy any real person's face).`,
    `SCENE TO RECREATE: ${shot}.`,
    setting ? `Setting (match the reference): ${setting}.` : '',
    productClause,
    brandNeutral,
    personClause,
    `Natural, real, ad-quality lighting. Leave headroom for motion. NO on-screen text, NO captions, NO watermark, NO other brand's logo.`,
  ].filter(Boolean).join(' ')

  // The keyframe seeds the final video (the worker animates the approved one), so it uses the PRO model
  // for product fidelity — the standard model's weaker results would carry straight into the clip. We
  // only trim RESOLUTION to 1K (not 2K): resolution is independent of model quality and 1K is already
  // above a 720p frame, so it's faster + lighter on quota with no visible loss once it's moving video.
  const gen = await generateImage(prompt, genImages, 'pro', { aspectRatio: '9:16', imageSize: '1K' })
  if (!gen.ok) return NextResponse.json({ error: gen.error === 'pro_model_busy' ? 'The image model is busy — top up the Gemini billing or try again in a moment.' : gen.error }, { status: 502 })

  const url = await uploadBufferToR2(Buffer.from(gen.dataB64, 'base64'), `creatives/keyframes/${jobId}/${sceneIndex}-${Date.now()}.jpg`, gen.mimeType)
  if (!url) return NextResponse.json({ error: 'could not store the keyframe' }, { status: 500 })

  // Persist the preview AND the (possibly user-edited) shot description onto the beat, so a reload keeps
  // the image and the cinematic render animates exactly the shot the user described here.
  if (beats[sceneIndex]) {
    beats[sceneIndex].preview = url
    if (b?.action) beats[sceneIndex].action = String(b.action).slice(0, 300)   // keep the user's raw text in the field
    beats[sceneIndex].shot_prompt = shot                                        // the enhanced direction (for the render)
  }
  const nextMeta = { ...meta, beat_sheet: { ...beat, beats } }
  await admin.from('creative_generations').update({ clone_meta: nextMeta }).eq('id', jobId).eq('user_id', user.id)

  return NextResponse.json({ ok: true, sceneIndex, preview: url })
}
