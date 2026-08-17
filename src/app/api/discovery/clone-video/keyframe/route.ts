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
import { uploadBufferToR2, r2PublicUrl } from '@/lib/r2'

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
    // A clear front-facing face is FINE and preferred — the person is a fictional AI creator (locked by
    // the synthetic cast sheet), and fal's likeness filter blocks REAL photos, not AI-generated faces.
    // (We used to hide faces "for likeness safety" — that was wrong and hurt consistency + hook shots.)
    + 'If a person appears, frame them naturally for the shot — a hook or testimonial beat can be a clear front-facing close-up. No on-screen text, no logos. '
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
  if (!jobId) return NextResponse.json({ error: 'jobId required' }, { status: 400 })

  const admin = createAdminClient()
  const { data: row } = await admin.from('creative_generations').select('id, clone_meta').eq('id', jobId).eq('user_id', user.id).maybeSingle()
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const meta = (row as any).clone_meta || {}
  const beat = meta.beat_sheet || {}
  const beats: any[] = Array.isArray(beat.beats) ? beat.beats : []

  // ── CAST OP (storyboard Cast panel): draw or upload a locked sheet for ONE specific person (A/B/C…).
  // No sceneIndex needed — this manages the cast, not a scene keyframe. Stored in meta.cast_sheets[letter]
  // (and mirrored to meta.cast_sheet for "A" so the legacy single-creator path keeps working). ──────────
  if (b?.castOp === true && typeof b?.castLetter === 'string' && b.castLetter) {
    const letter = String(b.castLetter).toUpperCase().slice(0, 1)
    const sheets = { ...(meta.cast_sheets || {}) }
    // Which cast letter does a shot feature? Parse it the SAME way the scene keyframe path does; an
    // unlabelled shot defaults to the lead "A". Used to clear the right scenes when a person is (re)drawn.
    const sceneLetterOf = (action: string): string => {
      const m = String(action || '').match(/\b(?:person|man|woman|guy|girl|male|female|lady|dude)\s+([A-E])\b/i) || String(action || '').match(/\b([B-E])\b/)
      return m ? m[1].toUpperCase() : 'A'
    }
    // Drawing/redrawing a person's sheet must RE-LOCK their scenes to it: clear the AI keyframes of every
    // scene that features this letter (keep user-uploaded frames) so they auto-redraw against the new sheet.
    const clearedBeatsFor = (): any[] => (Array.isArray(beat.beats) ? beat.beats : []).map((bt: any) =>
      (bt && bt.preview_source !== 'user' && sceneLetterOf(bt.action || bt.scriptLine || '') === letter)
        ? { ...bt, preview: null, preview_source: null } : bt)
    // Upload-your-own person for this letter.
    const upKey = typeof b?.uploadedKey === 'string' ? b.uploadedKey.replace(/^\/+/, '') : ''
    if (upKey) {
      const publicUrl = r2PublicUrl(upKey)
      if (!publicUrl) return NextResponse.json({ error: 'could not resolve the uploaded image' }, { status: 500 })
      sheets[letter] = publicUrl
      const clearedBeats = clearedBeatsFor()
      const patch: any = { cast_sheets: sheets, beat_sheet: { ...beat, beats: clearedBeats } }
      if (letter === 'A') patch.cast_sheet = publicUrl
      await admin.from('creative_generations').update({ clone_meta: { ...meta, ...patch } }).eq('id', jobId).eq('user_id', user.id)
      return NextResponse.json({ ok: true, castLetter: letter, sheet: publicUrl, source: 'user', clearedScenes: true })
    }
    // Draw / redraw this person from their look description (from the analysis people[] list).
    const isServiceC = meta.product_type === 'service' || meta.product_type === 'app'
    if (isServiceC) return NextResponse.json({ error: 'This is a service/app ad — no on-camera person to draw.' }, { status: 400 })
    const person = (Array.isArray(beat.people) ? beat.people.find((p: any) => String(p?.id).toUpperCase() === letter) : null) || null
    const desc = String(b?.look || person?.look || (letter === 'A' ? beat.avatar : '') || '').trim()
    if (!desc) return NextResponse.json({ error: `No look description for person ${letter}.` }, { status: 400 })
    const recastLook = String(meta.character_look || '').trim()
    const recast = !!recastLook && recastLook.toLowerCase() !== 'match'
    const castPrompt = [
      'Create ONE photorealistic vertical 9:16 CHARACTER REFERENCE SHEET of a SINGLE original person — a fictional everyday creator for a UGC/social ad, NOT any real individual or celebrity.',
      // RECAST OVERRIDES ETHNICITY: when the user chose a look (e.g. "Pakistani"), that wins over the
      // reference person's ethnicity — take only gender/age/build/hair-style/wardrobe from the reference,
      // NOT their ethnicity/skin tone (else "Pakistani … but Black" contradicts and the model ignores it).
      recast
        ? `The person is ${recastLook} in appearance — this ethnicity/skin tone OVERRIDES the reference. From the reference person, keep ONLY their gender, apparent age, build, hairstyle and wardrobe (IGNORE the reference's ethnicity/skin colour): ${desc}. Give them a brand-new fictional ${recastLook} face (never a real person).`
        : `They match this person from the reference ad — gender, age, ethnicity, hair, wardrobe and build: ${desc}. Give them a brand-new fictional face (never a real person).`,
      'Compose split-frame: LEFT panel — a tight facial close-up, whole head in frame, calm neutral expression, looking into the lens, real skin texture. RIGHT panel — the SAME person, full-body front view, head-to-toe, relaxed pose, same wardrobe.',
      'Both panels are the identical person: same face, hair, skin tone, build and outfit. Plain neutral-grey seamless background, a thin vertical divider. EXACTLY ONE visible face (the close-up) — remove/soften the full-body face so there is only one face to lock onto. NO text, NO logos, NO product, NO borders.',
    ].filter(Boolean).join(' ')
    const gen = await generateImage(castPrompt, [], 'pro', { aspectRatio: '9:16', imageSize: '1K' })
    if (!gen.ok) return NextResponse.json({ error: gen.error === 'pro_model_busy' ? 'The image model is busy — try again in a moment.' : (gen.error || 'Could not draw the person') }, { status: 502 })
    const key = `creatives/cast/${jobId}-${letter}-${Date.now()}.jpg`
    const uploaded = await uploadBufferToR2(Buffer.from(gen.dataB64, 'base64'), key, gen.mimeType)
    if (!uploaded) return NextResponse.json({ error: 'upload failed' }, { status: 500 })
    sheets[letter] = uploaded
    const clearedBeats = clearedBeatsFor()
    const patch: any = { cast_sheets: sheets, beat_sheet: { ...beat, beats: clearedBeats } }
    if (letter === 'A') patch.cast_sheet = uploaded
    await admin.from('creative_generations').update({ clone_meta: { ...meta, ...patch } }).eq('id', jobId).eq('user_id', user.id)
    return NextResponse.json({ ok: true, castLetter: letter, sheet: uploaded, regenerated: true, clearedScenes: true })
  }

  if (sceneIndex == null || sceneIndex < 0) return NextResponse.json({ error: 'sceneIndex required' }, { status: 400 })
  // Single-take UGC analyzes with no beats; the storyboard synthesizes scene cards, so a preview can
  // target an index that has no beat row yet. Pad the array so the preview always has a slot to persist.
  while (beats.length <= sceneIndex) beats.push({ action: '' })

  // SET WHAT A SCENE SHOWS (storyboard 🚫/✅ toggle): flip a beat between 'hero' (your product) and
  // 'rejected' (the rival/bad item, e.g. a vape) — so the user can say "show the vape here, not Aura".
  // Clears the scene's AI preview so it redraws with the new intent. No image generated in this call.
  if (typeof b?.setShows === 'string') {
    const val = b.setShows === 'hero' ? 'hero' : b.setShows === 'rejected' ? 'rejected' : null
    beats[sceneIndex] = { ...(beats[sceneIndex] || {}), shows: val, ...(beats[sceneIndex]?.preview_source !== 'user' ? { preview: null, preview_source: null } : {}) }
    await admin.from('creative_generations').update({ clone_meta: { ...meta, beat_sheet: { ...beat, beats } } }).eq('id', jobId).eq('user_id', user.id)
    return NextResponse.json({ ok: true, sceneIndex, shows: val })
  }
  const action = String(b?.action || b?.scriptLine || beats[sceneIndex]?.action || beats[sceneIndex]?.scriptLine || 'Opening shot').slice(0, 300)
  // Never let an implicit AI regeneration overwrite a frame the founder UPLOADED. Only an explicit
  // action (a new upload, or a deliberate regenerate with force:true) may replace it. Guards the
  // auto-gen loop + any stale client from silently trashing an approved user frame.
  const isCastRegen = b?.regenerateCast === true
  const hasUploadedKey = typeof b?.uploadedKey === 'string' && !!b.uploadedKey
  if (!isCastRegen && !hasUploadedKey && beats[sceneIndex]?.preview_source === 'user' && b?.force !== true) {
    return NextResponse.json({ ok: true, sceneIndex, preview: beats[sceneIndex].preview, source: 'user', kept: true })
  }
  const look = String(b?.look || meta.character_look || '').trim()
  const productName = meta.product_details?.name || meta.brand_name || ''

  // UPLOAD-YOUR-OWN: the founder supplied their own image for this scene (a real product shot, a brand
  // photo, a specific model/face) via the presigned assets upload. We take the R2 KEY and resolve the
  // public URL server-side (never trust a raw client URL), then persist it exactly where the worker reads
  // the keyframe (beat.preview) — no AI generation, no credit. This is what makes the result 100%
  // predictable: they picked the frame, and the video is built from it.
  const uploadedKey = typeof b?.uploadedKey === 'string' ? b.uploadedKey.replace(/^\/+/, '') : ''
  if (uploadedKey) {
    const publicUrl = r2PublicUrl(uploadedKey)
    if (!publicUrl) return NextResponse.json({ error: 'could not resolve the uploaded image' }, { status: 500 })
    beats[sceneIndex] = { ...(beats[sceneIndex] || {}), preview: publicUrl, preview_source: 'user', approved: true }
    await admin.from('creative_generations').update({ clone_meta: { ...meta, beat_sheet: { ...beat, beats } } }).eq('id', jobId).eq('user_id', user.id)
    return NextResponse.json({ ok: true, sceneIndex, preview: publicUrl, source: 'user' })
  }

  // Product photos ground the render (pixel-perfect product). Cap 3.
  const rawImgs: string[] = Array.isArray(meta.product_image_urls) ? meta.product_image_urls.slice(0, 3) : []
  const productImgs = (await Promise.all(rawImgs.map(fetchImageB64))).filter(Boolean) as { mimeType: string; dataB64: string }[]

  // CLOSEST-TO-REFERENCE: the analysis grabbed the source ad's real frame at this beat (beats[i].thumb).
  // Feed it as a COMPOSITION guide so the keyframe tracks the reference shot-for-shot (framing, angle,
  // subject placement) — while we REPLACE the person with an original creator and swap in the user's
  // product, never reproducing the competitor's pixels or a real face.
  // RECAST GUARD: when the user recast the cast (e.g. Pakistani), the source frame shows the ORIGINAL
  // person — Nano Banana copies their face/ethnicity from those pixels and quietly ignores the recast.
  // So on a recast job we DROP the source frame entirely and rely on the locked cast sheet for identity;
  // framing is guided by the setting text instead. (Non-recast jobs keep the frame for tight composition.)
  const recastActive = !!look && look.toLowerCase() !== 'match'
  const refFrameUrl = recastActive ? null : (beats[sceneIndex]?.thumb || null)
  const refFrame = refFrameUrl ? await fetchImageB64(refFrameUrl) : null

  const isService = meta.product_type === 'service' || meta.product_type === 'app'
  // The reference creator's look (hair colour, age, wardrobe…) + setting, captured by the analysis —
  // so the preview matches the reference person AND stays the SAME person across every scene.
  const avatar = String(beat.avatar || '').trim().slice(0, 240)

  // ── PHASE 2 · CAST SHEET — the single source of truth for WHO is on camera. ──────────────────────
  // Before this, scenes chained off the previous scene's keyframe: scene 0 was unanchored (invented a
  // fresh person) and the chain drifted if any early scene was regenerated. Now we mint ONE canonical
  // character portrait for the job (from the reference creator's look), store it at meta.cast_sheet,
  // and use it as the same-person reference for EVERY scene — including scene 0. One consistent
  // presenter across the whole storyboard, locked before the founder approves a single frame.
  const wantsPerson = !isService && (
    (!!avatar && !/^none/i.test(avatar)) || beat.is_talking_head === true || beat.is_talking_head === undefined
  )
  let castImg: { mimeType: string; dataB64: string } | null = null
  // regenerateCast: the founder didn't like the locked creator (or changed the recast look) → mint a
  // fresh hero sheet. Every later scene keyframe then re-locks to the new person.
  const regenCast = b?.regenerateCast === true
  // A cast regen for a job with NO person (service/app brand, or a no-avatar b-roll ad) has nothing to
  // draw — say so instead of falling through to a scene-0 keyframe generation that would overwrite
  // beats[0] and return no castSheet.
  if (regenCast && !wantsPerson) return NextResponse.json({ error: 'This ad has no on-camera creator to redraw.' }, { status: 400 })
  let castUrl: string | null = regenCast ? null : (meta.cast_sheet || null)
  if (wantsPerson) {
    if (!castUrl) {
      // GENDER LOCK for the cast sheet: when the analysis gave us no avatar text, ground the cast's
      // gender/age/ethnicity in the REAL source frame (beats[i].thumb). Gemini image-gen accepts real
      // photos as references (only fal's VIDEO filter blocks them), and we tell it to invent a NEW face —
      // so the cast stays synthetic (safe downstream) but no longer flips a man's ad to a woman.
      const castRefs = (!avatar && refFrame) ? [refFrame] : []
      const castPrompt = [
        'Create ONE photorealistic vertical 9:16 portrait of a SINGLE original person — a fictional everyday creator for a UGC/social ad, NOT any real individual or celebrity.',
        look && look.toLowerCase() !== 'match' ? `The person is ${look} in appearance.` : '',
        avatar
          ? `They look like this reference creator — match GENDER first, then age range, ethnicity, hair (colour + style), any facial hair/glasses and wardrobe: ${avatar}.`
          : castRefs.length
            ? 'MATCH the GENDER, apparent age, ethnicity and build of the person in the attached reference photo (Image 1) — but give them a COMPLETELY NEW, different face (a fictional person, never the real one). Same kind of person, brand-new identity. Do NOT change a man to a woman or vice-versa.'
            : 'A natural, relatable, real-looking person (any gender) suited to this ad.',
        // HERO CHARACTER SHEET (Higgsfield method): the sheet that lets ONE person hold across a whole
        // multi-location montage. Two panels of the SAME person — a tight face close-up (locks the face)
        // and a full-body front view (locks the build + wardrobe) — matched lighting/scale, plain grey
        // background so nothing competes with the character. CRITICAL: exactly ONE visible face in the
        // whole image — a second face in frame makes the video model drift between identities.
        'Compose it as a CHARACTER REFERENCE SHEET, split-frame, photorealistic: LEFT panel — a tight facial close-up, the entire head fully in frame including all the hair, calm neutral expression, looking straight into the lens, real skin texture and pores, soft cinematic key light with gentle fill. RIGHT panel — the SAME person, full-body front view, head-to-toe, standing straight in a relaxed pose, arms at their sides, same wardrobe, even full-length lighting.',
        'Both panels are the identical person: same face, hair, skin tone, build and outfit. Plain solid neutral-grey seamless background, matched framing and scale, a thin vertical divider between the panels. EXACTLY ONE face visible in the entire image (the close-up) — the full-body figure must not show a second detailed face turned to camera; keep its face small/soft or angled so there is only one face to lock onto.',
        'This is a locked reference — clean, sharp and clear so the exact same person can be recreated identically in every later shot. NO text, NO logos, NO product in frame, NO borders.',
      ].filter(Boolean).join(' ')
      const castGen = await generateImage(castPrompt, castRefs, 'pro', { aspectRatio: '9:16', imageSize: '1K' })
      if (castGen.ok) {
        // A regen MUST land on a NEW key: the old key is served with an immutable cache header, so
        // rewriting it returned the byte-identical URL → the client's `cast` state never changed, the
        // auto-redraw never re-fired, and the CDN kept showing the OLD person.
        const castKey = regenCast ? `creatives/cast/${jobId}-${Date.now()}.jpg` : `creatives/cast/${jobId}.jpg`
        const uploaded = await uploadBufferToR2(Buffer.from(castGen.dataB64, 'base64'), castKey, castGen.mimeType)
        if (uploaded) {
          if (regenCast) {
            // Explicit regenerate: the NEW sheet wins. Persist it and clear every scene's stale keyframe
            // (they were drawn against the old person) so the storyboard redraws with the new creator.
            castUrl = uploaded
            const cleared = beats.map((bt: any) => (bt && bt.preview_source !== 'user') ? { ...bt, preview: null, preview_source: null } : bt)
            await admin.from('creative_generations').update({ clone_meta: { ...meta, cast_sheet: castUrl, beat_sheet: { ...beat, beats: cleared } } }).eq('id', jobId).eq('user_id', user.id)
            meta.cast_sheet = castUrl
            return NextResponse.json({ ok: true, castSheet: castUrl, regenerated: true })
          }
          // Race guard: a parallel scene request may have minted the cast sheet first. Re-read and, if
          // one now exists, use THAT one so every scene locks to the SAME person (never two casts).
          const { data: fresh } = await admin.from('creative_generations').select('clone_meta').eq('id', jobId).maybeSingle()
          const freshCast = (fresh as any)?.clone_meta?.cast_sheet
          castUrl = freshCast || uploaded
          meta.cast_sheet = castUrl
        }
      } else if (regenCast) {
        return NextResponse.json({ error: castGen.error === 'pro_model_busy' ? 'The image model is busy — try again in a moment.' : (castGen.error || 'Could not draw the creator') }, { status: 502 })
      }
    }
    if (castUrl) castImg = await fetchImageB64(castUrl)
  }

  // PER-SCENE PERSON: a multi-person ad has scenes featuring NON-lead cast (e.g. "Woman D"). Parse the
  // cast letter from the shot text and lock to THAT person — their own drawn sheet if it exists, else
  // describe them — so a "Woman D" scene draws Woman D, not the main creator (Person A). Only fall back
  // to cast_sheet A (or the previous-scene chain) for the lead / unlabelled scenes.
  const letterMatch = String(action).match(/\b(?:person|man|woman|guy|girl|male|female|lady|dude)\s+([A-E])\b/i) || String(action).match(/\b([B-E])\b/)
  const sceneLetter = letterMatch ? letterMatch[1].toUpperCase() : null
  const castSheetsMap: Record<string, string> = (meta.cast_sheets && typeof meta.cast_sheets === 'object') ? meta.cast_sheets : {}
  const scenePerson = (sceneLetter && Array.isArray(beat.people)) ? beat.people.find((p: any) => String(p?.id).toUpperCase() === sceneLetter) : null
  const scenePersonSheetUrl = (sceneLetter && sceneLetter !== 'A') ? castSheetsMap[sceneLetter] : (castSheetsMap.A || meta.cast_sheet)
  const isNonLeadScene = !!sceneLetter && sceneLetter !== 'A'
  let charLock: { mimeType: string; dataB64: string } | null = null
  if (scenePersonSheetUrl) charLock = await fetchImageB64(scenePersonSheetUrl)   // this scene's exact person, already drawn
  else if (!isNonLeadScene) charLock = castImg                                    // lead scene → the cast_sheet A we minted above
  // Chain-off-previous-frame fallback is only safe for the SAME person — never for a labelled non-lead scene.
  if (!charLock && !isNonLeadScene && sceneIndex > 0) {
    for (let j = sceneIndex - 1; j >= 0; j--) {
      if (beats[j]?.preview) { charLock = await fetchImageB64(beats[j].preview); if (charLock) break }
    }
  }
  const setting = String(beat.setting || '').trim().slice(0, 160)
  const creatorClause = look && look.toLowerCase() !== 'match'
    ? `If a person is on camera, cast a ${look} creator${avatar ? `, keeping the reference creator's age range, hair style and wardrobe vibe (${avatar})` : ''} — the SAME person in every scene.`
    : avatar
      ? `If a person is on camera, they MUST match the reference creator exactly — ${avatar} — copying gender, age, ethnicity, hair (colour + style) and wardrobe; the SAME person appears in every scene.`
      : 'Cast whatever people the scene naturally needs (or none), kept consistent across scenes.'
  // REJECTED-PRODUCT SCENE: the storyboard tags each beat 'hero' (your product) or 'rejected' (the
  // rival/bad thing the ad argues against — e.g. a vape). A rejected beat must KEEP that rival item and
  // NOT swap in the user's product (that breaks the story). Read the tag off the beat.
  const sceneShows = beats[sceneIndex]?.shows === 'rejected' ? 'rejected' : (beats[sceneIndex]?.shows === 'hero' ? 'hero' : null)
  const rejectedItem = String(meta.beat_sheet?.rejected_product || 'a generic disposable vape').slice(0, 60)
  const showRejected = sceneShows === 'rejected'
  const productClause = showRejected
    ? `This scene shows the RIVAL / rejected item — a generic ${rejectedItem} — NOT the user's product. Render a plain, unbranded ${rejectedItem} (no logos). Do NOT show or brand the user's product anywhere in this shot.`
    : (isService || !productImgs.length)
      ? 'This is a service/brand — do NOT invent a physical product; lead with the person, setting, or an on-phone app view.'
      : `Render the user's product${productName ? ` ("${productName}")` : ''} 1:1 — exact silhouette, label, materials — at its TRUE real-world size relative to the hand/body (a small handheld item stays small in the hand, NEVER enlarged, stretched or out of proportion). Do NOT reshape or invent a different product.`
  // The analysis may name the COMPETITOR's product in the shot text (e.g. "FÜM device") — that always
  // means the USER's product here (UNLESS this is a rejected-product beat, where the rival item stays).
  const brandNeutral = showRejected
    ? `The item in this shot is the rejected ${rejectedItem} — keep it as that generic item, never the user's product or any real brand's logo.`
    : productName ? `Any product named in the shot refers to "${productName}" (the user's product) — never a competitor's product, brand name or logo.` : 'Any product named in the shot is the user\'s product — never a competitor\'s brand or logo.'
  // When a same-creator lock exists it OVERRIDES the descriptive clause — keep that exact person.
  // For a labelled non-lead scene with no drawn sheet, describe THAT person (not the lead) so the
  // keyframe shows e.g. Woman D, and honour any recast (ethnicity overrides the reference's).
  const recastOn = !!look && look.toLowerCase() !== 'match'
  const scenePersonDesc = String((scenePerson as any)?.look || '').trim()
  const personClause = charLock
    ? 'The on-camera person MUST be the EXACT SAME creator shown in the same-creator reference image — match their face, hair, skin tone and wardrobe precisely; it is the same person whenever they appear.'
    : (isNonLeadScene && scenePersonDesc)
      ? (recastOn
          ? `The on-camera person is ${look} in appearance (this ethnicity/skin tone OVERRIDES the reference). Keep only their gender, apparent age, build, hairstyle and wardrobe from: ${scenePersonDesc}. A brand-new fictional ${look} face — a DIFFERENT person from the main creator.`
          : `The on-camera person for this scene is: ${scenePersonDesc}. A brand-new fictional face — a DIFFERENT person from the main creator, kept consistent whenever they appear.`)
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
  if (!isService && !showRejected && productImgs.length) {
    const first = genImages.length + 1
    for (const p of productImgs) genImages.push(p)
    legend.push(`Image${productImgs.length > 1 ? 's' : ''} ${first}${productImgs.length > 1 ? `–${genImages.length}` : ''} = the user's product (render 1:1, true real-world size).`)
  }

  const prompt = [
    `Create ONE photorealistic vertical 9:16 video KEYFRAME — the FIRST FRAME of a short video clip.`,
    legend.length ? `Attached reference images, in order — ${legend.join(' ')}` : '',
    refFrame
      ? (recastOn
          ? `Recreate the COMPOSITION reference's framing, angle, distance and background layout — but make it an ORIGINAL image: give the on-camera person a NEW ${look} face. KEEP the reference person's gender, age range, hair style and build, but their ETHNICITY/skin tone is ${look} (the recast OVERRIDES the reference's ethnicity — do NOT copy the reference person's skin colour). Do NOT change a man to a woman or vice-versa. Swap in the user's product. Recreate the SHOT, not the pixels.`
          : `Recreate the COMPOSITION reference's framing, angle, distance and background layout — but make it an ORIGINAL image: give the on-camera person a NEW face (never reproduce the real person) while KEEPING THE SAME gender, age range, ethnicity, hair and build as the person shown in the reference — do NOT change a man to a woman or vice-versa. Swap in the user's product. Recreate the SHOT, not the pixels.`)
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
    beats[sceneIndex].preview_source = 'ai'                                     // for the Storyboard "AI / yours" badge
    if (b?.action) beats[sceneIndex].action = String(b.action).slice(0, 300)   // keep the user's raw text in the field
    beats[sceneIndex].shot_prompt = shot                                        // the enhanced direction (for the render)
  }
  const nextMeta = { ...meta, beat_sheet: { ...beat, beats } }
  await admin.from('creative_generations').update({ clone_meta: nextMeta }).eq('id', jobId).eq('user_id', user.id)

  return NextResponse.json({ ok: true, sceneIndex, preview: url })
}
