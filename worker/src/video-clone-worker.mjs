/**
 * video-clone-worker — turns a COMPETITOR video ad into the user's OWN product ad, with a
 * SCRIPT-APPROVAL gate so no credits are spent on a script the user hasn't seen.
 *
 * Two phases (creative_generations, type='video_clone'):
 *   A. status='analyzing'  → Gemini watches the competitor video (source_video_url) → beat sheet +
 *      transcript; gpt-4o writes a Seedance prompt + adapted script. We stash both and flip the row to
 *      status='review'. NO credits spent yet — analysis is cheap (~$0.05, we absorb it).
 *   B. status='processing' → the user approved (POST …/approve reserved credits + set the final script).
 *      We rebuild the Seedance prompt around the APPROVED script → fal.ai Seedance 2.0
 *      reference-to-video generates → download → R2 → row done → commit credits.
 * Any failure in B → row 'failed' + refund. Failure in A → 'failed' (nothing to refund).
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY (optional), OPENAI_API_KEY, FAL_KEY,
 *      R2_* (ACCOUNT_ID/ACCESS_KEY_ID/SECRET_ACCESS_KEY/BUCKET_NAME/PUBLIC_URL).
 */
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { spawn } from 'node:child_process'
import { readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const U = (process.env.SUPABASE_URL || '').split('\n')[0].replace(/\/$/, '')
const K = process.env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: 'Bearer ' + K, 'Content-Type': 'application/json' }
const GEMINI_KEY = process.env.GEMINI_API_KEY
const GEMINI_MODEL = process.env.GEMINI_VIDEO_ANALYZE_MODEL || 'gemini-2.5-flash'
const OPENAI_KEY = process.env.OPENAI_API_KEY
const OPENAI_MODEL = process.env.CLONE_PROMPT_MODEL || 'gpt-4o'
const FAL_KEY = process.env.FAL_KEY
// ── fal spend telemetry. Rates measured from real fal billing (2026-07-13: seedance-2.0
// reference-to-video billed $34.94 / 2,495.7k tokens ≈ $0.21 per second of premium video). Each
// job's estimated fal cost is passed to commit_credits as metadata.actual_cost_usd, which the
// existing /admin/margins dashboard reads → live margin per action, no more guessing. ──
const SEEDANCE_USD_PER_SEC = Number(process.env.FAL_SEEDANCE_USD_PER_SEC || 0.21)
// AUDIO-ON clips bill HIGHER at fal. Measured 2026-07-20 (job 3876a200): 3 native-audio generations,
// ~37s total, real fal spend $11.23 → ≈$0.30/s (vs $0.21/s silent). Underestimating hid a ~45% cost
// gap from /admin/margins. Overridable as real bills refine it.
const SEEDANCE_AUDIO_USD_PER_SEC = Number(process.env.FAL_SEEDANCE_AUDIO_USD_PER_SEC || 0.30)
const SEEDANCE_FAST_USD_PER_SEC = Number(process.env.FAL_SEEDANCE_FAST_USD_PER_SEC || 0.09)
const VACE_EST_USD_PER_RUN = Number(process.env.FAL_VACE_EST_USD || 0.5)
const clipCost = (tier, secs, audio = false) => (tier === 'fast' ? SEEDANCE_FAST_USD_PER_SEC : audio ? SEEDANCE_AUDIO_USD_PER_SEC : SEEDANCE_USD_PER_SEC) * (Number(secs) || 10)
// HARD PER-JOB FAL CEILING (safety net). No single video may spend more than this on fal, no matter
// what the logic does — re-rolls stop and the free real-photo cover takes over. A 30s UGC is ~$7 and
// a 60s ~$14, so $18 leaves headroom for normal work while killing any runaway (the $22 spout loop).
const MAX_FAL_USD = Number(process.env.MAX_FAL_PER_JOB_USD || 18)   // hard per-job fal ceiling — runaway backstop only; real cost control is the scene-count cap (clampScenes). env-tunable
const EVERY = 8000
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
})
const R2_PUBLIC = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '')

async function getJSON(path) { const r = await fetch(`${U}/rest/v1/${path}`, { headers: H }); if (!r.ok) throw new Error(`${r.status} ${await r.text()}`); return r.json() }
async function patch(path, body) { const r = await fetch(`${U}/rest/v1/${path}`, { method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify(body) }); if (!r.ok) console.warn('patch', path, r.status, (await r.text()).slice(0, 160)) }
async function rpc(fn, body) { const r = await fetch(`${U}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H, body: JSON.stringify(body) }); if (!r.ok) console.warn('rpc', fn, r.status, (await r.text()).slice(0, 160)) }
// Surface a handled failure to the admin Error Logs dashboard (same error_logs table the app uses).
async function logErr(userId, message, extra) { try { await fetch(`${U}/rest/v1/error_logs`, { method: 'POST', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify({ user_id: userId || null, error_message: String(message || '').slice(0, 2000), page_url: '/studio', extra: extra || null }) }) } catch { /* logging never blocks the worker */ } }

// ── Gemini: watch the competitor video → structured beat sheet ────────────────
const BEAT_SCHEMA_PROMPT = `You are a UGC ad director. Watch this video ad and return ONLY minified JSON (no prose, no code fence):
{"setting":"","avatar":"","camera":"","hook_type":"","beats":[{"t":"0-2s","action":""}],"scene_count":0,"on_screen_text":[{"t":"0-4s","text":""}],"app_demo":[{"t":"0-4s","region":"split_top"}],"product_role":"","transcript":"","tone":"","duration_seconds":0,"is_talking_head":true}
- app_demo: time ranges where the ad shows a SOFTWARE UI / app screen / website / dashboard / phone-or-laptop screen recording (NOT a physical product, NOT a person). region: "split_top" if the screen fills only the TOP portion while a person stays on screen below; "full" if the screen fills the whole frame (a cut to the app). Empty array if the ad never shows a screen/app UI.
- setting: physical scene. avatar: who's on camera (age, look, wardrobe) or "none". camera: framing + movement.
- on_screen_text: the BIG designed text CALLOUTS/graphics burned on screen (headlines, stats like "25g PROTEIN", prices, offers, CTAs) with the time range each is visible — NOT the spoken words, NOT tiny legal text. Empty array if the ad has no on-screen text.
- hook_type: first-3-seconds pattern. beats: 3-8 time-ranged actions. transcript: exact spoken words. Be concrete.
- scene_count: the EXACT number of distinct visual scenes/shots (hard cuts to a new location, subject, or camera setup) in the ad — count the real cuts you see, 1 for a single continuous take. This is the number of clips a faithful clone must reproduce, so be precise.
- duration_seconds: the ad's real total length in seconds.
- is_talking_head: true ONLY if a person ON CAMERA speaks the main audio to the viewer (lips visibly delivering it). A narrator VOICEOVER over b-roll/lifestyle/montage footage = false. Multiple scene cuts with no consistent on-camera speaker = false.`

// Gemini's inline-video limit is ~20MB. Raw user uploads (phone video) routinely blow past it — and
// returning null here silently gutted the whole remake: no beat sheet → generic 15s UGC script + the
// real Whisper transcript discarded (that's the "14-second script" bug). So instead of skipping a big
// video, downscale it with ffmpeg (720p / 15fps / first 90s — plenty for beats + talking-head + text)
// until it fits, then analyse THAT. ffmpeg is already on the worker image.
const GEMINI_INLINE_CAP = 19 * 1024 * 1024
async function compressForAnalysis(buf, id) {
  const inF = join(tmpdir(), `an-${id}.in.mp4`), outF = join(tmpdir(), `an-${id}.out.mp4`)
  try {
    await writeFile(inF, buf)
    await ff(['-y', '-i', inF, '-t', '90', '-r', '15',
      '-vf', "scale='if(gt(iw,ih),720,-2)':'if(gt(iw,ih),-2,720)'",
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '32', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-ac', '1', '-b:a', '48k', '-movflags', '+faststart', outF])
    return await readFile(outF)
  } finally {
    await rm(inF, { force: true }).catch(() => {}); await rm(outF, { force: true }).catch(() => {})
  }
}
async function analyzeVideo(videoUrl) {
  if (!GEMINI_KEY) return null
  const vr = await fetch(videoUrl)
  if (!vr.ok) throw new Error(`fetch source video ${vr.status}`)
  let buf = Buffer.from(await vr.arrayBuffer())
  let mime = vr.headers.get('content-type') || 'video/mp4'
  if (buf.length > GEMINI_INLINE_CAP) {
    const orig = buf.length
    try {
      const small = await compressForAnalysis(buf, `${Date.now()}`)
      if (small && small.length <= GEMINI_INLINE_CAP) {
        buf = small; mime = 'video/mp4'
        console.log(`🗜 analyze: downscaled ${(orig / 1e6).toFixed(1)}MB → ${(small.length / 1e6).toFixed(1)}MB for Gemini`)
      } else {
        console.warn(`analyze: still ${((small?.length || orig) / 1e6).toFixed(1)}MB after downscale — skipping Gemini`)
        return null
      }
    } catch (e) { console.warn('analyze downscale failed:', e.message); return null }
  }
  const body = {
    contents: [{ parts: [
      { inline_data: { mime_type: mime, data: buf.toString('base64') } },
      { text: BEAT_SCHEMA_PROMPT },
    ] }],
    generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
  }
  // RETRY on rate-limit/transient errors (429/500/503) — a missing beat sheet silently guts clone
  // fidelity (no avatar → Seedance invents a random creator; that's how a woman's UGC came back as
  // a man). Mirror geminiImage's retry ladder instead of giving up on the first 429.
  for (let attempt = 1; attempt <= 4; attempt++) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (r.ok) {
      const j = await r.json()
      const text = j?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || ''
      try { return JSON.parse(text) } catch { console.warn('gemini non-JSON beat sheet'); return null }
    }
    console.warn(`gemini analyze ${r.status} (attempt ${attempt}/4)`, (await r.text()).slice(0, 120))
    if (![429, 500, 503].includes(r.status) || attempt === 4) return null
    await new Promise((res) => setTimeout(res, [0, 3000, 8000, 20000][attempt]))
  }
  return null
}

// ── Language: scripts are TRANSCREATED (written natively), never translated. Real UGC in
// Urdu/Hindi/Arabic code-switches English product words — that authenticity is the moat. ──
const LANG_NAME = {
  en: 'English',
  ur: 'Urdu — natural Karachi-creator style; code-switch English product/beauty/tech words exactly where a real Pakistani creator would (e.g. "yeh serum literally 2 hafton mein…")',
  hi: 'Hindi — natural Mumbai-creator style; Hinglish code-switching where a real Indian creator would',
  ar: 'Arabic — Modern Standard with a friendly Gulf flavour; keep brand/product names as-is',
  es: 'Spanish — natural Latin-American creator style',
  fr: 'French — natural creator style',
  de: 'German — natural creator style',
}
const langName = (code) => LANG_NAME[code] || LANG_NAME.en

// ── Product truth: LOOK at the user's product photo before writing anything. The script writer only
// had a name + optional benefit, so a gummies reference ad cloned for a capsules product kept saying
// "gummies". gpt-4o vision describes what the product ACTUALLY is; every prompt builder then gets a
// hard rule to describe it truthfully and never inherit the reference product's form. ──
async function describeProduct(imageUrl) {
  if (!imageUrl) return null
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o', max_tokens: 120, temperature: 0.2,
      messages: [{ role: 'user', content: [
        { type: 'text', text: 'Describe this product for an ad script in ONE dense sentence: exactly what it IS (form factor — capsules / gummies / powder / spray / bottle / device / garment …), its packaging, colors, and any readable label text. ALWAYS end the sentence by stating its TOP EDGE / CLOSURE exactly as visible, e.g. "; closure: plain heat-sealed pillow pouch with NO spout or cap" or "; closure: white screw cap" — video models love inventing spouts/caps, and this clause is what stops them. State only what is visible — no guesses.' },
        { type: 'image_url', image_url: { url: imageUrl } },
      ] }],
    }),
  })
  if (!r.ok) throw new Error(`vision ${r.status}`)
  const j = await r.json()
  const text = (j.choices?.[0]?.message?.content || '').trim()
  return text || null
}
// ── Creator lock for a SEGMENT re-shoot: grab a frame from a KEPT part of the finished video and
// describe the on-camera person precisely, so the re-rolled segment renders the SAME creator instead
// of a random new face (text-to-video drifts hard without this). Returns a dense description or null.
// ~2¢. We describe (not image-anchor) because fal's likeness filter rejects a real-looking face image. ──
async function describeCreator(videoUrl, atSec, id) {
  if (!OPENAI_KEY || !videoUrl) return null
  let frame
  try {
    const local = join(tmpdir(), `cl-src-${id}.mp4`)
    await downloadToFile(videoUrl, local)
    const f = join(tmpdir(), `cl-${id}.jpg`)
    await ff(['-y', '-ss', String(Math.max(0.3, atSec || 1)), '-i', local, '-frames:v', '1', '-q:v', '3', '-vf', 'scale=640:-1', f])
    frame = `data:image/jpeg;base64,${(await readFile(f)).toString('base64')}`
    await rm(local, { force: true }).catch(() => {})
    await rm(f, { force: true }).catch(() => {})
  } catch (e) { console.warn(`describeCreator frame ${id}:`, e.message); return null }
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini', max_tokens: 120, temperature: 0.2,
        messages: [{ role: 'user', content: [
          { type: 'text', text: 'Describe the ON-CAMERA PERSON in ONE dense sentence so another video can recreate the SAME person exactly: gender, apparent age, skin tone, face shape, hair (colour/length/style), any facial hair or glasses, and their exact outfit (garment type, colour, pattern). Then add the setting in a few words. Only what is visible.' },
          { type: 'image_url', image_url: { url: frame } },
        ] }],
      }),
    })
    if (!r.ok) return null
    const j = await r.json()
    const t = (j.choices?.[0]?.message?.content || '').trim()
    if (t) console.log(`🧍 ${id} creator lock: ${t.slice(0, 90)}`)
    return t || null
  } catch { return null }
}
function productTruthRule(product, isService) {
  // SERVICE / app brand → there is NO physical product. This overrides any "product hero / hold /
  // swap" language elsewhere in the prompt. Never render an invented object.
  if (isService) {
    const svc = product && (product.name || product.benefit)
      ? `The service is "${product.name || 'the brand'}"${product.benefit ? ` — ${product.benefit}` : ''}. ` : ''
    return `- SERVICE TRUTH — ${svc}This brand is a SERVICE / app / website, NOT a physical product. There is NO product to hold or show. NEVER invent or render a bottle, jar, box, package, device or any physical item. The creator speaks to camera ABOUT the service; allowed visuals: the creator talking, the creator showing the app/website on a phone or laptop screen (only if a screenshot is provided), and relevant lifestyle b-roll. Adapt the spoken words to the service's benefit.`
  }
  const seen = product && product.observed ? `The product's ACTUAL appearance (described from its real photos): ${product.observed}. ` : ''
  // Vision-measured size anchor (productSizeProfile) — grounded in the real photos, not a language
  // model's guess. The prompt writers are told to use THIS anchor verbatim in their opening scale
  // sentence, which is what actually keeps video models from inflating the product.
  const size = product && product.size_anchor
    ? `SIZE ANCHOR (measured from the real photos — use VERBATIM in the opening scale sentence): the product is ${product.size_anchor}${product.hand_relation ? `; in a hand it ${product.hand_relation}` : ''}. `
    : ''
  return `- PRODUCT TRUTH — ${seen}${size}The script and visuals must describe THE USER'S product truthfully: its real form factor, type and packaging. NEVER inherit the reference ad's product form, flavor or claims (e.g. reference sells gummies but the user's product is capsules → say and show capsules). When unsure, describe only what the product photos show.`
}

// ── Vision-grounded SIZE PROFILE: Gemini/gpt-4o LOOKS at the real product photos and outputs a
// concrete real-world size anchor ("a slim pen-sized device, ~12cm" / "fits between two fingers").
// This replaces the prompt-writer GUESSING the size from text — the anchor is measured from pixels
// (packaging cues, caps, labels, held-in-hand shots all calibrate it). ~1¢, cached on the job. ──
async function productSizeProfile(imageUrls) {
  const imgs = (imageUrls || []).filter(Boolean).slice(0, 3)
  if (!imgs.length || !OPENAI_KEY) return null
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o', max_tokens: 160, temperature: 0.1, response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: [
        { type: 'text', text: 'Estimate this product\'s REAL-WORLD physical size from the photos (use packaging conventions, caps, labels, any hands or objects for calibration). Return ONLY JSON: {"anchor":"<size comparison to ONE concrete everyday object, e.g. \'a slim marker-pen-sized device, roughly 12 cm tall\' or \'a palm-sized jar\'>","hand_relation":"<how it sits in an adult hand, e.g. \'fits between two fingers\' or \'fills the palm\'>","approx_cm":<number, longest dimension>}' },
        ...imgs.map((u) => ({ type: 'image_url', image_url: { url: u } })),
      ] }],
    }),
  })
  if (!r.ok) throw new Error(`size vision ${r.status}`)
  const j = await r.json()
  try {
    const p = JSON.parse(j.choices?.[0]?.message?.content || '{}')
    if (!p.anchor) return null
    return { anchor: String(p.anchor).slice(0, 140), hand_relation: String(p.hand_relation || '').slice(0, 100), approx_cm: Number(p.approx_cm) || null }
  } catch { return null }
}

// ── AUTO SIZE-VERIFIER: after a UGC render, LOOK at frames of the finished video and judge whether
// the product's size relative to the hand/face is realistic. Same verify-and-retry pattern that
// fixed image clones ("new failure → new verifier check, never a new prompt paragraph"). ~1¢. ──
async function verifyProductScale(localFile, sizeAnchor, id) {
  if (!OPENAI_KEY) return 'unknown'
  const frames = []
  try {
    const dur = (await probeDuration(localFile)) || 15
    for (const pct of [0.35, 0.7]) {
      const f = join(tmpdir(), `sv-${id}-${Math.round(pct * 100)}.jpg`)
      await ff(['-y', '-ss', String(Math.max(0.5, dur * pct)), '-i', localFile, '-frames:v', '1', '-q:v', '5', '-vf', 'scale=512:-1', f])
      const b = await readFile(f)
      frames.push(`data:image/jpeg;base64,${b.toString('base64')}`)
      await rm(f, { force: true }).catch(() => {})
    }
  } catch (e) { console.warn(`scale-verify frames ${id}:`, e.message); return 'unknown' }
  if (!frames.length) return 'unknown'
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini', max_tokens: 60, temperature: 0, response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: [
          { type: 'text', text: `These are frames from a UGC ad where a person holds a product${sizeAnchor ? ` (its true size: ${sizeAnchor})` : ''}. Judge ONLY the product's size relative to the person's hand/face: is it rendered at a realistic real-world scale, or unnaturally OVERSIZED (inflated, out of proportion)? Return ONLY JSON: {"verdict":"oversized"|"correct"|"unclear"}` },
          ...frames.map((u) => ({ type: 'image_url', image_url: { url: u } })),
        ] }],
      }),
    })
    if (!r.ok) return 'unknown'
    const j = await r.json()
    const v = JSON.parse(j.choices?.[0]?.message?.content || '{}').verdict
    return v === 'oversized' || v === 'correct' ? v : 'unknown'
  } catch { return 'unknown' }
}

// ── Per-SEGMENT product-truth check — PRODUCT-AGNOSTIC. It never assumes a product type: it compares
// the rendered frames against the USER'S REAL PHOTO (first image) and flags ANY added/removed/changed
// physical part, whatever the product is (pouch, bottle, jar, tube, box, can, device…). The pouch/cap
// case is just one instance. The real product's own description (from describeProduct) is passed in so
// the model knows what "correct" looks like for THIS product. 'mismatch' → caller re-rolls that clip.
// Returns 'match' | 'mismatch' | 'unknown'. ~1¢. Physical products only (services have no product). ──
async function verifySegmentProduct(localFile, productDataUri, productDesc, id, i) {
  if (!OPENAI_KEY || !productDataUri) return 'unknown'
  // Sample THREE frames across the clip, not one. The invented part (a spout/cap on a flat pouch) is
  // often only visible when the product is held up (start) — a single mid-clip frame caught the pour
  // and read as "match", so the cap slipped through. Any frame flagged → mismatch.
  const frames = []
  try {
    const dur = (await probeDuration(localFile)) || 8
    // FULL FRAME + ZOOMED CENTER CROP per sample. Measured on the ejad spout bug (2026-07-20): the
    // invented spout was so small in a full 720p frame that BOTH gpt-4o-mini and gpt-4o passed it;
    // the SAME model on a zoomed crop of the same moment caught it instantly ("spout added in ad").
    // A held product sits in the center ~60% of the frame, so a center crop upscaled to 768 makes a
    // finger-sized spout ~3× larger — inside the model's resolving power.
    for (const pct of [0.15, 0.45, 0.75]) {
      const ts = String(Math.max(0.4, dur * pct))
      const f = join(tmpdir(), `pv-${id}-${i}-${Math.round(pct * 100)}.jpg`)
      const c = join(tmpdir(), `pvz-${id}-${i}-${Math.round(pct * 100)}.jpg`)
      await ff(['-y', '-ss', ts, '-i', localFile, '-frames:v', '1', '-q:v', '3', '-vf', 'scale=768:-1', f])
      await ff(['-y', '-ss', ts, '-i', localFile, '-frames:v', '1', '-q:v', '3', '-vf', 'crop=iw*0.62:ih*0.62:iw*0.19:ih*0.14,scale=768:-1', c])
      for (const p of [f, c]) {
        const b = await readFile(p)
        frames.push(`data:image/jpeg;base64,${b.toString('base64')}`)
        await rm(p, { force: true }).catch(() => {})
      }
    }
  } catch (e) { console.warn(`seg-verify frames ${id}.${i}:`, e.message); return 'unknown' }
  if (!frames.length) return 'unknown'
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // Full gpt-4o (env-overridable): the ~5¢ check guards a ~$2.50 clip — mini kept missing
        // small white-on-white closures and let a capped pouch ship TWICE.
        model: process.env.PRODUCT_VERIFY_MODEL || 'gpt-4o', max_tokens: 220, temperature: 0, response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: [
          { type: 'text', text: `You are a strict product-accuracy inspector for AI-generated ads. The FIRST image is the REAL product — the single source of truth${productDesc ? ` (it is: ${productDesc})` : ''}. The remaining images come in PAIRS from a generated ad of it: a full frame, then a ZOOMED CROP of the same moment — invented parts are often only resolvable in the zoomed crop.

Work in TWO steps and put both in the JSON:
1. "top_edges": look CLOSELY at the TOP EDGE / CLOSURE of the product in the real photo, then in EACH ad image (especially the zoomed crops) — describe each in a few words (e.g. real: "plain heat-sealed pouch top, no spout" / crop 2: "white angled spout on right corner"). Generated videos most often invent a spout, cap, nozzle or knob on the top edge — inspect corners carefully; it may be small, white-on-white, or partly behind a hand.
2. "verdict": "mismatch" if ANY ad image's product differs in physical build from the real one — a part ADDED, REMOVED or CHANGED (spout/cap/lid/nozzle/pump/straw, wrong closure, different container form pouch↔bottle↔jar↔tube↔box↔can, extra wrapper, different silhouette). Colour/lighting/angle/blur differences or a hand covering part of it are NOT mismatches. "unknown" only if the product is not clearly visible in any image.

Return ONLY JSON: {"top_edges":{"real":"...","frames":["..."]},"verdict":"match"|"mismatch"|"unknown","reason":"what changed, few words"}` },
          { type: 'image_url', image_url: { url: productDataUri } },
          ...frames.map((u) => ({ type: 'image_url', image_url: { url: u, detail: 'high' } })),
        ] }],
      }),
    })
    if (!r.ok) return 'unknown'
    const j = await r.json()
    const out = JSON.parse(j.choices?.[0]?.message?.content || '{}')
    if (out.verdict === 'mismatch') console.warn(`🔬 ${id} segment ${i + 1} product mismatch: ${out.reason || ''} · edges=${JSON.stringify(out.top_edges || {}).slice(0, 160)}`)
    else console.log(`🔎 ${id} seg ${i + 1} product check: ${out.verdict}${out.top_edges ? ` · real="${String(out.top_edges.real || '').slice(0, 60)}"` : ''}`)
    return out.verdict === 'mismatch' || out.verdict === 'match' ? out.verdict : 'unknown'
  } catch { return 'unknown' }
}

// ── "Fix a moment": apply the user's free-text note to ONE segment's spoken line. If the note is
// about pronunciation ("it says Ejad wrong"), respell the word PHONETICALLY in the line (Ejad →
// "Ee-jaad", ras malai → "russ muh-lie") — video/TTS models read text literally, so respelling is how
// you steer the mouth. If it's about wording, apply the edit. If it's visual-only (product/person),
// the line comes back unchanged and the note only strengthens the video prompt. ~1¢, fail-open. ──
async function applyFixNote(script, note, lang) {
  if (!OPENAI_KEY || !note || !script) return script
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini', max_tokens: 300, temperature: 0, response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: `A creator in a video ad speaks this line${lang && lang !== 'en' ? ` (language: ${langName(lang)})` : ''}:\n"${script}"\n\nThe user flagged: "${note}"\n\nIf the note concerns PRONUNCIATION or wording of the SPOKEN line, return the line with the flagged word(s) respelled phonetically in-place (hyphenated syllables, e.g. "Ejad"→"Ee-jaad", "ras malai"→"russ muh-lie") or the wording fixed — keep everything else identical. If the note is purely visual (product looks wrong, person, background), return the line UNCHANGED. Return ONLY JSON: {"script":"..."}` }],
      }),
    })
    if (!r.ok) return script
    const j = await r.json()
    const out = JSON.parse(j.choices?.[0]?.message?.content || '{}')
    const s = typeof out.script === 'string' && out.script.trim() ? out.script.trim() : script
    if (s !== script) console.log(`🗣 fix-note respelled line: "${s.slice(0, 80)}"`)
    return s
  } catch { return script }
}

// ── Intelligent scene re-shoot: turn the user's PLAIN-LANGUAGE fix into a clean, filmable Seedance
// prompt. Pasting the user's words raw gives mushy output; instead gpt-4o REWRITES the scene's video
// prompt to incorporate exactly what they asked — as concrete visible action + camera language a video
// model executes well — while keeping the same creator, setting, framing and product. Things video
// models render badly (a clearly dead animal, gore, on-screen text) are translated to the closest
// achievable visible action (recoils, loses grip, drops out of frame). ~1¢, fail-open. ──
async function rewriteScenePrompt(originalPrompt, note, productDesc) {
  if (!OPENAI_KEY || !note || !originalPrompt) return note ? `${originalPrompt} ${note}` : originalPrompt
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OPENAI_MODEL, max_tokens: 400, temperature: 0.4,
        messages: [
          { role: 'system', content: `You rewrite ONE scene's text-to-video prompt for an ad remake. The user describes, in plain everyday words, what they want changed about this scene. Rewrite the prompt so it STILL recreates the same creator, setting, framing style and product (${productDesc || "the user's product"}), but incorporates the user's change as CONCRETE, FILMABLE action and camera language a video model can actually execute. Rules: ONE dense paragraph; describe visible motion literally (what moves, how fast, and where the camera is); keep the product EXACTLY as-is (same container, label and real-world size — never enlarge it); NO on-screen text. If the user asks for something video models render badly (a clearly dead animal, gore, readable text), translate it into the closest achievable VISIBLE action (e.g. "the gecko recoils, loses its grip and drops off the wall out of frame"). Return ONLY the rewritten prompt text, nothing else.` },
          { role: 'user', content: `CURRENT SCENE PROMPT:\n${originalPrompt}\n\nUSER'S REQUESTED CHANGE (plain language):\n${note}` },
        ],
      }),
    })
    if (!r.ok) return `${originalPrompt} ${note}`
    const j = await r.json()
    const txt = String(j.choices?.[0]?.message?.content || '').trim()
    if (txt.length > 20) { console.log(`🎬 scene re-shoot rewritten from note → "${txt.slice(0, 90)}…"`); return txt }
    return `${originalPrompt} ${note}`
  } catch { return `${originalPrompt} ${note}` }
}

// ── Make Cinematic behave like UGC: the VOICE must cover the whole video. The drafted faithful script
// was paced to the SOURCE creator's slow rate (~1 word/sec — long silent b-roll), but our TTS reads
// ~2.6 wps, so it finished at ~1/3 and the dead-air guard chopped the rest of the (paid-for) footage.
// Expand the script to ~targetSecs of natural narration at the TTS rate so VO ≈ video length: no trim,
// full narration, cost matches output. Only expands when it's >15% too short. Fail-open. ──
const TTS_WPS = 2.6
async function fillScriptToLength(script, targetSecs, lang, productName) {
  if (!OPENAI_KEY || !script) return script
  const secs = Math.max(8, Math.min(60, Number(targetSecs) || 0))
  const words = String(script).trim().split(/\s+/).filter(Boolean).length
  const needWords = Math.round(secs * TTS_WPS)
  if (words >= needWords * 0.85) return script   // already fills the video
  try {
    const L = langName(lang)
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OPENAI_MODEL, max_tokens: 600, temperature: 0.6, response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: `You are scripting a ~${Math.round(secs)}-second social-ad voiceover${lang && lang !== 'en' ? ` in ${L} (natural native ad copy, code-switch English product words where a real creator would)` : ''} for ${productName || 'the product'}.\n\nCurrent script (too short — it only fills ~${Math.round(words / TTS_WPS)}s):\n"${String(script).replace(/"/g, "'")}"\n\nRewrite it to about ${needWords} words so it fills ~${Math.round(secs)} seconds of natural spoken narration. Keep the SAME product, the same core message and any claims, in the same order — but develop it into a complete ad arc: hook → the problem → introduce the product → how you use it → the benefit → a short call to action. Punchy, real, creator/UGC tone. No filler, no repetition, no stage directions or on-screen-text. Return ONLY JSON: {"script":"..."}` }],
      }),
    })
    if (!r.ok) return script
    const j = await r.json()
    const out = JSON.parse(j.choices?.[0]?.message?.content || '{}')
    const s = typeof out.script === 'string' && out.script.trim() ? out.script.trim() : script
    if (s !== script) console.log(`📝 ${productName || ''} script paced ${words}→${s.trim().split(/\s+/).filter(Boolean).length} words for ~${Math.round(secs)}s VO`)
    return s
  } catch { return script }
}

// ── Creator-look override: the user can recast the on-camera creator(s) to a chosen ethnicity/look
// (Pakistani / Indian / Arab / …) while keeping everything else from the reference. 'match' (or empty)
// = today's behavior: copy the reference creator exactly. ──
function lookClause(beat, look) {
  if (look && look !== 'match') {
    return `RECAST the on-camera creator(s) as ${look} in appearance — this is the user's explicit choice. Keep the reference creator's age range, wardrobe style, hair style vibe and energy (avatar field: ${(beat && beat.avatar) || 'as analysed'}), but the person's ethnicity/look must clearly read as ${look}`
  }
  return `the EXACT creator(s) copying their GENDER/age/ETHNICITY/hair/wardrobe from the avatar field (${(beat && beat.avatar) || 'as analysed'}) — describe them explicitly in the prompt (gender first); an undescribed creator renders as a random person`
}

// ── gpt-4o: beat sheet + product → Seedance prompt + script. When forcedScript is given (the user's
// APPROVED/edited voiceover) the prompt is built around EXACTLY that script. ──
// ── TRANSCREATE: rewrite the ORIGINAL ad's spoken script for the user's product, keeping the same
// hook, arc, claims and beats in the same order — a dedicated, focused call so the original's message
// actually drives the clone (the Seedance-prompt builder kept ignoring a buried "transcreate" note and
// produced a generic product pitch). Returns the adapted script, or null on any failure. ──
async function transcreateAdScript(transcript, product, lang) {
  if (!OPENAI_KEY) return null
  const L = langName(lang)
  const nonEn = lang && lang !== 'en'
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o', temperature: 0.6, max_tokens: 500,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: `Here is the EXACT spoken voiceover of a winning video ad:\n"${String(transcript).replace(/"/g, "'").slice(0, 1400)}"\n\nRewrite it as the voiceover for a CLONE that sells this product instead:\n${JSON.stringify(product).slice(0, 500)}\n\nRULES:\n- Keep the SAME hook, the SAME narrative arc (problem → discovery → benefit → call to action), the SAME emotional beats and the SAME claims, in the SAME order.\n- Change ONLY the product to the user's — someone who saw the original must recognise the same ad.\n- Do NOT write a generic "hey everyone, check out this amazing device" pitch — follow what the original actually says.\n- Natural spoken ${L}${nonEn ? " in that language's native script (not romanized); keep only real product/brand names in Latin" : ''}, real creator/UGC tone. No stage directions, no on-screen-text notes.\nReturn ONLY JSON: {"script":"..."}` }],
    }),
  })
  if (!r.ok) throw new Error(`transcreate ${r.status}`)
  const j = await r.json()
  let out = {}
  try { out = JSON.parse(j.choices?.[0]?.message?.content || '{}') } catch { return null }
  const s = typeof out.script === 'string' ? out.script.trim() : ''
  return s.length >= 8 ? s : null
}

async function buildSeedancePrompt(beat, product, nImages, forcedScript, look, lang, isService) {
  const refList = Array.from({ length: nImages }, (_, i) => `[Image${i + 1}]`).join(', ')
  const recast = look && look !== 'match'
  const L = langName(lang)
  const nonEn = lang && lang !== 'en'
  // Product-hero + scale block is PHYSICAL-only. Service ads have no product to hold or scale.
  const heroScale = isService
    ? `- NO PHYSICAL PRODUCT — the creator TALKS TO CAMERA about the service the whole time (natural gestures, eye contact). If a screenshot/logo image is provided (${refList || 'none'}) they may hold up their PHONE showing the app/site on screen; otherwise it's a pure talking-head. NEVER show, hold or invent a bottle, box, package or device.`
    : `- PRODUCT IS THE HERO — the creator physically HOLDS the user's product (${refList || 'the product'}) in their hand for MOST of the clip: brings it up to the lens, turns it, and actively USES/demonstrates it across several beats (e.g. takes a puff / applies it / shows how it works), then a close-up of it in-hand. Do NOT show a single static product shot — it must be handled and in-use throughout, and match ${refList || 'the product'} exactly.
- REAL PRODUCT SCALE (TOP PRIORITY — video models inflate product size, so fight it hard):
  (a) your paragraph MUST OPEN with a scale sentence BEFORE anything else, e.g. "The product is a slim pen-sized device that fits between two fingers at true real-world scale…" — early words steer the model most;
  (b) anchor the size to a CONCRETE everyday object (pen, lipstick, credit card, soda can, palm of the hand — pick what matches this product) and to the creator's hand ("no taller than her palm");
  (c) repeat the anchor once more in the timeline at the product close-up beat;
  (d) get it readable by bringing it CLOSE to the camera, never by enlarging it — an oversized, out-of-proportion product looks fake.`
  const sys = `You write prompts for ByteDance Seedance 2.0 (reference-to-video). This is a TALKING-HEAD UGC ad:
a real-looking creator talks straight to the phone camera and delivers the script out loud. Rules:
- ONE dense paragraph: subject (the on-camera creator) → they SPEAK to camera → action/product → camera → lighting → mood, then a short beat-by-beat timeline.
- The creator must be SPEAKING ALOUD to the viewer, lips moving in sync — NOT a silent scene, NOT b-roll with background music. Describe their mouth moving, natural gestures, eye contact with the lens.
${heroScale}
- REPLICATE THE REFERENCE FAITHFULLY — this is a CLONE, not a reinvention. Use the beat sheet's EXACT setting (${(beat && beat.setting) || 'as analysed'}), ${lookClause(beat, look)}, the same camera work, and the same beat timing. The ONLY things you change: ${isService ? 'adapt the spoken words to the service (no product swap — there is no product)' : "swap in the user's product"}${recast ? ', recast the creator as instructed' : ''} and adapt the spoken words. Do NOT change the location${recast ? '' : ', do NOT change the people\'s ethnicity or look'}, do NOT move them to a generic sofa/studio.
${productTruthRule(product, isService)}
${!forcedScript && beat && String(beat.transcript || '').trim().split(/\s+/).filter(Boolean).length >= 6 ? `- SCRIPT = TRANSCREATE THE ORIGINAL, NEVER INVENT A NEW ONE. The reference creator's ACTUAL spoken words were:\n"${String(beat.transcript).replace(/"/g, "'").replace(/\s+/g, ' ').trim().slice(0, 1000)}"\nYour "script" MUST be a faithful adaptation of THESE exact words — keep the SAME hook, the SAME problem→discovery→benefit→CTA arc, the SAME specific claims and emotional beats, IN THE SAME ORDER — changing ONLY the product to the user's (and trimming to fit the length). Someone who watched the original must recognise the SAME message and structure. Do NOT replace it with a generic "hey everyone, I wanted to share this amazing find / it's sleek and fits in my palm" pitch — that throws away what the ad actually says, which is the whole point of a clone.` : ''}
- UGC realism: iPhone selfie, arm's length, natural light, authentic handheld, no on-screen captions/subtitles.
- LANGUAGE: the creator speaks ${L}. ${nonEn ? `TRANSCREATE, never translate — write it the way a real local creator talks (local idioms, rhythm). CRITICAL: write the spoken words in the language's OWN NATIVE SCRIPT (Urdu → اردو, Hindi → हिंदी, Arabic → العربية). Do NOT romanize — never Latin-letter Urdu/Hindi ("aap ne kabhi…"): the voice model reads Latin text as ENGLISH, so the audio comes out English instead of ${L.split(' — ')[0]}. Keep in Latin ONLY real brand/product names (e.g. "AURA") and truly-English product terms; do NOT write whole English sentences — the bulk of the line must be native script.` : `NEVER the reference ad's language if it differs — the clone speaks English.`} Replicate the scene and the people; only the words are ${nonEn ? 'in the chosen language, in its native script' : 'English'}.
${forcedScript ? '- CRITICAL — the creator says these EXACT words aloud to camera, lip-synced, word for word: "' + forcedScript.replace(/"/g, "'") + '". Weave "they say to camera: …" into the prompt so the model generates SPOKEN dialogue in that language, not narration.' : '- The creator speaks a natural line to camera; put the exact words in the script field.'}
Return ONLY minified JSON: {"prompt":"","script":""${nonEn ? ',"gloss":""' : ''}}  (script = the exact words the creator speaks${nonEn ? '; gloss = a one-line ENGLISH summary of what the script says, so the user can sanity-check' : ''}).`
  const usr = `REFERENCE AD (beat sheet):\n${JSON.stringify(beat || { note: 'analysis unavailable — infer a natural UGC structure' })}\n\nUSER PRODUCT:\n${JSON.stringify(product)}\n\nProduct image tokens: ${refList || '(none)'}.`
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: OPENAI_MODEL, temperature: 0.7, response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: sys }, { role: 'user', content: usr }] }),
  })
  if (!r.ok) throw new Error(`openai ${r.status} ${(await r.text()).slice(0, 160)}`)
  const j = await r.json()
  const out = JSON.parse(j.choices?.[0]?.message?.content || '{}')
  if (!out.prompt) throw new Error('no prompt from gpt')
  return { prompt: String(out.prompt), script: String(out.script || forcedScript || ''), gloss: out.gloss ? String(out.gloss) : null }
}

// ── Faithful/Cinematic mode: is the source a multi-scene / B-roll ad (vs a talking-head UGC)? ──
// Little-to-no spoken transcript, or no on-camera talker, means collapsing it into a talking head
// would NOT be a clone. We suggest faithful scene-by-scene cloning instead (user still chooses).
function detectCinematic(beat) {
  if (!beat) return false
  // Gemini watched the video — trust its explicit call (a VO-over-b-roll ad has a long transcript
  // but is NOT a talking head; the heuristic below can't tell those apart).
  if (typeof beat.is_talking_head === 'boolean') return !beat.is_talking_head
  const words = String(beat.transcript || '').trim().split(/\s+/).filter(Boolean).length
  const avatar = String(beat.avatar || '').toLowerCase().trim()
  const noTalker = !avatar || avatar === 'none' || avatar.startsWith('none')
  return noTalker || words < 8
}
function sceneCountFor(beat) {
  // Scale with BOTH the beat count and the source duration — Gemini returns 3-8 beats regardless of
  // length, so beats alone undercounted badly (a 60s multi-cut ad got 2 scenes). ~15s of source per
  // scene, capped at 4 (the priced x2-x4 rows).
  // Reproduce the SOURCE's real cut structure: use Gemini's explicit scene_count (the actual number
  // of hard cuts it saw), so a 3-shot ad clones as 3 scenes and a single take as 1 — accurate, not a
  // formula. Clamped to 1-4 (the priced range + fal practicality). Falls back to a duration estimate
  // (~8s/scene) only when Gemini didn't return a count. Counting real cuts is far more stable across
  // re-analyses than the old beat-count heuristic that flip-flopped the price.
  const secs = Number(beat && beat.duration_seconds) || 15
  const detected = Math.round(Number(beat && beat.scene_count) || 0)
  const count = detected > 0 ? detected : Math.round(secs / 8)
  return clampScenes(count, secs)
}
// Faithful reproduces the ad's REAL shot count — up to 10 scenes, not a hard 4. Two guards: each clip
// is ≥5s on Seedance, so a short fast-cut ad can't demand more scenes than duration/5 (else the clone
// would run far longer than the source); and a hard ceiling of 10 for render time + cost sanity.
function clampScenes(count, secs) {
  // Each scene is a PAID Seedance clip rendered at a 4s MINIMUM (even a 1.5s cut costs 4s of gen), and
  // the voiceover is split across scenes — so too many scenes on a short ad = high fal cost AND a script
  // chopped into 1-2-word fragments. Cap at ~1 scene per 3s (a 15s ad → ~5 scenes = ~3s of VO each,
  // full sentences, half the clips). Hard ceiling 8 for cost/render sanity. (Was /1.5 → up to 10.)
  const durCap = Math.max(2, Math.floor((Number(secs) || 15) / 3))
  return Math.max(2, Math.min(count, durCap, 16))   // ceiling 16 so longer ads get more scenes (was 8)
}

// ── gpt-4o: beat sheet → per-scene Seedance prompts for FAITHFUL mode. Each reference scene becomes
// its own clip prompt (b-roll / lifestyle / product shots allowed — NO forced talking head); clips are
// stitched afterwards, mirroring the source's edit structure. ──
async function buildScenePlan(beat, product, nImages, nScenes, look, voiceover, isService) {
  const refList = Array.from({ length: nImages }, (_, i) => `[Image${i + 1}]`).join(', ')
  const recast = look && look !== 'match'
  // Physical vs service framing for the product beats.
  const productBlock = isService
    ? `- NO PHYSICAL PRODUCT — this is a SERVICE / app / website. NEVER show, hold or invent a bottle, box, package or device. Where the reference features its product, instead show the service on a phone/laptop screen (only if a screenshot image is provided), the brand logo, or a relevant lifestyle moment. The action in each scene is a person talking/gesturing or a lifestyle beat — never handling a product.`
    : `- PRODUCT SWAP — wherever the reference features its product, feature the user's product (${refList || 'the product'}) instead, matching ${refList || 'the product'} exactly.
- PRODUCT HERO FRAMING (critical for fidelity): whenever the product is the focus of a scene, get it BIG IN FRAME by moving the CAMERA close (a tight macro/close-up shot), NOT by enlarging the product — the exact container, cap/applicator and label clearly readable and in sharp focus. AI video renders a product accurately only when the camera is close; a wide shot of a person holding it far away comes out as a generic blurry bottle. CRUCIAL: keep the product's REAL size and proportion relative to the hand — a small handheld device is small in the hand, never inflated or stretched to fill the frame (that looks fake). The frame fills because the CAMERA is close, not because the product grew. For the product-reveal / product-in-use beats, write a close macro shot of hands + product at true scale, NOT a full-body wide shot. At least half the scenes must feature the product this way.`
  const sys = `You write prompts for ByteDance Seedance 2.0 (reference-to-video). The reference ad is a MULTI-SCENE / B-roll style ad. Clone it FAITHFULLY, scene by scene — this is a CLONE of its edit structure, not a talking-head rewrite.
Rules:
- Map the beat sheet's beats (in the "beats" array) onto EXACTLY ${nScenes} scenes, IN ORDER, covering the ad's full arc (hook first). Each scene must RECREATE a specific reference beat — its subject, its action, its shot type — not invent a new one. If there are more beats than scenes, group adjacent beats; if fewer, expand the strongest beats. Each scene = one continuous shot.
- THE HOOK IS SACRED: scene 1 MUST recreate the reference's OPENING beat and start at src_start=0 — that's the attention hook (often a person / problem moment) and the reason the ad works. NEVER drop or skip the first beats. When there are more beats than scenes, MERGE adjacent beats into one continuous shot; dropping a beat that contains PEOPLE while keeping product-only beats is FORBIDDEN — people beats carry the story. If scene 1 shows a person, they FACE the camera with a clear expression/reaction (the reaction IS the hook) — never shot from behind or faceless.
- Per scene, write ONE dense Seedance prompt that reproduces THAT reference beat: subject → the exact action from the beat → camera (copy the reference's framing/movement) → lighting → mood. Stay faithful to what the reference actually shows in that beat (e.g. a couple close-up stays a couple close-up; a gym shot stays a gym shot). Cinematic b-roll, lifestyle moments and product close-ups are all allowed — do NOT force anyone to talk to camera, and do NOT drift to a generic studio.
- ACTION IS MANDATORY: name a SPECIFIC continuous on-camera MOTION the subject performs from the reference beat — ${isService ? 'talking to camera, gesturing, using a phone/laptop, or a lifestyle action (walking, working, relaxing)' : 'applying/rolling/massaging the product onto skin or scalp, spraying, pumping, drinking, swatching, demonstrating — never a person merely standing and holding the product still'}. Write it as an active verb the video model can animate.
${productBlock}
- PEOPLE — when a scene has people, ${recast ? `recast them as ${look} in appearance (user's explicit choice), keeping the reference's age range, wardrobe style and energy` : `copy the reference people EXACTLY — gender, age, ethnicity, hair, wardrobe, energy${beat && beat.avatar ? ` (the reference creator is: ${String(beat.avatar).replace(/"/g, "'")})` : ' (from the beat sheet)'}. Describe them explicitly in the prompt (e.g. 'a woman in her 30s with long red hair and glasses'), never just 'a person' — an undescribed person comes out as a random creator`}.
- CREATURE/SPECIES LOCK: if the ad features a specific animal or pest (lizard/gecko, cockroach, rat, mosquito, ant…), every scene must show the EXACT same common species at its real size — a small house gecko (7–12cm, slender, grey/tan) stays a small house gecko, NEVER a large pet reptile (bearded dragon, iguana, chameleon). Same for any creature: match the reference's species and scale, never a bigger or exotic look-alike.
- CLEAN ENVIRONMENT: keep the home/room/surfaces clean, bright and tidy — the PEST or problem is the only thing wrong. Do NOT add dirt, grime, stains, spilled food, smears or squalor unless the reference explicitly shows a filthy scene. A gross-looking home undercuts a product that promises a clean, protected home.
${productTruthRule(product, isService)}
${voiceover ? `- NARRATION IS ADDED IN POST — scenes must contain NO on-camera speech (ambience/music energy only). Design the visuals to fit this voiceover's arc, in order: "${String(voiceover).replace(/"/g, "'")}". Put the chunk each scene covers in its "script" field for reference only — do NOT write spoken dialogue into the prompt.` : '- No dialogue — scenes are music/ambience-driven b-roll. Leave "script" empty.'}
- Per scene pick "duration": 5 for a quick cut, 10 for a longer beat (numbers only).
- Per scene also report: "has_people": true if ANY person/face is visible in that reference beat (false = pure product/object/environment b-roll), "has_product": true if the user's product appears (held/used/shown) in that scene, and "src_start"/"src_end": the SECONDS range of the reference footage this scene recreates (derive from the beats' "t" ranges, e.g. "4-9s" → 4 and 9).
- CAST: label each distinct person "A", "B"… and use the SAME letter for the same person across every scene (A = the main character). Per scene report "cast": the letters visible in that scene ([] when no people). Most ads have ONE character — only use B when the reference clearly shows a second distinct person.
Return ONLY minified JSON: {"scenes":[{"prompt":"","script":"","duration":5,"has_people":false,"has_product":true,"cast":["A"],"src_start":0,"src_end":5}]}  (exactly ${nScenes} scenes, in order).`
  const usr = `REFERENCE AD (beat sheet):\n${JSON.stringify(beat || { note: 'analysis unavailable — infer a natural multi-scene structure' })}\n\nUSER PRODUCT:\n${JSON.stringify(product)}\n\nProduct image tokens: ${refList || '(none)'}.`
  // VERIFIER (hook-drop): when beats > scenes, gpt has been seen "grouping" by DELETING the opening
  // person/hook beats and keeping only product b-roll (a FÜM clone opened at src 5s — the coughing-man
  // hook was gone). If the plan doesn't start at the source's beginning, retry once with a correction.
  let scenes = []
  for (let attempt = 1; attempt <= 2; attempt++) {
    const messages = [{ role: 'system', content: sys }, { role: 'user', content: usr }]
    if (attempt === 2) messages.push({ role: 'user', content: `Your previous plan skipped the reference's opening — scene 1 must start at src_start=0 and recreate the ORIGINAL FIRST BEAT (including its people). Merge later beats to fit ${nScenes} scenes. Regenerate the full JSON.` })
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: OPENAI_MODEL, temperature: 0.7, response_format: { type: 'json_object' }, messages }),
    })
    if (!r.ok) throw new Error(`openai scenes ${r.status} ${(await r.text()).slice(0, 160)}`)
    const j = await r.json()
    const out = JSON.parse(j.choices?.[0]?.message?.content || '{}')
    scenes = Array.isArray(out.scenes) ? out.scenes.filter((s) => s && s.prompt) : []
    if (!scenes.length) throw new Error('no scenes from gpt')
    const firstStart = Number(scenes[0]?.src_start)
    if (!(Number.isFinite(firstStart) && firstStart >= 3) || attempt === 2) break
    console.warn(`scene plan dropped the hook (scene 1 starts at src ${firstStart}s) — retrying with correction`)
  }
  const picked = scenes.slice(0, nScenes)
  // Per-scene duration follows the ad's REAL structure: use each scene's source time-range length
  // (src_end - src_start) when Gemini gave one; otherwise split the source duration evenly. Clamped to
  // Seedance's 5-15s range. Net effect: total ≈ the source length, so 3 scenes = 3 SHORTER clips (a
  // faithful ~14s clone), not 3×10s = 30s. This is what makes "clone = match the source" hold for
  // whatever real scene count the source has.
  // Durations follow the source's REAL cut lengths — fast-cut ads have 1-2s scenes and the clone
  // keeps them. Seedance can't RENDER below ~4s, so short scenes are rendered at 4s and TRIMMED to
  // their true length at stitch (concatClips hard-caps each clip to its planned duration).
  const srcSecs = Number(beat && beat.duration_seconds) || (picked.length * 7)
  const evenSplit = Math.max(1, Math.min(15, Math.round(srcSecs / picked.length)))
  return picked.map((s) => {
    const span = (Number.isFinite(+s.src_end) && Number.isFinite(+s.src_start)) ? Math.round((+s.src_end - +s.src_start) * 10) / 10 : 0
    const dur = span > 0 ? Math.max(1, Math.min(15, span)) : evenSplit
    return {
      prompt: String(s.prompt), script: String(s.script || ''),
      duration: dur,
      has_people: s.has_people !== false,   // default TRUE (safe: no ref video unless surely people-free)
      has_product: s.has_product !== false, // default TRUE (safe: route to the high-fidelity generator)
      // Cast letters (A/B…) — same letter = same person across scenes; drives per-character anchors.
      cast: Array.isArray(s.cast) ? s.cast.map(String).slice(0, 2) : (s.has_people !== false ? ['A'] : []),
      src_start: Number.isFinite(+s.src_start) ? Math.max(0, +s.src_start) : null,
      src_end: Number.isFinite(+s.src_end) ? +s.src_end : null,
    }
  })
}

// ── gpt-4o: split the APPROVED script into N contiguous segments for long-form UGC (30/60s).
// Returns ONE reusable character paragraph + ONE voice description — pasted VERBATIM into every
// segment prompt so the person/voice can't drift between clips — plus per-segment script + action. ──
async function buildSegmentPlan(beat, product, nImages, script, nSegments, look, isService) {
  const refList = Array.from({ length: nImages }, (_, i) => `[Image${i + 1}]`).join(', ')
  const recast = look && look !== 'match'
  const sys = `You direct a ${nSegments}-segment TALKING-HEAD UGC ad (segments are stitched into one continuous video). Rules:
- Split the user's voiceover script into EXACTLY ${nSegments} contiguous chunks at natural sentence boundaries — in order, no overlap, no rewriting; together they must be the full script word-for-word.
- "character": ONE dense reusable paragraph describing the on-camera creator in precise repeatable detail — age, ${recast ? `${look} appearance (user's explicit choice)` : `ethnicity/look copied from the reference avatar (${(beat && beat.avatar) || 'as analysed'})`}, hair, wardrobe, plus the exact setting (${(beat && beat.setting) || 'as analysed'}). The SAME paragraph opens every segment prompt so the person cannot drift.
- "voice": one short line describing their voice (tone, pace, energy) — reused each segment for audio consistency.
- Per segment "action": ${isService ? 'what the creator does while talking about the service — gesturing, showing the app/site on their phone, a lifestyle beat (never holding a physical product)' : `what they physically do with the user's product (${refList || 'the product'}) in that segment — hold it up, demonstrate, close-up`} — following the reference beats in order.
${productTruthRule(product, isService)}
Return ONLY minified JSON: {"character":"","voice":"","segments":[{"script":"","action":""}]}  (exactly ${nSegments} segments).`
  const usr = `REFERENCE AD (beat sheet):\n${JSON.stringify(beat || {})}\n\nUSER PRODUCT:\n${JSON.stringify(product)}\n\nAPPROVED SCRIPT (split this, verbatim):\n${script}`
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: OPENAI_MODEL, temperature: 0.5, response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: sys }, { role: 'user', content: usr }] }),
  })
  if (!r.ok) throw new Error(`openai segments ${r.status} ${(await r.text()).slice(0, 160)}`)
  const j = await r.json()
  const out = JSON.parse(j.choices?.[0]?.message?.content || '{}')
  const segs = Array.isArray(out.segments) ? out.segments.filter((s) => s && (s.script || s.action)) : []
  if (!segs.length || !out.character) throw new Error('no segment plan from gpt')
  return { character: String(out.character), voice: String(out.voice || 'the same natural voice as before'), segments: segs.slice(0, nSegments) }
}

// Compose one segment's Seedance prompt: verbatim character block + continuity anchor + exact words.
function segmentPrompt(plan, seg, i, total, hasAnchor, nImages, lang, opts = {}) {
  const { sizeAnchor, creatorLock, productFree } = opts
  // PRODUCT-FREE variant: once we know Seedance can't render THIS product, later segments must NOT hold
  // it (a wrong product on a moving hand can't be patched cleanly). The creator talks to camera with
  // empty/gesturing hands; the real product is shown separately via accurate real-photo cutaways.
  if (productFree) {
    const pf = [plan.character]
    if (creatorLock) pf.push(`CRITICAL — SAME PERSON: the on-camera creator MUST look EXACTLY like this: ${creatorLock}. Match face, age, skin tone, hair and outfit precisely.`)
    pf.push(`The creator speaks directly to camera at arm's length with natural hand gestures — hands are EMPTY or gesturing. NO product is held or shown in this shot.`)
    pf.push(`They speak in ${langName(lang).split(' — ')[0]} — ${plan.voice} — lips moving in sync, saying these exact words aloud: "${String(seg.script || '').replace(/"/g, "'")}"`)
    if (seg.action) pf.push(String(seg.action).replace(/\b(hold|holds|holding|show|shows|showing|grab|grabs|grip|grips|lift|lifts|raise|raises)\b[^.]*/gi, 'gestures naturally'))
    pf.push('UGC realism: iPhone selfie framing at arm\'s length, natural light, authentic handheld, no on-screen captions.')
    return pf.filter(Boolean).join(' ')
  }
  const productRef = hasAnchor
    ? (nImages ? `[Image2]${nImages > 1 ? `–[Image${nImages + 1}]` : ''}` : 'the product')
    : (nImages ? `[Image1]${nImages > 1 ? `–[Image${nImages}]` : ''}` : 'the product')
  const parts = [plan.character]
  // CREATOR LOCK (segment re-shoot): an exact appearance captured from a KEPT part of THIS video, so
  // a re-rolled segment keeps the SAME person instead of a new random face. Overrides drift.
  if (creatorLock) parts.push(`CRITICAL — SAME PERSON: the on-camera creator MUST look EXACTLY like this (they already appear in the rest of this video): ${creatorLock}. Match the face, age, skin tone, hair and outfit precisely — do NOT change the person.`)
  if (hasAnchor) parts.push(`This is segment ${i + 1} of ${total} of ONE continuous selfie take. [Image1] shows this exact creator one moment ago — treat it as ground truth: the SAME face, hair, outfit, room and lighting, continuing seamlessly. The user's product is ${productRef} and must match it exactly.`)
  else parts.push(`The user's product is ${productRef} and must match it exactly.`)
  parts.push(`They speak to camera in ${langName(lang).split(' — ')[0]} — ${plan.voice} — lips moving in sync, saying these exact words aloud: "${String(seg.script || '').replace(/"/g, "'")}"`)
  if (seg.action) parts.push(String(seg.action))
  if (nImages) parts.push(`PRODUCT TRUTH: whenever ${productRef} is shown, render it EXACTLY as the attached photo — same container type, silhouette, closure, label and colours. Do NOT add, remove or change ANY part vs the photo (cap, lid, spout, nozzle, pump, straw, neck, box, wrapper): keep the exact form factor shown, whatever it is (a pouch stays a pouch, a bottle stays that bottle, a jar stays that jar).`)
  // TRUE SCALE — video models inflate held products; anchor the size so a re-shoot doesn't balloon it.
  if (nImages && sizeAnchor) parts.push(`REAL SIZE: the product is ${sizeAnchor}. Render it at that true real-world scale relative to the hand and face — get it readable by bringing the CAMERA closer, NEVER by enlarging the product. An oversized, out-of-proportion product looks fake.`)
  parts.push('UGC realism: iPhone selfie framing at arm\'s length, natural light, authentic handheld, no on-screen captions.')
  return parts.filter(Boolean).join(' ')
}

// ── Trim the competitor video to fal's reference limits (≤15.1s, 480-720p) ────
// Seedance rejects reference videos over ~15s or above 720p. Ad videos routinely exceed both, so we
// take the first 14s (where the hook lives) and cap the longer side at 1280 (→ 720p for 9:16), then
// re-host the trimmed clip on R2 for fal to fetch. ffmpeg is on the worker image (animate-worker uses it).
function ff(args) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', args)
    let err = ''
    p.stderr.on('data', (d) => { err += d.toString() })
    p.on('close', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}: ${err.slice(-300)}`)))
    p.on('error', reject)
  })
}
async function trimReference(url, id, opts = {}) {
  // opts.start/duration cut a SPECIFIC segment (per-scene motion reference for faithful mode);
  // defaults keep the original behavior: first 14s (where the hook lives).
  const start = Math.max(0, Number(opts.start) || 0)
  const dur = Math.min(14, Math.max(2, Number(opts.duration) || 14))
  const tag = opts.tag || 'ref'
  const base = join(tmpdir(), `ref-${id}-${tag}`)
  const inFile = `${base}.in.mp4`, outFile = `${base}.out.mp4`
  try {
    const r = await fetch(url)
    if (!r.ok) throw new Error(`fetch ref ${r.status}`)
    await writeFile(inFile, Buffer.from(await r.arrayBuffer()))
    // cut [start, start+dur]; cap longer side at 1280 (shorter → ≤720); yuv420p h264 for compatibility.
    await ff(['-y', '-ss', String(start), '-i', inFile, '-t', String(dur),
      '-vf', "scale='if(gt(iw,ih),1280,-2)':'if(gt(iw,ih),-2,1280)'",
      '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', outFile])
    // fal rejects reference videos under 2.0s ("video_duration_too_short", a 422 that fails the WHOLE
    // job). When src_start sits near the end of the ad, ffmpeg produces a clip shorter than requested
    // (e.g. 0.75s) even though we asked for more. Probe the real output length and bail (return null) so
    // the caller falls back to prompt-only for that scene instead of crashing the entire render.
    const outSecs = await probeDuration(outFile)
    if (outSecs != null && outSecs < 2.1) { console.warn(`ref ${tag} only ${outSecs.toFixed(2)}s (<2.1s) — skipping motion-ref, prompt-only`); return null }
    const mp4 = await readFile(outFile)
    const key = `creatives/tmp/${id}-${tag}.mp4`
    await r2.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key, Body: mp4, ContentType: 'video/mp4', CacheControl: 'public, max-age=86400' }))
    return `${R2_PUBLIC}/${key}`
  } finally {
    await rm(inFile, { force: true }).catch(() => {})
    await rm(outFile, { force: true }).catch(() => {})
  }
}

// ── Multi-clip assembly helpers (faithful scenes + long-form UGC segments) ────
async function downloadToFile(url, path) {
  // Hard timeout: a naked fetch can hang FOREVER on a dead CDN connection, which left jobs stuck in
  // 'processing' with no error — the class of failure only an admin could see. 3 min is generous for
  // any clip; on abort the error is retryable, so the self-heal path resumes from checkpoints.
  const r = await fetch(url, { signal: AbortSignal.timeout(180_000) })
  if (!r.ok) throw new Error(`download clip ${r.status}`)
  await writeFile(path, Buffer.from(await r.arrayBuffer()))
}

// Concat local clips into one mp4. Re-encode via the concat demuxer — clips come from the same
// model/resolution/aspect but re-encoding guarantees clean joins.
async function concatClips(files, out, durs) {
  // Clips come from DIFFERENT generators (Seedance ~24fps, VACE 16fps, varying resolution/timebase).
  // The concat demuxer assumes identical stream parameters; feeding it mixed clips produced broken
  // timestamps — a ~3s FREEZE at the scene boundary and a stitched file ~5s LONGER than its clips
  // (the "pauses at 10-13s" + 21s-for-16s-of-scenes the user hit). Normalize every clip to one format
  // (first clip's WxH, 24fps, square pixels, 44.1k stereo) and trim each to its PLANNED duration
  // before concatenating — deterministic for any mix of generators, any ad, any product.
  const probe = await probeOut(['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=s=x:p=0', files[0]])
  const [w, h] = String(probe || '').trim().split('x').map((n) => parseInt(n) || 0)
  const W = w > 0 ? w : 720, H = h > 0 ? h : 1280
  const normed = []
  for (let i = 0; i < files.length; i++) {
    const nf = `${out}.n${i}.mp4`
    const args = ['-y', '-i', files[i]]
    if (durs && Number(durs[i]) > 0) args.push('-t', String(Number(durs[i])))   // planned length is a hard cap per clip
    args.push('-vf', `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,fps=24,setsar=1`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '44100', '-ac', '2', '-b:a', '128k', nf)
    await ff(args)
    normed.push(nf)
  }
  const list = `${out}.txt`
  await writeFile(list, normed.map((f) => `file '${f}'`).join('\n'))
  try {
    // Normalized clips share identical parameters → stream-copy concat is safe and lossless.
    await ff(['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', out])
  } finally {
    await rm(list, { force: true }).catch(() => {})
    for (const f of normed) await rm(f, { force: true }).catch(() => {})
  }
}

// ── PRODUCT-IMAGE INSERT: composite the user's REAL product photo (Ken-Burns) over one or more time
// windows of a finished video, keeping the original audio. The reliable fix for a product Seedance
// can't render (a flat pouch it keeps giving a spout): stop trusting the generator for those beats,
// show the actual photo. `windows` = [{from,len}] seconds. ffmpeg-only. Returns `out`. ──
async function coverWindowsWithProduct(videoIn, out, windows, prodUrl, id, tmp) {
  if (!prodUrl || !windows || !windows.length) return videoIn
  const dims = await probeOut(['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=s=x:p=0', videoIn])
  const [W, H] = String(dims || '').trim().split('x').map((n) => parseInt(n) || 0)
  const w = W || 720, h = H || 1280
  const total = (await probeDuration(videoIn)) || 25
  const prodLocal = `${out}.prod.png`; tmp.push(prodLocal)
  await downloadToFile(prodUrl, prodLocal)
  const still = `${out}.still.png`; tmp.push(still)
  await ff(['-y', '-i', prodLocal, '-filter_complex',
    `[0:v]split=2[a][b];[a]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=18:2,eq=brightness=-0.05[bg];[b]scale=-1:${Math.round(h * 0.66)}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2[v]`,
    '-map', '[v]', '-frames:v', '1', still])
  const card = `${out}.card.mp4`; tmp.push(card)
  try {
    await ff(['-y', '-loop', '1', '-i', still, '-vf', `zoompan=z='min(zoom+0.0004,1.10)':d=${Math.round(total * 24)}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${w}x${h}:fps=24,format=yuv420p`, '-t', String(total), '-r', '24', card])
  } catch (e) {
    console.warn(`product-insert zoompan failed (${e.message}) — static hold`)
    await ff(['-y', '-loop', '1', '-t', String(total), '-i', still, '-vf', 'fps=24,format=yuv420p', '-r', '24', card])
  }
  const enable = windows.map((x) => `between(t,${(+x.from).toFixed(2)},${(+x.from + +x.len).toFixed(2)})`).join('+')
  await ff(['-y', '-i', videoIn, '-i', card,
    '-filter_complex', `[1:v]setpts=PTS-STARTPTS[c];[0:v][c]overlay=eof_action=pass:enable='${enable}'[v]`,
    '-map', '[v]', '-map', '0:a?', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', out])
  console.log(`🖼 ${id} composited real product over ${windows.length} window(s)`)
  return out
}


// Continuity anchor: extract a clip's final frame and host it on R2, so the NEXT segment can take it
// as @Image1 ("the exact same creator/room as this frame"). Identity flows through actual pixels,
// not just a text description — the main defence against character drift across stitched clips.
async function lastFrameAnchor(file, id, idx) {
  const jpg = `${file}.last.jpg`
  try {
    await ff(['-y', '-sseof', '-0.15', '-i', file, '-frames:v', '1', '-q:v', '3', jpg])
    const buf = await readFile(jpg)
    const key = `creatives/tmp/${id}-seg${idx}-anchor.jpg`
    await r2.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key, Body: buf, ContentType: 'image/jpeg', CacheControl: 'public, max-age=86400' }))
    return `${R2_PUBLIC}/${key}`
  } finally { await rm(jpg, { force: true }).catch(() => {}) }
}

// One consistent grade across every Cinematic scene — kills the random black-and-white / moody drift
// that made stitched scenes read as three different ads.
const STYLE_LOCK = ' STYLE LOCK: full colour, bright natural lighting, one consistent realistic colour grade across the whole ad — never black-and-white, never a different mood or film look from the other scenes.'
// Director-grade realism layer (adapted from the Seedance shotlist-director method). The cues that
// actually move Seedance toward cinema — photoreal (no CGI look), motivated camera, physical light,
// pore-level skin, Hollywood micro-acting, real physics, 24fps. Deliberately ONE tight block, not the
// full 12-line prefix, because prompt bloat degrades Seedance ([[project_clone_prompt_lesson]]). Applied
// to CINEMATIC scenes only (UGC's tuned prompt is untouched); toggle with SEEDANCE_DIRECTOR=off.
const DIRECTOR_STYLE = ' CINEMATIC DIRECTION: photorealistic, shot on a physical cine lens with natural motion blur — no 3D/CGI/game-engine look. A motivated camera move (a real reason to push or track). Natural motivated lighting with gentle atmospheric depth. Pore-level skin realism, catch-lights in living eyes, Hollywood micro-acting — micro-pauses, real breathing, precise eye-line, always reacting, never a static pose. Real gravity and weight, correct contact shadows. Smooth 24fps, sharp detail.'

// Composition still for people-free b-roll: the middle frame of the trimmed source beat, hosted on R2,
// passed as an @Image so the shot matches the source's framing/subject placement even when the motion
// reference is unavailable or rejected. Faceless by construction (people-free scenes only) → no
// likeness-filter risk.
async function stillFromClip(clipUrl, id, tag) {
  const f = join(tmpdir(), `still-${id}-${tag}.mp4`)
  const jpg = join(tmpdir(), `still-${id}-${tag}.jpg`)
  try {
    await downloadToFile(clipUrl, f)
    const dur = (await probeDuration(f)) || 4
    await ff(['-y', '-ss', String(Math.max(0.2, dur / 2)), '-i', f, '-frames:v', '1', '-q:v', '3', jpg])
    const buf = await readFile(jpg)
    const key = `creatives/tmp/${id}-${tag}-still.jpg`
    await r2.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key, Body: buf, ContentType: 'image/jpeg', CacheControl: 'public, max-age=86400' }))
    return `${R2_PUBLIC}/${key}`
  } finally { await rm(f, { force: true }).catch(() => {}); await rm(jpg, { force: true }).catch(() => {}) }
}

// Storyboard reference frames: grab one frame from the SOURCE video at each beat's moment so the
// pre-generation storyboard shows a real film strip (not text). Best-effort — mutates beats[i].thumb
// in place, downloads the source ONCE. Any failure leaves beats untouched (caller wraps in try/catch).
async function storyboardFrames(sourceVideoUrl, beat, wantN, id) {
  if (!sourceVideoUrl || !beat) return
  let beats = Array.isArray(beat.beats) ? beat.beats : []
  // Single-take UGC analyzes with NO beats — synthesize N slots (N = the scene count) so each
  // storyboard scene still gets a real reference frame, sampled evenly across the source video.
  if (!beats.length) { const n = Math.max(1, Math.min(8, Math.round(Number(wantN) || 3))); beats = Array.from({ length: n }, () => ({ action: '' })); beat.beats = beats }
  const f = join(tmpdir(), `sb-${id}.mp4`)
  try {
    await downloadToFile(sourceVideoUrl, f)
    const dur = (await probeDuration(f)) || 15
    let ok = 0
    for (let i = 0; i < Math.min(beats.length, 12); i++) {
      const start = parseFloat(String(beats[i]?.t ?? '').replace(/[^\d.].*$/, ''))
      // No timestamp (synthesized slot) → sample at the scene's MIDPOINT across the clip.
      const at = Math.max(0.2, Math.min(dur - 0.2, Number.isFinite(start) ? start : ((i + 0.5) * dur) / beats.length))
      const jpg = join(tmpdir(), `sb-${id}-${i}.jpg`)
      try {
        await ff(['-y', '-ss', String(at), '-i', f, '-frames:v', '1', '-q:v', '4', '-vf', 'scale=360:-1', jpg])
        const key = `creatives/storyboard/${id}/${i}.jpg`
        await r2.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key, Body: await readFile(jpg), ContentType: 'image/jpeg', CacheControl: 'public, max-age=86400' }))
        if (beats[i]) beats[i].thumb = `${R2_PUBLIC}/${key}`
        ok++
      } catch (e) { console.warn(`sb-frame ${id} #${i}:`, e.message) /* one bad frame shouldn't kill the strip */ } finally { await rm(jpg, { force: true }).catch(() => {}) }
    }
    console.log(`🎞 ${id} storyboard frames: ${ok}/${Math.min(beats.length, 12)} grabbed from source`)
  } catch (e) { console.warn(`storyboardFrames ${id}:`, e.message) } finally { await rm(f, { force: true }).catch(() => {}) }
}

// Upload a local audio file (the cinematic VO mp3) to R2 so the Remotion timeline can play it as a
// track (Remotion re-assembles from the SILENT scene clips; without this the Remotion cut is silent).
async function uploadAudioR2(localPath, key) {
  const buf = await readFile(localPath)
  await r2.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key, Body: buf, ContentType: 'audio/mpeg', CacheControl: 'public, max-age=86400' }))
  return `${R2_PUBLIC}/${key}`
}

// Split a script into evenly-timed caption cues across [start,end] — matches the app's cuesFromScript.
function cuesFromScriptJS(script, start, end, maxPerCue = 7) {
  const words = String(script || '').trim().split(/\s+/).filter(Boolean)
  if (!words.length || end <= start) return []
  const chunks = []
  for (let i = 0; i < words.length; i += maxPerCue) chunks.push(words.slice(i, i + maxPerCue).join(' '))
  const per = (end - start) / chunks.length
  return chunks.map((text, i) => ({ startSec: +(start + i * per).toFixed(2), endSec: +(start + (i + 1) * per).toFixed(2), text }))
}

// Build the Remotion Timeline for a cinematic render: silent scene clips (Series) + the VO audio track
// + captions from the script + brand. selfmade-render assembles this into the final (transitions +
// brand frame) — the same shape the app's build-timeline produces. Kept minimal + defensive.
function buildCinematicTimeline(meta, scenes, clipsDone, script, voUrl) {
  const kit = meta.brand_kit || {}
  const sc = (scenes || []).map((s, i) => ({
    id: `s${i}`, role: i === 0 ? 'hook' : 'other', src: clipsDone[i], trimStart: 0,
    durationSec: Math.max(1, Number(s && s.duration) || 5), talking: !!(s && s.has_people),
  })).filter((x) => x.src)
  if (!sc.length) return null
  const total = sc.reduce((a, x) => a + x.durationSec, 0)
  return {
    version: 1, format: 'cinematic', fps: 30, aspect: meta.aspect || '9:16',
    brand: { logo: kit.logo || null, colors: { cta: (kit.palette && kit.palette.cta) || '#639922', accent: (kit.palette && kit.palette.accent) || '#dffe95', text: '#17251c' } },
    audio: { voiceover: voUrl || null, music: null },
    scenes: sc,
    layers: cuesFromScriptJS(script, 0, total).length ? [{ type: 'captions', style: 'block', color: '#ffffff', cues: cuesFromScriptJS(script, 0, total) }] : [],
  }
}

// ── PRODUCT-PERFECT KEYFRAME (people-scenes) ─────────────────────────────────
// The core fidelity trick: IMAGE models render a small product pixel-perfect (our image clone
// proves it daily); VIDEO models invent a generic blurry bottle the moment a person holds it in a
// wide shot. So for people+product scenes we no longer ask the video model to imagine the product:
// Nano Banana composes a photoreal STILL of the scene's person holding the EXACT product (label
// readable, correct container), and that still leads the video model's reference images — the video
// model just has to MOVE a frame that is already correct. Cost ≈ 1-2¢/scene, pure fidelity upside.
const GEMINI_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL_PRO || process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image'
async function fetchB64(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`fetch ${r.status}`)
  const buf = Buffer.from(await r.arrayBuffer())
  return { mime: r.headers.get('content-type') || 'image/jpeg', b64: buf.toString('base64') }
}
// Nano Banana image call with retry — gemini-*-image 503s ("high demand") constantly; without retry a
// clean-product / keyframe silently skips and we lose the fidelity safety net for that render.
async function geminiImage(prompt, imgs) {
  const body = { contents: [{ parts: [{ text: prompt }, ...imgs.map((i) => ({ inline_data: { mime_type: i.mime, data: i.b64 } }))] }], generationConfig: { responseModalities: ['IMAGE'] } }
  let lastErr = 'gemini image failed'
  for (let attempt = 1; attempt <= 4; attempt++) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${GEMINI_KEY}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (r.ok) {
      const j = await r.json()
      const part = (j?.candidates?.[0]?.content?.parts || []).find((p) => p.inline_data || p.inlineData)
      const inline = part?.inline_data || part?.inlineData
      if (inline?.data) return inline
      lastErr = 'no image in response'
    } else {
      lastErr = `gemini image ${r.status}`
      if (![429, 500, 503].includes(r.status)) break
    }
    if (attempt < 4) await sleep(1200 * attempt)
  }
  throw new Error(lastErr)
}
async function composeKeyframe({ scenePrompt, productImageUrls, jobId, tag, aspect }) {
  if (!GEMINI_KEY || !productImageUrls?.length) return null
  const imgs = []
  for (const u of productImageUrls.slice(0, 3)) { try { imgs.push(await fetchB64(u)) } catch { /* skip */ } }
  if (!imgs.length) return null
  const prompt = `Photorealistic vertical ${aspect || '9:16'} video still — the FIRST frame of this scene, captured MID-ACTION: ${scenePrompt}\n` +
    `Show the hands actively USING the product the way the scene describes (mid-application — e.g. bringing the applicator to the scalp/skin, mid-roll, mid-spray, mid-pump), not a static posed hold. The product must be an EXACT match of the attached photos — identical container, cap/applicator, colours and label, sharp and readable, close to camera BUT at its TRUE real-world size and proportion relative to the hand — never enlarged, stretched or out of proportion (a small handheld device stays small in the hand). Natural UGC lighting, real skin texture, no on-screen text or watermarks.\n` +
    // NO FACE — deliberate: fal's likeness filter rejects reference images containing realistic faces
    // (it killed the segment anchors the same way). Framing the ACTION from chin-down / behind /
    // top-down keeps the face out while still showing the motion, so the keyframe passes the filter AND
    // cues Seedance to animate the real action instead of a static hold.
    `FRAMING RULE: NO face may be visible — crop from the chin down, over-the-shoulder, from behind, or top-down; the hands, the point of application and the product fill the frame.`
  const inline = await geminiImage(prompt, imgs)
  const key = `creatives/tmp/${jobId}-${tag}-keyframe.png`
  await r2.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key, Body: Buffer.from(inline.data, 'base64'), ContentType: inline.mime_type || inline.mimeType || 'image/png', CacheControl: 'public, max-age=86400' }))
  return `${R2_PUBLIC}/${key}`
}

// Person-free product reference: users upload product photos that often show a HAND holding the item,
// and fal's likeness filter rejects any reference image containing a real person → the whole render
// 422s on image_urls. Nano Banana re-shoots the product ALONE on a clean background (no hands, no
// people), so the reference we hand fal is always safe — for any product, any uploaded photo. Runs
// once per job (~1-2¢), cached in clone_meta.
async function composeCleanProduct({ productImageUrls, jobId }) {
  if (!GEMINI_KEY || !productImageUrls?.length) return null
  const imgs = []
  for (const u of productImageUrls.slice(0, 3)) { try { imgs.push(await fetchB64(u)) } catch { /* skip */ } }
  if (!imgs.length) return null
  const prompt = 'Studio product photo: the EXACT product from the attached photos, isolated on a clean seamless neutral-grey background. Identical container, cap/applicator, colours and label text — sharp and readable, product large and centered. NO hands, NO people, NO other objects — only the product.'
  const inline = await geminiImage(prompt, imgs)
  const key = `creatives/tmp/${jobId}-clean-product.png`
  await r2.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key, Body: Buffer.from(inline.data, 'base64'), ContentType: inline.mime_type || inline.mimeType || 'image/png', CacheControl: 'public, max-age=86400' }))
  return `${R2_PUBLIC}/${key}`
}

// ── ASSET-LOCK (Higgsfield method): lock reusable reference sheets ONCE up front, then every scene
// references the SAME locked assets. This is the fix for cross-scene drift — the product/character/
// location stop morphing between cuts because they're anchored to one canonical sheet, not re-invented
// per scene. All are SINGLE composite images (multi-angle in one frame) so the ref count stays at 2 and
// Seedance doesn't inflate the product's size. Cached on clone_meta, ~1-2¢ each, once per job. ──

// PRODUCT SHEET — front + 3/4 views of the exact product in one clean frame, so the video model knows
// the product from every side (a flat single-angle photo drifts when the camera moves around it).
async function composeProductSheet({ productImageUrls, jobId }) {
  if (!GEMINI_KEY || !productImageUrls?.length) return null
  const imgs = []
  for (const u of productImageUrls.slice(0, 3)) { try { imgs.push(await fetchB64(u)) } catch { /* skip */ } }
  if (!imgs.length) return null
  const prompt = 'Clean studio PRODUCT SHEET of the EXACT product from the attached photos: two views of the SAME product side by side in one frame — a front view on the left and a 3/4 perspective view on the right, both at matched scale and lighting. Identical container, cap/applicator, colours and label text — sharp and readable. Plain seamless neutral-grey background. NO hands, NO people, NO other objects, NO text overlays — only the product, shown from these two angles.'
  const inline = await geminiImage(prompt, imgs)
  const key = `creatives/tmp/${jobId}-product-sheet.png`
  await r2.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key, Body: Buffer.from(inline.data, 'base64'), ContentType: inline.mime_type || inline.mimeType || 'image/png', CacheControl: 'public, max-age=86400' }))
  return `${R2_PUBLIC}/${key}`
}

// LOCATION PLATE — an empty photoreal still of the scene's setting at a 3/4 angle (depth for the camera
// to move through — a flat head-on room drifts). One plate per distinct setting, reused across the
// scenes that share it, so backgrounds stay consistent cut to cut.
async function composeLocationPlate({ setting, jobId, aspect }) {
  if (!GEMINI_KEY || !setting) return null
  const prompt = `Photorealistic ${aspect || '9:16'} establishing STILL of this location, empty (no people): ${String(setting).slice(0, 400)}. Shot at a 3/4 angle to give the room real depth, high-end commercial look, natural cinematic lighting, no on-screen text or watermarks.`
  let inline
  try { inline = await geminiImage(prompt, []) } catch { return null }
  const key = `creatives/tmp/${jobId}-loc-${Math.abs([...String(setting)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7)).toString(36)}.png`
  await r2.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key, Body: Buffer.from(inline.data, 'base64'), ContentType: inline.mime_type || inline.mimeType || 'image/png', CacheControl: 'public, max-age=86400' }))
  return `${R2_PUBLIC}/${key}`
}

// ── Voice mapping: our 4 UI voices (OpenAI names) → an ElevenLabs preset of the same gender/energy,
// so a user's pick stays consistent across languages. Overridable per-voice via env. ──
const ELEVEN_VOICE_MAP = {
  nova: process.env.ELEVEN_VOICE_NOVA || '21m00Tcm4TlvDq8ikWAM',    // Rachel — warm female
  shimmer: process.env.ELEVEN_VOICE_SHIMMER || 'EXAVITQu4vr4xnSDxMaL', // Sarah — soft female
  onyx: process.env.ELEVEN_VOICE_ONYX || 'pNInz6obpgDQGcFmaJgB',    // Adam — deep male
  echo: process.env.ELEVEN_VOICE_ECHO || 'ErXwobaYiN019PkySvjV',    // Antoni — bright male
}
async function elevenTts(text, voice, out) {
  const voiceId = ELEVEN_VOICE_MAP[voice] || ELEVEN_VOICE_MAP.nova
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({
      text: String(text).slice(0, 4000),
      model_id: process.env.ELEVEN_TTS_MODEL || 'eleven_multilingual_v2',
      voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true },
    }),
  })
  if (!r.ok) throw new Error(`eleven ${r.status} ${(await r.text()).slice(0, 120)}`)
  await writeFile(out, Buffer.from(await r.arrayBuffer()))
  return out
}
// ── Single-voice narration (faithful/b-roll + UGC modes): one TTS track for the WHOLE script, muxed
// over the stitched video. OpenAI TTS is excellent at English but only mediocre at Urdu/Hindi/Arabic —
// so for NON-English we route to ElevenLabs Multilingual v2 (near-human Urdu) WHEN a key is set, and
// fall back to OpenAI if ElevenLabs errors or has no key. English always stays on OpenAI. ──
async function ttsVoiceover(text, id, voice, lang) {
  const f = join(tmpdir(), `vo-${id}.mp3`)
  const nonEn = lang && String(lang).slice(0, 2) !== 'en'
  if (nonEn && process.env.ELEVENLABS_API_KEY) {
    try {
      await elevenTts(text, voice || 'nova', f)
      console.log(`🎙 vo ${id} via ElevenLabs (${lang})`)
      return f
    } catch (e) { console.warn(`ElevenLabs tts failed for ${id} (${e.message}) — falling back to OpenAI`) }
  }
  const r = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST', headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: process.env.CLONE_TTS_MODEL || 'gpt-4o-mini-tts', voice: voice || process.env.CLONE_TTS_VOICE || 'nova', input: String(text).slice(0, 4000), response_format: 'mp3' }),
  })
  if (!r.ok) throw new Error(`tts ${r.status} ${(await r.text()).slice(0, 120)}`)
  await writeFile(f, Buffer.from(await r.arrayBuffer()))
  return f
}
async function muxVoiceover(videoIn, voMp3, out) {
  // The video length = max(clips, voiceover), computed EXPLICITLY and hard-cut with `-t`. We used to
  // freeze-extend by a fixed 20s and rely on `-shortest` to trim back — but `-shortest` does NOT trim
  // a tpad-generated (cloned-frame) video stream, so the freeze ran to its full length and produced a
  // 42s video for a 17s voiceover. Computing the exact target and capping with -t removes the guesswork:
  // the last frame holds only for however long the narration actually tails past the clips (usually ~0).
  const clipsDur = await probeDuration(videoIn)
  const voDur = await probeDuration(voMp3)
  // DEAD-AIR GUARD: when the stitched video runs LONGER than the narration (scene durations can
  // overshoot the source), don't keep the whole tail playing in silence — trim to the voiceover length
  // plus a short product/b-roll tail. When the VO is longer, freeze-extend the video to it (as before).
  const VO_TAIL = 2.5   // seconds of visuals allowed to run past the narration before we cut
  const target = (voDur || 0) >= (clipsDur || 0)
    ? (voDur || 0) + 0.2
    : Math.min(clipsDur || 0, (voDur || 0) + VO_TAIL)
  const pad = Math.max(0, +(target - (clipsDur || 0)).toFixed(2))   // freeze only the tail the VO needs (0 when trimming)
  try {
    await ff(['-y', '-i', videoIn, '-i', voMp3, '-filter_complex',
      `[0:v]tpad=stop_mode=clone:stop_duration=${pad}[vp];[0:a]volume=0.22[a0];[a0][1:a]amix=inputs=2:duration=longest[a]`,
      '-map', '[vp]', '-map', '[a]', '-t', String(target.toFixed(2)), '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out])
  } catch {
    // No/odd ambient stream → narration over the frame-extended video only.
    await ff(['-y', '-i', videoIn, '-i', voMp3, '-filter_complex', `[0:v]tpad=stop_mode=clone:stop_duration=${pad}[vp]`,
      '-map', '[vp]', '-map', '1:a', '-t', String(target.toFixed(2)), '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out])
  }
}

// ── fal Seedance 2.0 reference-to-video (queue REST) ──────────────────────────
// Seedance defaults to dreamy SLOW MOTION when a clip is conditioned on a still image (faithful
// scenes, anchored long-form segments) — which is exactly why the voiceover clones looked slow/unreal
// next to a single UGC take that rides the source video's real motion. This one-line directive forces
// natural real-time pacing on EVERY generation (harmless on the already-good UGC take, corrective on
// the others). Kept to one sentence on purpose — prompt bloat degrades these models ([[project_clone_prompt_lesson]]).
const REALISM = 'Natural real-time motion at normal human speed — lively, lifelike movement, absolutely NOT slow motion; photorealistic, sharp focus, real skin and eyes.'
async function falGenerate({ prompt, imageUrls, videoUrl, resolution, duration, aspect, tier, generateAudio }) {
  // Initial generation now runs on Seedance 2.5 (reference-to-video) — dramatically better adherence to
  // the approved storyboard keyframes than 2.0. Kept env-overridable (mirrors SEEDANCE_EDIT_MODEL) so the
  // exact fal slug can be corrected without a redeploy. Fast tier stays on the cheaper 2.0 fast model
  // unless SEEDANCE_GEN_MODEL_FAST is set.
  const model = tier === 'fast'
    ? (process.env.SEEDANCE_GEN_MODEL_FAST || 'bytedance/seedance-2.0/fast/reference-to-video')
    : (process.env.SEEDANCE_GEN_MODEL || 'bytedance/seedance-2.5/reference-to-video')
  const fullPrompt = /slow motion|real-time motion/i.test(prompt) ? prompt : `${prompt} ${REALISM}`
  // generate_audio defaults true (UGC/segments need Seedance's baked lip-synced speech), but FAITHFUL
  // scenes pass false: they're silent b-roll with a TTS voiceover added in post, and asking Seedance
  // to invent ambient audio just gave fal something to moderate → "Output audio has sensitive content"
  // 422s that killed the whole job. Silent scenes can't be flagged for audio.
  const input = { prompt: fullPrompt, image_urls: (imageUrls || []).slice(0, 9), resolution: resolution || '720p', aspect_ratio: aspect || '9:16', generate_audio: generateAudio !== false }
  if (videoUrl) input.video_urls = [videoUrl]
  if (duration) input.duration = String(duration)
  let sub = await fetch(`https://queue.fal.run/${model}`, { method: 'POST', headers: { Authorization: `Key ${FAL_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(120_000) })
  if (!sub.ok) {
    const txt = (await sub.text()).slice(0, 400)
    // Duration out of range for this model tier → retry once at the safe default.
    if (/duration/i.test(txt) && input.duration && input.duration !== '10') {
      input.duration = '10'
      sub = await fetch(`https://queue.fal.run/${model}`, { method: 'POST', headers: { Authorization: `Key ${FAL_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(120_000) })
      if (!sub.ok) throw new Error(`fal submit ${sub.status} ${(await sub.text()).slice(0, 200)}`)
    } else if (/content_policy_violation/i.test(txt)) {
      // Tag WHICH input fal rejected so callers can react precisely: a flagged reference VIDEO can
      // retry prompt-only, but a flagged product IMAGE means the user must pick a different photo.
      const onImages = /image_urls/i.test(txt)
      const e = new Error(onImages ? 'content_policy_images' : 'content_policy_video')
      e.code = onImages ? 'content_policy_images' : 'content_policy_video'
      throw e
    } else throw new Error(`fal submit ${sub.status} ${txt}`)
  }
  const { request_id, status_url, response_url } = await sub.json()
  const statusUrl = status_url || `https://queue.fal.run/${model}/requests/${request_id}/status`
  const resultUrl = response_url || `https://queue.fal.run/${model}/requests/${request_id}`
  // Poll until COMPLETED. Seedance can queue for a long while under load, so allow 30 min (300×6s).
  // CRITICAL: if the loop exhausts WITHOUT ever seeing COMPLETED, we must NOT fetch the result — fal
  // answers a still-running request with a 400 "Request is still in progress", which used to surface
  // as an opaque "fal result 400" and kill the whole job (losing every earlier scene's fal spend).
  // Throw a clean, retryable timeout instead: the per-scene checkpoint means a re-run resumes from
  // this scene, reusing all completed scenes for free.
  let completed = false
  for (let i = 0; i < 300; i++) {
    await sleep(6000)
    const sr = await fetch(statusUrl, { headers: { Authorization: `Key ${FAL_KEY}` }, signal: AbortSignal.timeout(30_000) }).catch(() => null)
    if (!sr) continue
    if (!sr.ok) continue
    const st = await sr.json()
    if (st.status === 'COMPLETED') { completed = true; break }
    if (st.status === 'FAILED' || st.status === 'ERROR') throw new Error(`fal job ${st.status}`)
  }
  if (!completed) throw new Error('fal timed out (still IN_PROGRESS after 30m) — retry to resume')
  const rr = await fetch(resultUrl, { headers: { Authorization: `Key ${FAL_KEY}` }, signal: AbortSignal.timeout(90_000) })
  if (!rr.ok) {
    const txt = (await rr.text()).slice(0, 400)
    // fal moderates at TWO points: submit AND result. A likeness block surfacing at the RESULT fetch
    // used to throw un-coded ("fal result 422: …") so every content_policy fallback missed it and the
    // whole job died. Classify it exactly like the submit path so the ladders catch it.
    if (/content_policy_violation|likenesses of real people/i.test(txt)) {
      const onImages = /image_urls/i.test(txt)
      const e = new Error(onImages ? 'content_policy_images' : 'content_policy_video')
      e.code = onImages ? 'content_policy_images' : 'content_policy_video'
      throw e
    }
    throw new Error(`fal result ${rr.status}: ${txt.slice(0, 220)}`)
  }
  const data = await rr.json()
  const url = data?.video?.url || data?.data?.video?.url
  if (!url) throw new Error('fal returned no video url')
  return { videoUrl: url, requestId: request_id }
}

// ── Generic fal queue submit + poll (any model) ───────────────────────────────
async function falQueueRun(model, input, iters = 200) {
  const sub = await fetch(`https://queue.fal.run/${model}`, { method: 'POST', headers: { Authorization: `Key ${FAL_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(120_000) })
  if (!sub.ok) throw new Error(`fal ${model} submit ${sub.status} ${(await sub.text()).slice(0, 200)}`)
  const { request_id, status_url, response_url } = await sub.json()
  const statusUrl = status_url || `https://queue.fal.run/${model}/requests/${request_id}/status`
  const resultUrl = response_url || `https://queue.fal.run/${model}/requests/${request_id}`
  // See falGenerate's poll comment: never fetch the result unless we actually saw COMPLETED, or a
  // still-running job returns a 400 that used to masquerade as a hard failure.
  let completed = false
  for (let i = 0; i < iters; i++) {
    await sleep(6000)
    const sr = await fetch(statusUrl, { headers: { Authorization: `Key ${FAL_KEY}` }, signal: AbortSignal.timeout(30_000) }).catch(() => null)
    if (!sr) continue
    if (!sr.ok) continue
    const st = await sr.json()
    if (st.status === 'COMPLETED') { completed = true; break }
    if (st.status === 'FAILED' || st.status === 'ERROR') throw new Error(`fal ${model} ${st.status}`)
  }
  if (!completed) throw new Error(`fal ${model} timed out (still IN_PROGRESS) — retry to resume`)
  const rr = await fetch(resultUrl, { headers: { Authorization: `Key ${FAL_KEY}` }, signal: AbortSignal.timeout(90_000) })
  if (!rr.ok) {
    const txt = (await rr.text()).slice(0, 400)
    // Same result-time moderation classification as falGenerate — see comment there.
    if (/content_policy_violation|likenesses of real people/i.test(txt)) {
      const onImages = /image_urls/i.test(txt)
      const e = new Error(onImages ? 'content_policy_images' : 'content_policy_video')
      e.code = onImages ? 'content_policy_images' : 'content_policy_video'
      throw e
    }
    throw new Error(`fal ${model} result ${rr.status}: ${txt.slice(0, 200)}`)
  }
  return rr.json()
}

// ── Seedance 2.5 SURGICAL EDIT: fix ONE already-rendered ~5s segment clip IN PLACE (e.g. swap a
// mis-rendered product) instead of re-rolling the whole segment. We feed the clip + the real product
// photo + a scoped instruction; 2.5 re-renders only what's asked and leaves the rest of the clip
// (person, motion, camera, audio) untouched. We only pay for THIS segment's seconds, not the full ad.
// Gated by VIDEO_FIX_ENGINE=seedance25; the endpoint is env-configurable (SEEDANCE_EDIT_MODEL) so a
// wrong model id is a config fix, never a code deploy. Returns the fixed clip URL, or null. ──
async function seedanceEditSegment({ clipUrl, instruction, productImg, aspect }) {
  const model = process.env.SEEDANCE_EDIT_MODEL || 'fal-ai/bytedance/seedance-2.5/edit'
  const input = {
    prompt: instruction,
    video_url: clipUrl,
    ...(productImg ? { image_urls: [productImg] } : {}),
    aspect_ratio: aspect || '9:16',
    resolution: '720p',
    generate_audio: false,
  }
  const out = await falQueueRun(model, input)
  return out?.video?.url || out?.video_url || out?.url || (Array.isArray(out?.videos) ? out.videos[0]?.url : null) || null
}

// ── Pose-guided people-scene restyle (Wan VACE): copies the source's MOVEMENT SKELETON — blocking,
// gesture, camera — while generating entirely NEW people (no faces copied → no likeness issue).
// preprocess:true makes VACE derive the pose control from the raw footage itself. ──
async function restyleScene({ prompt, refVideoUrl, imageUrls, duration, aspect }) {
  const input = {
    // Product fidelity clause: VACE prioritises the pose/motion, so without this the product held by
    // the person degraded into a soft, generic bottle (it was pixel-perfect only in the product-only
    // scene). Anchor it hard to the reference product images.
    prompt: `${prompt} Entirely new people with different faces than the reference — but the exact same motion, blocking, energy and camera movement. The product held or shown must be rendered EXACTLY like the reference product image — identical shape, container, cap/applicator, colour and label text — kept sharp and in clear focus, never a generic or blurry stand-in.`,
    video_url: refVideoUrl,
    task: 'pose', preprocess: true,
    ref_image_urls: (imageUrls || []).slice(0, 3),
    resolution: '720p',   // was 580p — the low res was blurring the product in people-scenes
    aspect_ratio: aspect === '9:16' ? '9:16' : 'auto',
    num_frames: Math.min(161, Math.max(81, Math.round((duration || 5) * 16) + 1)),
    frames_per_second: 16,
    video_quality: 'high', enable_safety_checker: false,
  }
  const data = await falQueueRun(process.env.WAN_VACE_MODEL || 'fal-ai/wan-vace-14b', input)
  const url = data?.video?.url || data?.data?.video?.url
  if (!url) throw new Error('vace returned no video url')
  return url
}

// VACE clips have no audio track; a silent AAC track keeps the concat demuxer's streams aligned
// with the (audio-bearing) Seedance clips. Returns the original file when audio already exists.
function probeOut(args) { return new Promise((res) => { const p = spawn('ffprobe', args); let out = ''; p.stdout.on('data', (d) => { out += d.toString() }); p.on('close', () => res(out)); p.on('error', () => res(null)) }) }
// Duration of a media file in seconds (0 if unknown).
async function probeDuration(file) {
  const out = await probeOut(['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file])
  const d = parseFloat(String(out || '').trim())
  return Number.isFinite(d) && d > 0 ? d : 0
}
// Count the source's REAL hard cuts with ffmpeg scene-change detection → a DETERMINISTIC scene count
// (same video always yields the same number → stable price). A vision model's cut count wavered ±1
// between analyses; pixels don't. Returns 0 on failure so the caller falls back to Gemini/duration.
async function detectSceneCuts(localFile) {
  const log = await new Promise((res) => {
    // Threshold 0.6 = HARD cuts only. Calibrated on real ads: 0.3-0.4 over-counted camera moves and
    // fast action as scene changes; 0.6 lands on the true shot count and is stable up to 0.7.
    const p = spawn('ffmpeg', ['-i', localFile, '-filter:v', "select='gt(scene,0.6)',showinfo", '-an', '-f', 'null', '-'])
    let err = ''
    p.stderr.on('data', (d) => { err += d.toString() })
    p.on('close', () => res(err)); p.on('error', () => res(''))
  })
  const cuts = (log.match(/Parsed_showinfo/g) || []).length
  return cuts > 0 ? cuts + 1 : 0   // N cut-points → N+1 scenes
}

// Cap a voiceover script to fit ~`seconds` of speech (~2.8 words/sec) so a too-long script can NEVER
// freeze-extend the stitched video into a multi-minute clip. Truncates at the last sentence boundary
// that fits (supports the Devanagari danda '।' for Hindi/Urdu). This is the guard that stops a
// few-second clone from rendering a 3-minute frozen video.
function capScriptToSeconds(text, seconds, wps = 2.8) {
  const t = String(text || '').trim()
  if (!t || !seconds) return t
  const rate = Number(wps) > 0.5 && Number(wps) < 8 ? Number(wps) : 2.8   // sane speaking-rate guard
  const maxWords = Math.max(8, Math.round(seconds * rate))
  const words = t.split(/\s+/)
  if (words.length <= maxWords) return t
  let clip = words.slice(0, maxWords).join(' ')
  // Sentence terminators across scripts — Latin (. ! ?), Devanagari danda (।), Urdu/Arabic full stop
  // (۔) + question mark (؟), and ellipsis. Without the Urdu stop, an Urdu script got sliced MID-
  // sentence, and Seedance "completed" the dangling clause in the tail with hallucinated/foreign
  // audio (the language-leak at the end). Cutting on a real sentence end kills that.
  const lastStop = Math.max(
    clip.lastIndexOf('.'), clip.lastIndexOf('!'), clip.lastIndexOf('?'),
    clip.lastIndexOf('।'), clip.lastIndexOf('۔'), clip.lastIndexOf('؟'), clip.lastIndexOf('…'),
  )
  if (lastStop > clip.length * 0.4) clip = clip.slice(0, lastStop + 1)
  return clip.trim()
}
async function ensureAudio(file) {
  const out = await probeOut(['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', file])
  if (out === null || /audio/.test(out)) return file   // has audio, or no ffprobe → assume fine
  const fixed = file.replace(/\.mp4$/, '.aud.mp4')
  await ff(['-y', '-i', file, '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
    '-shortest', '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '96k', fixed])
  return fixed
}

// ── CAPTIONS (high-margin blade): Whisper word/segment timing on the finished audio → styled ASS →
// ffmpeg burns TikTok-style captions. We already own the approved script, so we feed it to Whisper as
// a prompt to lock spelling (brand/product names never garbled). Caption language is INDEPENDENT of
// the voice (Urdu VO + English captions etc.). ──
async function transcribeSegments(videoUrl, scriptHint) {
  const vr = await fetch(videoUrl)
  if (!vr.ok) throw new Error(`fetch clip ${vr.status}`)
  const buf = Buffer.from(await vr.arrayBuffer())
  const form = new FormData()
  form.append('file', new Blob([buf], { type: 'video/mp4' }), 'clip.mp4')
  form.append('model', 'whisper-1')
  form.append('response_format', 'verbose_json')
  form.append('timestamp_granularities[]', 'word')      // word-level timing → karaoke captions
  form.append('timestamp_granularities[]', 'segment')
  if (scriptHint) form.append('prompt', String(scriptHint).slice(0, 800))  // locks spelling of names
  const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST', headers: { Authorization: `Bearer ${OPENAI_KEY}` }, body: form,
  })
  if (!r.ok) throw new Error(`whisper ${r.status} ${(await r.text()).slice(0, 160)}`)
  const j = await r.json()
  return {
    language: j.language || null,
    segments: Array.isArray(j.segments) ? j.segments.map((s) => ({ start: s.start, end: s.end, text: (s.text || '').trim() })) : [],
    words: Array.isArray(j.words) ? j.words.map((w) => ({ start: w.start, end: w.end, word: (w.word || '').trim() })).filter((w) => w.word) : [],
  }
}

// Cross-language captions (Urdu VO + English captions etc.): transcreate each spoken phrase into the
// caption language, keeping the segment timing. Word-level karaoke can't cross languages (word
// alignment doesn't survive translation), so translated captions render as timed phrases instead.
async function translateSegments(segments, targetLang) {
  const langLabel = langName(targetLang).split(' — ')[0]
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-4o-mini', temperature: 0.3, response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: `Transcreate each caption line into natural ${langLabel} as a native ad caption (not literal translation; keep brand/product names as-is). Return ONLY JSON: {"lines":["…"]} with EXACTLY one line per input, same order.` },
        { role: 'user', content: JSON.stringify(segments.map((s) => s.text)) },
      ] }),
  })
  if (!r.ok) throw new Error(`translate ${r.status}`)
  const out = JSON.parse((await r.json()).choices?.[0]?.message?.content || '{}')
  const lines = Array.isArray(out.lines) ? out.lines : []
  return segments.map((s, i) => ({ ...s, text: String(lines[i] || s.text) }))
}
const assTime = (t) => {
  const cs = Math.max(0, Math.round(t * 100)); const h = Math.floor(cs / 360000), m = Math.floor((cs % 360000) / 6000), s = Math.floor((cs % 6000) / 100), c = cs % 100
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`
}
const CAPTION_STYLES = {
  // Big bold centered — the default TikTok look. Colors are &HAABBGGRR (ASS BGR + alpha).
  // Karaoke: sung word = PrimaryColour (lime #dffe95 → BGR 95FEDF), upcoming = SecondaryColour (white).
  bold:    { Fontname: 'FreeSans', Fontsize: 42, Bold: -1, PrimaryColour: '&H0095FEDF', SecondaryColour: '&H00FFFFFF', OutlineColour: '&H00000000', BackColour: '&H00000000', BorderStyle: 1, Outline: 3, Shadow: 1, Alignment: 2, MarginV: 90 },
  minimal: { Fontname: 'FreeSans', Fontsize: 34, Bold: -1, PrimaryColour: '&H00FFFFFF', SecondaryColour: '&HA0FFFFFF', OutlineColour: '&H80000000', BackColour: '&H00000000', BorderStyle: 1, Outline: 2, Shadow: 0, Alignment: 2, MarginV: 70 },
  boxed:   { Fontname: 'FreeSans', Fontsize: 38, Bold: -1, PrimaryColour: '&H0014281A', SecondaryColour: '&H0014281A', OutlineColour: '&H0095FEDF', BackColour: '&H0095FEDF', BorderStyle: 3, Outline: 6, Shadow: 0, Alignment: 2, MarginV: 90 },
}
// #RRGGBB → ASS &H00BBGGRR (opaque). Returns null on bad input.
function hexToAss(hex) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex || ''))
  if (!m) return null
  const h = m[1]
  return `&H00${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toUpperCase()
}
const SIZE_MULT = { s: 0.8, m: 1, l: 1.28 }
// opts: { size?: 's'|'m'|'l', color?: '#RRGGBB' } — color recolors the accent (highlight word for
// bold/minimal, the box for boxed); size scales the font.
function assHead(style, opts = {}) {
  const st = { ...(CAPTION_STYLES[style] || CAPTION_STYLES.bold) }
  const fontsize = Math.round(st.Fontsize * (SIZE_MULT[opts.size] || 1))
  const accent = hexToAss(opts.color)
  if (accent) {
    if (style === 'boxed') { st.OutlineColour = accent; st.BackColour = accent }
    else { st.PrimaryColour = accent }
  }
  const styleLine = `Style: Default,${st.Fontname},${fontsize},${st.PrimaryColour},${st.SecondaryColour},${st.OutlineColour},${st.BackColour},${st.Bold},0,0,0,100,100,0,0,${st.BorderStyle},${st.Outline},${st.Shadow},${st.Alignment},90,90,${st.MarginV},1`
  // WrapStyle 0 = smart wrapping (balanced lines) → long captions wrap instead of running off-screen.
  return `[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\nWrapStyle: 0\n\n[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\n${styleLine}\n\n[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n`
}
const assSafe = (t) => String(t).replace(/\n/g, ' ').replace(/\{/g, '(').replace(/\}/g, ')')
// Split a long segment into ≤7-word timed sub-lines so no single caption is a wall of text.
function chunkSegment(s) {
  const words = String(s.text).trim().split(/\s+/).filter(Boolean)
  if (words.length <= 7) return [s]
  const parts = Math.ceil(words.length / 7)
  const per = Math.ceil(words.length / parts)
  const dur = (s.end - s.start) / parts
  const out = []
  for (let i = 0; i < parts; i++) out.push({ start: s.start + i * dur, end: s.start + (i + 1) * dur, text: words.slice(i * per, (i + 1) * per).join(' ') })
  return out
}
// Phrase captions (used for translated/cross-language captions).
function buildAss(segments, style, opts = {}) {
  const events = segments.filter((s) => s.text).flatMap(chunkSegment).map((s) =>
    `Dialogue: 0,${assTime(s.start)},${assTime(s.end)},Default,,0,0,0,,${assSafe(s.text)}`).join('\n')
  return assHead(style, opts) + events + '\n'
}
// Word-by-word KARAOKE captions (same-language): words grouped into ~3-word lines; \k timing paints
// each word from SecondaryColour → PrimaryColour exactly as it's spoken. The TikTok look.
function buildKaraokeAss(words, style, opts = {}) {
  const groups = []
  for (let i = 0; i < words.length; i += 3) groups.push(words.slice(i, i + 3))
  const events = groups.map((g) => {
    const start = g[0].start
    const end = g[g.length - 1].end + 0.05
    const text = g.map((w, wi) => {
      const wEnd = wi < g.length - 1 ? g[wi + 1].start : w.end   // paint until the next word starts
      const cs = Math.max(1, Math.round((wEnd - w.start) * 100))
      return `{\\k${cs}}${assSafe(w.word)}`
    }).join(' ')
    return `Dialogue: 0,${assTime(start)},${assTime(end)},Default,,0,0,0,,${text}`
  }).join('\n')
  return assHead(style, opts) + events + '\n'
}
async function burnCaptions(videoUrl, assContent, id) {
  const base = join(tmpdir(), `cap-${id}`)
  const inFile = `${base}.in.mp4`, assFile = `${base}.ass`, outFile = `${base}.out.mp4`
  try {
    await downloadToFile(videoUrl, inFile)
    await writeFile(assFile, assContent)
    // ass filter reads the file by path; escape not needed since path is tmp-safe.
    await ff(['-y', '-i', inFile, '-vf', `ass=${assFile}`, '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', outFile])
    return await readFile(outFile)
  } finally {
    await rm(inFile, { force: true }).catch(() => {}); await rm(assFile, { force: true }).catch(() => {}); await rm(outFile, { force: true }).catch(() => {})
  }
}

async function captionJob(job) {
  const meta = job.clone_meta || {}
  const stamp = (b) => patch(`creative_generations?id=eq.${job.id}`, b)
  try {
    const src = meta.caption_source_url || job.source_video_url
    if (!src) throw new Error('no source video')
    const tr = await transcribeSegments(src, meta.script || meta.caption_script)
    if (!tr.segments.length && !tr.words.length) throw new Error('no speech detected to caption')
    // Same language → word-by-word karaoke; different language → transcreated phrase captions.
    const WHISPER_ISO = { english: 'en', urdu: 'ur', hindi: 'hi', arabic: 'ar', spanish: 'es', french: 'fr', german: 'de' }
    // Prefer the KNOWN voiceover language (from the source clone) — Whisper mis-detects generated
    // speech and wrongly triggered the translate path (en→en). Fall back to Whisper only if unknown.
    const spoken = meta.source_lang
      ? String(meta.source_lang).slice(0, 2)
      : (WHISPER_ISO[String(tr.language || '').toLowerCase()] || String(tr.language || 'en').slice(0, 2))
    const want = String(meta.caption_lang || 'en').slice(0, 2)
    const style = meta.caption_style || 'bold'
    const opts = { size: meta.caption_size || 'm', color: meta.caption_color || null }
    let ass
    if (want !== spoken && tr.segments.length) {
      const translated = await translateSegments(tr.segments, want)
      ass = buildAss(translated, style, opts)
    } else if (tr.words.length) {
      ass = buildKaraokeAss(tr.words, style, opts)
    } else {
      ass = buildAss(tr.segments, style, opts)
    }
    const segs = tr.segments.length ? tr.segments : tr.words
    const mp4 = await burnCaptions(src, ass, job.id)
    const key = `creatives/${job.user_id}/${job.id}.mp4`
    await r2.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key, Body: mp4, ContentType: 'video/mp4', CacheControl: 'public, max-age=31536000, immutable' }))
    const url = `${R2_PUBLIC}/${key}`
    await stamp({ status: 'done', media_type: 'video', image_url: url, clone_meta: { ...meta, caption_segments: segs.length } })
    if (job.credit_tx) await rpc('commit_credits', { p_tx: job.credit_tx, p_metadata: { captions: true, actual_cost_usd: 0.01 } })
    console.log(`💬 captioned ${job.id} → ${url}`)
  } catch (e) {
    console.warn(`caption ${job.id} failed:`, e.message)
    await stamp({ status: 'failed', clone_meta: { ...meta, error: e.message } })
    await logErr(job.user_id, `Video captions render failed — ${e.message}`, { kind: 'render_failed', stage: 'captions', job: job.id })
    if (job.credit_tx) await rpc('refund_credits', { p_tx: job.credit_tx })
  }
}

// ── Add-on helpers: extra-language outputs, branded end-card, hook variants ──────────────────────
async function insertRow(body) {
  const r = await fetch(`${U}/rest/v1/creative_generations`, { method: 'POST', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify(body) })
  if (!r.ok) throw new Error(`insert ${r.status} ${(await r.text()).slice(0, 120)}`)
  const j = await r.json()
  return j[0]
}

// Transcreate the approved voiceover into another language (native ad-speak, not translation).
async function transcreateScript(text, lang) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: OPENAI_MODEL, temperature: 0.6, response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: `TRANSCREATE this ad voiceover into ${langName(lang)}. Same message, same energy, natural native delivery — never literal translation. Write in the language's OWN NATIVE SCRIPT (Urdu → اردو, Hindi → हिंदी, Arabic → العربية) — do NOT romanize into Latin letters (the voice model would read Latin text as English). Keep in Latin ONLY real brand/product names. Return ONLY JSON: {"script":""}.` },
        { role: 'user', content: String(text) },
      ] }),
  })
  if (!r.ok) throw new Error(`transcreate ${r.status}`)
  const out = JSON.parse((await r.json()).choices?.[0]?.message?.content || '{}')
  if (!out.script) throw new Error('no transcreated script')
  return String(out.script)
}

// Two ALTERNATIVE hook treatments for the opening scene, as the two named archetypes distinct from
// the (kept) original: a question hook and a visual-shock/pattern-interrupt. Returns labelled objects
// so each stitched version is clearly identifiable for A/B testing.
async function hookVariantPrompts(scenePrompt) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: OPENAI_MODEL, temperature: 0.8, response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Given this Seedance prompt for an ad\'s OPENING scene, write 2 ALTERNATIVE hook treatments so the advertiser can A/B test openings: (1) "Question hook" — opens on a curiosity/question pattern; (2) "Visual shock" — a pattern-interrupt / surprising visual. Same product, same setting language, same approximate duration and style — only the hook concept changes. Return ONLY JSON: {"variants":[{"label":"Question hook","prompt":""},{"label":"Visual shock","prompt":""}]}' },
        { role: 'user', content: String(scenePrompt) },
      ] }),
  })
  if (!r.ok) throw new Error(`hooks ${r.status}`)
  const out = JSON.parse((await r.json()).choices?.[0]?.message?.content || '{}')
  const v = (Array.isArray(out.variants) ? out.variants : []).filter((x) => x && x.prompt).slice(0, 2)
  if (v.length < 2) throw new Error('no hook variants')
  return v.map((x, i) => ({ label: String(x.label || (i === 0 ? 'Question hook' : 'Visual shock')), prompt: String(x.prompt) }))
}

// Video dimensions (end-card must match the main render or concat breaks).
async function videoDims(file) {
  const out = await probeOut(['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=s=x:p=0', file])
  const m = /(\d+)x(\d+)/.exec(out || '')
  return m ? { w: +m[1], h: +m[2] } : { w: 720, h: 1280 }
}

// Branded end-card: brand-dark background + product image + name / offer / lime CTA pill, composed
// entirely in ffmpeg (zero model cost), sized to the main video, with silent audio for clean concat.
const EC_FONT = '/usr/share/fonts/truetype/freefont/FreeSansBold.ttf'
const ecText = (t, max) => String(t || '').replace(/[\\:'"%{}\n]/g, '').slice(0, max)

// Parse a callout time range like "0-4s" / "2s" into seconds.
function parseOverlayRange(t, dur) {
  const m = String(t || '').match(/(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)/)
  if (m) return { start: +m[1], end: Math.max(+m[1] + 1, +m[2]) }
  const s = String(t || '').match(/(\d+(?:\.\d+)?)/)
  return s ? { start: +s[1], end: +s[1] + 3 } : { start: 0, end: dur }
}
// Burn the (adapted + user-edited) on-screen text callouts onto the FINISHED video — a post-step that
// never touches the render. Bold white text with a dark outline near the top, at each callout's time
// range. Best-effort: on any ffmpeg error the un-overlaid video ships (overlays are additive, not
// load-bearing). Two callouts sharing a time window stack vertically so they don't overlap.
async function burnOverlays(videoIn, overlays, id) {
  const list = (Array.isArray(overlays) ? overlays : []).filter((o) => o && String(o.text || '').trim()).slice(0, 8)
  if (!list.length) return videoIn
  const dur = await probeDuration(videoIn) || 60
  const probe = await probeOut(['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=s=x:p=0', videoIn])
  const [W, H] = String(probe || '').trim().split('x').map((n) => parseInt(n) || 0)
  const vw = W > 0 ? W : 720, vh = H > 0 ? H : 1280
  const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, '’').replace(/%/g, '\\%').replace(/,/g, '\\,')
  let lastEnd = -99, row = 0
  const filters = list.map((o) => {
    const { start, end } = parseOverlayRange(o.t, dur)
    if (start < lastEnd) row += 1; else row = 0   // overlapping windows stack; cap at 2 lines
    lastEnd = Math.max(lastEnd, end)
    if (row > 1) return null
    const txt = o.text.slice(0, 40)
    // Auto-fit: shrink the font so the text never exceeds ~86% of the frame width (FreeSansBold ≈
    // 0.52em/char), capped at a sensible max. Fixes the earlier edge cut-off on long callouts.
    const fit = Math.floor((0.86 * vw) / Math.max(6, txt.length * 0.52))
    const fs = Math.max(28, Math.min(Math.round(vh / 15), fit))
    const y = row === 0 ? Math.round(vh * 0.09) : Math.round(vh * 0.09 + fs * 1.5)
    const bw = Math.max(3, Math.round(fs * 0.08))
    return `drawtext=fontfile=${EC_FONT}:text='${esc(txt)}':fontsize=${fs}:fontcolor=white:borderw=${bw}:bordercolor=black@0.9:shadowx=2:shadowy=2:shadowcolor=black@0.6:x=(w-text_w)/2:y=${y}:enable='between(t\\,${start.toFixed(2)}\\,${Math.min(dur, end).toFixed(2)})'`
  }).filter(Boolean).join(',')
  const out = join(tmpdir(), `ov-${id}.mp4`)
  try {
    await ff(['-y', '-i', videoIn, '-vf', filters, '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', out])
    console.log(`🔤 ${id} burned ${list.length} on-screen callout(s)`)
    return out
  } catch (e) { console.warn(`overlays burn failed for ${id}:`, e.message); return videoIn }
}
// App-demo composite (service/app clones only): drop the user's REAL screenshots into the beats where
// the source showed its app/UI — a top band ("split_top", the creator stays visible below) or a
// full-frame cut ("full"). Screenshots come from the user's step-2 selection / brand screenshots —
// never an invented UI. Fully additive & fail-safe: any ffmpeg error ships the un-composited video,
// exactly like burnOverlays. Never runs for physical brands.
async function burnAppDemo(videoIn, ranges, imageUrls, id, screencastUrl) {
  const imgs = (Array.isArray(imageUrls) ? imageUrls : []).filter((u) => typeof u === 'string' && (u.startsWith('http') || u.startsWith('data:')))
  let list = (Array.isArray(ranges) ? ranges : []).filter((r) => r && r.t).slice(0, 5)
  const hasCast = typeof screencastUrl === 'string' && /^https?:\/\//i.test(screencastUrl)
  // FALLBACK (the "my screenshot didn't show" bug): cached/older beat sheets have no app_demo field, so
  // a service render with uploaded screenshots silently skipped the composite. If the user gave us
  // screenshots, ALWAYS show them — default to the split layout when analysis didn't provide beats.
  if (!list.length && imgs.length && !hasCast) list = [{ t: 'full', region: 'split_top' }]
  if (!list.length && !hasCast) return videoIn
  if (!imgs.length && !hasCast) return videoIn
  const dur = await probeDuration(videoIn) || 30
  const probe = await probeOut(['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=s=x:p=0', videoIn])
  const [W0, H0] = String(probe || '').trim().split('x').map((n) => parseInt(n) || 0)
  const W = W0 > 0 ? W0 : 720, H = H0 > 0 ? H0 : 1280
  const dl = async (src, f) => { if (src.startsWith('data:')) await writeFile(f, Buffer.from(src.split(',')[1] || '', 'base64')); else await downloadToFile(src, f) }
  // A screencast forces the split (that's its whole purpose); otherwise any split_top beat → split-format ad.
  const wantsSplit = hasCast || list.some((r) => String(r.region || '').toLowerCase() !== 'full')

  // ── TRUE 50/50 split (Atria layout): creator shrunk to the BOTTOM half; the TOP half is the user's
  // uploaded screen RECORDING (moving UI) if provided, else their app screenshots (rotating). ──
  if (wantsSplit) {
    const topH = Math.round(H / 2) - (Math.round(H / 2) % 2)   // even heights (yuv420p)
    const botH = H - topH
    // Motion-UI path: real screen recording looped to cover the clip in the top half.
    if (hasCast) {
      const castFile = join(tmpdir(), `cast-${id}.mp4`)
      try {
        await downloadToFile(screencastUrl, castFile)
        const out = join(tmpdir(), `split-${id}.mp4`)
        const F = [
          `[0:v]scale=${W}:${botH}:force_original_aspect_ratio=increase,crop=${W}:${botH},setsar=1[btm]`,
          `[1:v]scale=${W}:${topH}:force_original_aspect_ratio=increase,crop=${W}:${topH},setsar=1,fps=30[top]`,
          `[top][btm]vstack=inputs=2[v]`,
        ]
        await ff(['-y', '-i', videoIn, '-stream_loop', '-1', '-i', castFile, '-filter_complex', F.join(';'), '-map', '[v]', '-map', '0:a?', '-t', String(dur), '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', out])
        console.log(`📱 ${id} built split-screen with MOVING screen recording (app top / creator bottom)`)
        return out
      } catch (e) { console.warn(`split-screen (screencast) failed for ${id}:`, e.message); /* fall through to stills */ }
    }
    const shots = imgs.slice(0, 4)
    const files = []
    for (let i = 0; i < shots.length; i++) { const f = join(tmpdir(), `split-${id}-${i}.png`); try { await dl(shots[i], f); files.push(f) } catch { /* skip */ } }
    if (files.length) {
      const inputs = ['-i', videoIn, ...files.flatMap((f) => ['-i', f])]
      const F = [
        `[0:v]scale=${W}:${botH}:force_original_aspect_ratio=increase,crop=${W}:${botH},setsar=1[btm]`,
        `[1:v]scale=${W}:${topH}:force_original_aspect_ratio=increase,crop=${W}:${topH},setsar=1[top0]`,
        `[top0][btm]vstack=inputs=2[v0]`,
      ]
      let last = '[v0]'
      const extra = files.slice(1)
      const slice = dur / (extra.length + 1)
      extra.forEach((_, k) => {
        const a = (slice * (k + 1)).toFixed(2), b = (k + 1 === extra.length ? dur : slice * (k + 2)).toFixed(2)
        F.push(`[${2 + k}:v]scale=${W}:${topH}:force_original_aspect_ratio=increase,crop=${W}:${topH},setsar=1[e${k}]`)
        F.push(`${last}[e${k}]overlay=0:0:enable='between(t\\,${a}\\,${b})'[v${k + 1}]`)
        last = `[v${k + 1}]`
      })
      const out = join(tmpdir(), `split-${id}.mp4`)
      try {
        await ff(['-y', ...inputs, '-filter_complex', F.join(';'), '-map', last, '-map', '0:a?', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', out])
        console.log(`📱 ${id} built split-screen (app top / creator bottom, ${files.length} screen(s))`)
        return out
      } catch (e) { console.warn(`split-screen failed for ${id}:`, e.message); return videoIn }
    }
    return videoIn
  }

  // ── Full-frame cutaways: cut to the app screenshot full-screen for the tagged beats, back to the
  // creator otherwise (voiceover keeps playing over it). ──
  const inputs = ['-i', videoIn]; const scaleFilters = []; const overlayChain = []; let ok = 0
  for (let i = 0; i < list.length; i++) {
    const { start, end } = parseOverlayRange(list[i].t, dur)
    if (!(end > start)) continue
    const f = join(tmpdir(), `appdemo-${id}-${i}.png`)
    try { await dl(imgs[i % imgs.length], f) } catch { continue }
    inputs.push('-i', f)
    scaleFilters.push(`[${1 + ok}:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1[a${ok}]`)
    const prev = ok === 0 ? '[0:v]' : `[v${ok - 1}]`
    overlayChain.push(`${prev}[a${ok}]overlay=0:0:enable='between(t\\,${start.toFixed(2)}\\,${Math.min(dur, end).toFixed(2)})'[v${ok}]`)
    ok++
  }
  if (!ok) return videoIn
  const out = join(tmpdir(), `appdemo-${id}.mp4`)
  try {
    await ff(['-y', ...inputs, '-filter_complex', [...scaleFilters, ...overlayChain].join(';'), '-map', `[v${ok - 1}]`, '-map', '0:a?', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', out])
    console.log(`📱 ${id} composited ${ok} full-frame app cutaway(s)`)
    return out
  } catch (e) { console.warn(`app-demo composite failed for ${id}:`, e.message); return videoIn }
}
async function makeEndCard(meta, dims, out, tmp) {
  const ec = meta.end_card || {}
  const name = ecText((meta.product_details && meta.product_details.name) || 'Your brand', 34)
  const offer = ecText(ec.offer, 44)
  const cta = ecText(ec.cta || 'Shop now', 26)
  const { w, h } = dims
  let imgFile = null
  const imgUrl = (meta.product_image_urls || [])[0] || null
  if (imgUrl) {
    try {
      imgFile = `${out}.prod.png`
      if (imgUrl.startsWith('data:')) await writeFile(imgFile, Buffer.from(imgUrl.split(',')[1] || '', 'base64'))
      else await downloadToFile(imgUrl, imgFile)
      tmp.push(imgFile)
    } catch { imgFile = null }
  }
  const fs1 = Math.round(h * 0.042), fs2 = Math.round(h * 0.032), fs3 = Math.round(h * 0.030)
  const dt = (text, size, color, y, box) => `drawtext=fontfile=${EC_FONT}:text='${text}':fontsize=${size}:fontcolor=${color}:x=(w-text_w)/2:y=${y}${box ? `:box=1:boxcolor=0xdffe95:boxborderw=${Math.round(h * 0.016)}` : ''}`
  const texts = [
    dt(name, fs1, 'white', Math.round(h * 0.62)),
    offer ? dt(offer, fs2, '0x95fedf', Math.round(h * 0.695)) : null,
    dt(cta, fs3, '0x1a2814', Math.round(h * 0.78), true),
  ].filter(Boolean).join(',')
  const args = ['-y', '-f', 'lavfi', '-i', `color=c=0x0d130e:s=${w}x${h}:d=2.6:r=30`, '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100']
  if (imgFile) args.push('-i', imgFile, '-filter_complex', `[2:v]scale=${Math.round(w * 0.72)}:-1[p];[0:v][p]overlay=(W-w)/2:${Math.round(h * 0.16)}[v0];[v0]${texts}[v]`, '-map', '[v]')
  else args.push('-filter_complex', `[0:v]${texts}[v]`, '-map', '[v]')
  args.push('-map', '1:a', '-t', '2.6', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', out)
  await ff(args)
}
// Append the end-card to a finished local video. Returns the new path (or the input on any failure —
// the caller then refunds just the end-card tx and ships the video without it).
async function withEndCard(localIn, meta, id, tag, tmp) {
  if (!meta.end_card) return { file: localIn, applied: false }
  try {
    const dims = await videoDims(localIn)
    const card = `${localIn}.${tag}.card.mp4`
    tmp.push(card)
    await makeEndCard(meta, dims, card, tmp)
    const outFile = `${localIn}.${tag}.final.mp4`
    tmp.push(outFile)
    await concatClips([localIn, card], outFile)
    return { file: outFile, applied: true }
  } catch (e) {
    console.warn('end-card failed:', e.message)
    return { file: localIn, applied: false }
  }
}
async function uploadVideo(localFile, key) {
  const buf = await readFile(localFile)
  await r2.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key, Body: buf, ContentType: 'video/mp4', CacheControl: 'public, max-age=31536000, immutable' }))
  return `${R2_PUBLIC}/${key}`
}

// Adapt the source ad's on-screen text callouts to the user's product — swap the original's brand /
// numbers for the user's, keep each callout's role + timing. Best-effort; returns [] on any failure.
async function adaptOverlays(overlays, product, brandName) {
  // Dedup — Gemini repeats the same callout at every timestamp it's visible. Keep the FIRST time each
  // unique text appears (its real timing), in order.
  const seen = new Set()
  const uniq = (Array.isArray(overlays) ? overlays : [])
    .filter((o) => o && String(o.text || '').trim())
    .map((o) => ({ t: String(o.t || ''), text: String(o.text).trim() }))
    .filter((o) => { const k = o.text.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true })
  if (!uniq.length) return []
  if (!OPENAI_KEY) return uniq.slice(0, 6)
  // FAITHFUL adaptation: preserve the source's callouts + TIMING; only swap the brand; keep the hero
  // stats/prices/CTAs verbatim (the user edits those). Drop packaging-label noise. Never invent claims.
  const sys = `You lightly adapt an ad's on-screen text CALLOUTS for a clone of a DIFFERENT product. STRICT RULES:
1. KEEP each callout's EXACT timing "t" — never merge, re-time, or collapse to 0-1s.
2. Only SWAP the source's brand/company name (e.g. "Country Delight", "HRX") for the user's brand. Leave STATS, PRICES, CTAs and TAGLINES EXACTLY as written (e.g. keep "25g PROTEIN", "₹47.00/450ml", "PROTEIN FOR ALL", "Download Now") — the user edits those himself.
3. KEEP the punchy hero callouts (a big stat, a price, a CTA, a tagline); DROP pure packaging-label repeats (e.g. "Pasteurized Toned Milk", "450 ml", "Made from Buffalo Milk", tiny legal text).
4. Return AT MOST 6, most important first, preserving each one's original timing. NEVER invent claims.
Return ONLY minified JSON: {"overlays":[{"t":"","text":""}]}.`
  const usr = `USER BRAND: ${brandName || (product && product.name) || 'the brand'}\nUSER PRODUCT: ${JSON.stringify(product)}\n\nAD CALLOUTS (deduped, with real timing — keep timing, swap brand, keep stats/CTAs):\n${JSON.stringify(uniq)}`
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: OPENAI_MODEL, temperature: 0.2, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: sys }, { role: 'user', content: usr }] }),
    })
    if (!r.ok) throw new Error(`overlays ${r.status}`)
    const out = JSON.parse((await r.json()).choices?.[0]?.message?.content || '{}')
    const adapted = Array.isArray(out.overlays) ? out.overlays.filter((o) => o && String(o.text || '').trim()).slice(0, 6).map((o) => ({ t: String(o.t || ''), text: String(o.text).trim().slice(0, 60) })) : []
    return adapted.length ? adapted : uniq.slice(0, 6)
  } catch { return uniq.slice(0, 6) }
}

// ── PHASE A: analyse the competitor video + draft a script → status='review' (awaits approval) ──
async function analyzeJob(job) {
  const meta = job.clone_meta || {}
  const isService = meta.product_type === 'service'   // service/app brand → no physical product path
  const stamp = (b) => patch(`creative_generations?id=eq.${job.id}`, b)
  try {
    let beat = null
    // DETERMINISTIC ANALYSIS: the same source ad must quote the same scene count / suggested style
    // every time. Gemini's talking-head-vs-cinematic judgement flapped between runs on the SAME ad
    // (3 scenes one open, 10 the next → the Cinematic price jumped 1800→6000cr). Reuse the most
    // recent analysis of this exact source video — ad-intrinsic fields only (beat sheet, scene count,
    // suggested mode, speaking rate); brand-specific outputs (script, overlays) are rebuilt fresh.
    let cachedA = null
    if (job.source_video_url) {
      try {
        const q = await fetch(`${U}/rest/v1/creative_generations?select=clone_meta&source_video_url=eq.${encodeURIComponent(job.source_video_url)}&id=neq.${job.id}&type=eq.video_clone&order=created_at.desc&limit=20`, { headers: H })
        const rows = q.ok ? await q.json() : []
        // Reuse a prior analysis that carries real STRUCTURE — beats with source frames (thumbs),
        // timestamps or actions, OR a transcript/avatar. This is what grounds the storyboard in the
        // actual reference video (real frames per scene). The transcript + script are ALWAYS rebuilt
        // fresh below (Whisper backfill + dedicated transcreation run regardless of cache), so reusing a
        // frame-rich-but-transcript-less analysis no longer means a generic script — it just brings the
        // reference's real shots back. (Rejecting these was the regression that made the storyboard stop
        // matching the reference video.) Only a truly EMPTY analysis is skipped so we analyse fresh.
        const substantive = (m) => {
          const bs = m?.beat_sheet
          if (!bs || !(Number(m?.scene_count) > 0)) return false
          const beats = Array.isArray(bs.beats) ? bs.beats : []
          const hasFrames = beats.some((b) => b?.thumb)                                   // real source frames grabbed
          const hasTimed = beats.filter((b) => String(b?.t || '').trim()).length >= 2     // real per-beat timestamps
          const words = String(bs.transcript || '').trim().split(/\s+/).filter(Boolean).length
          const acts = beats.filter((b) => String(b?.action || '').trim().length > 3).length
          const av = String(bs.avatar || '').trim().toLowerCase()
          return hasFrames || hasTimed || acts >= 2 || words >= 4 || (!!av && av !== 'none' && !av.startsWith('none'))
        }
        const hit = rows.find((r) => substantive(r?.clone_meta))
        if (hit) { cachedA = hit.clone_meta; console.log(`♻️ ${job.id} reusing analysis (scenes=${cachedA.scene_count}, suggest=${cachedA.suggested_mode})`) }
      } catch (e) { console.warn('analysis-cache lookup:', e.message) }
    }
    if (cachedA) beat = cachedA.beat_sheet
    else if (job.source_video_url) { try { beat = await analyzeVideo(job.source_video_url) } catch (e) { console.warn('analyze:', e.message) } }
    // NEVER leave beat null. When Gemini analysis fails/returns nothing (quota, oversized source, a
    // transient error), a null beat made storyboardFrames early-return → the storyboard had ZERO real
    // frames from the reference and every keyframe was invented generically. A minimal beat sheet still
    // lets us grab real source frames (thumbs) evenly across the clip, so the storyboard stays grounded
    // in the actual reference video even with no AI beat analysis. The script is unaffected (it comes
    // from the Whisper transcript + transcreation, not the beat sheet).
    if (!beat || typeof beat !== 'object') { beat = { beats: [] }; console.warn(`⚠️ ${job.id} no AI beat sheet — grounding storyboard on source frames only`) }
    if (!Array.isArray(beat.beats)) beat.beats = []
    const productImages = Array.isArray(meta.product_image_urls) ? meta.product_image_urls : []
    // LOOK at the product photo once (vision) so scripts describe what it actually is — capsules vs
    // gummies etc. Persisted into product_details so every later prompt builder gets it too.
    let productDetails = meta.product_details || { name: 'the product' }
    // Service brands have no physical product → skip the vision "what is it" + size-anchor steps.
    if (!isService && !productDetails.observed && productImages[0]) {
      try { const obs = await describeProduct(productImages[0]); if (obs) productDetails = { ...productDetails, observed: obs } }
      catch (e) { console.warn('describeProduct:', e.message) }
    }
    // Vision-measured SIZE ANCHOR (all selected photos — box + product both calibrate it). Grounds the
    // prompts' true-scale sentence in the real photos instead of a text guess. Cached on the job.
    if (!isService && !productDetails.size_anchor && productImages.length) {
      try {
        const sp = await productSizeProfile(productImages)
        if (sp) { productDetails = { ...productDetails, size_anchor: sp.anchor, hand_relation: sp.hand_relation, approx_cm: sp.approx_cm }; console.log(`📏 ${job.id} size anchor: ${sp.anchor}`) }
      } catch (e) { console.warn('sizeProfile:', e.message) }
    }
    // WHISPER — accurate source transcript + the ad's REAL speaking rate (words/sec), so the script is
    // calibrated to the actual talker's pace instead of a fixed guess. Cheap (~0.15¢ for a 15s clip).
    // Only apply the source rate when the CLONE language matches the source language — word density
    // doesn't transfer across languages, so a translation keeps the safe default rate.
    let srcRate = cachedA ? (Number(cachedA.source_wps) || null) : null
    // Capture the source's REAL spoken words into a reliable local — the single source of truth for the
    // script. (Relying on beat.transcript surviving into the dense Seedance-prompt builder was flaky;
    // the words were transcribed but the clone still came out as a generic product pitch.)
    let srcTranscript = String((beat && beat.transcript) || '').trim()
    // NEVER trust a CACHED transcript as the script seed. The analysis cache matches on source_video_url,
    // and a stale/cross-contaminated cache row (a prior clone of a DIFFERENT product that shared the URL)
    // would seed the script from the wrong ad — the "Füm clone came out as Real Crunch Bars" bug. When we
    // reused a cached analysis, always re-transcribe THIS source so the words are the ad we're cloning.
    if (cachedA) srcTranscript = ''
    if (srcTranscript.split(/\s+/).filter(Boolean).length < 4 && OPENAI_KEY && job.source_video_url) {
      try {
        const tr = await transcribeSegments(job.source_video_url)
        const w = tr.words || []
        if (w.length >= 4) {
          const speech = Math.max(1, (w[w.length - 1].end || 0) - (w[0].start || 0))
          const rate = w.length / speech
          const cloneLang = (meta.language || 'en').slice(0, 2)
          const srcLang = (tr.language || 'en').slice(0, 2)
          if (cloneLang === srcLang) srcRate = rate
          srcTranscript = w.map((x) => x.word).join(' ').replace(/\s+/g, ' ').trim()
          if (beat && srcTranscript) beat.transcript = srcTranscript
          console.log(`🎙 ${job.id} whisper: ${w.length} words / ${speech.toFixed(1)}s = ${rate.toFixed(1)} wps (src=${srcLang}, clone=${cloneLang})`)
        }
      } catch (e) { console.warn(`whisper source ${job.id}:`, e.message) }
    }
    meta.product_details = productDetails
    meta.source_wps = srcRate || null
    // ── TRANSCREATE THE SCRIPT (dedicated step) ── The clone must SAY what the original said, adapted to
    // the user's product — not a generic "check out this amazing device" pitch. We do this in its OWN
    // focused call from the real transcript, then hand the result to the prompt builder as the exact
    // spoken words. This is decoupled from the Seedance system prompt (which kept ignoring the buried
    // "transcreate" bullet). Applies to BOTH modes — it's script only, never touches gender/UGC.
    const twords = srcTranscript.split(/\s+/).filter(Boolean).length
    console.log(`📄 ${job.id} source transcript: ${twords} words → ${twords >= 8 ? 'transcreating' : 'no transcript, will write fresh'}`)
    let forced = null
    if (!isService && twords >= 8) {
      try { forced = await transcreateAdScript(srcTranscript, productDetails, meta.language) } catch (e) { console.warn(`transcreate ${job.id}:`, e.message) }
      if (forced) console.log(`✍️ ${job.id} transcreated script from source (${forced.split(/\s+/).length} words)`)
    }
    // (Gender/avatar backfill lives in the FAITHFUL generate branch only — UGC preserves the source
    // creator's gender correctly on its own via frame-chaining, so it's deliberately left untouched.)
    let { prompt, script, gloss } = await buildSeedancePrompt(beat, productDetails, productImages.length, forced, meta.character_look, meta.language, isService)
    if (forced) script = forced   // the transcreated script is the source of truth for the review screen
    // Cap the drafted narration to the SOURCE's own talk-time so the clone matches the original length,
    // using the ad's REAL words/sec when we have it (same language) — a fast talker's clone gets more
    // words, a slow one fewer. The user still sees + can edit this before approving.
    const srcSecs = Number(beat && beat.duration_seconds) || 15
    script = capScriptToSeconds(script, Math.max(8, srcSecs), srcRate || 2.8)
    // Suggest faithful (scene-by-scene) cloning when the source is a multi-scene / B-roll ad —
    // collapsing those into a talking head isn't a clone. The user picks the mode at approve time.
    const cinematic = cachedA ? cachedA.suggested_mode === 'faithful' : detectCinematic(beat)
    // Scene count — prefer a DETERMINISTIC ffmpeg cut count (stable price across re-analyses); fall
    // back to Gemini's scene_count / duration when the source can't be probed.
    let scenes = cachedA ? Number(cachedA.scene_count) : sceneCountFor(beat)
    if (!cachedA && job.source_video_url) {
      try {
        const tmpSrc = join(tmpdir(), `cut-${job.id}.mp4`)
        await downloadToFile(job.source_video_url, tmpSrc)
        const cuts = await detectSceneCuts(tmpSrc)
        const realSecs = await probeDuration(tmpSrc)   // deterministic source length (not Gemini's guess)
        await rm(tmpSrc, { force: true }).catch(() => {})
        if (cuts >= 1) {
          // CINEMATIC (multi-shot) sources: take the MAX of ffmpeg's hard-cut count and Gemini's
          // semantic scene_count. ffmpeg's 0.6 threshold misses dissolves and cuts between similar
          // frames (the FÜM colour→B&W of the SAME man), so alone it UNDERCOUNTS and the planner drops
          // a real scene. Max = never fewer scenes than the source actually shows.
          // TALKING-HEAD (UGC) sources: it's really ONE continuous shot, but Gemini reports a "beat"
          // per gesture/sentence (9+). Taking the max there OVERcounts (a talking head became 9 scenes).
          // So only trust ffmpeg's real hard cuts for talking heads — no Gemini inflation.
          const geminiScenes = Math.round(Number(beat && beat.scene_count) || 0)
          const talkingHead = beat && beat.is_talking_head === true || !cinematic
          const target = talkingHead ? cuts : Math.max(cuts, geminiScenes)
          scenes = clampScenes(target, realSecs || Number(beat && beat.duration_seconds) || 15)
          console.log(`✂️ ${job.id} ffmpeg ${cuts} + gemini ${geminiScenes} (${talkingHead ? 'talking-head→ffmpeg' : 'cinematic→max'}) → ${scenes} scenes · ${(realSecs || 0).toFixed(1)}s`)
        }
      } catch (e) { console.warn(`cut-detect ${job.id}:`, e.message) }
    }
    // FAITHFUL/Cinematic only: the video length matches the source (~srcSecs across `scenes` shots), but
    // the drafted script was paced to the source creator's SLOW speaking rate → too short to cover it
    // (e.g. 31s of words under 50s of scenes). Pace it to the video length NOW so the REVIEW screen shows
    // the real full-length script the user reads/edits/approves — WYSIWYG, no surprise expansion at render
    // (the generate-time fill sees it already fits and leaves it alone). UGC keeps its short script.
    if (cinematic) {
      // Pace the DRAFT to the review screen's DEFAULT length pick (15s), capped by the source — NOT to
      // the full source length (a 71s source paced 71s of words under a 15s default = fragments
      // everywhere). Picking a longer length re-paces client-side; approve stores the real target.
      const draftTarget = Math.max(8, Math.min(15, Math.round(srcSecs) || 15))
      const paced = await fillScriptToLength(script, draftTarget, meta.language, meta.product_details?.name)
      if (paced && paced.trim()) script = paced
    }
    // Auto-detect + adapt the ad's on-screen text callouts (25g PROTEIN, price, CTA…) for the user's
    // product — shown editable in the review UI, burned on after the render (best-effort, never blocks).
    const overlays = await adaptOverlays(beat && beat.on_screen_text, productDetails, meta.brand_name).catch(() => [])
    // Grab a reference frame per beat from the source video so the storyboard shows a real film strip
    // (mutates beat.beats[i].thumb in place). Best-effort — never blocks the draft.
    try { await storyboardFrames(job.source_video_url, beat, scenes, job.id) } catch (e) { console.warn(`storyboard frames ${job.id}:`, e.message) }
    await stamp({ status: 'review', clone_meta: { ...meta, beat_sheet: beat, seedance_prompt: prompt, script, script_gloss: gloss, suggested_mode: cinematic ? 'faithful' : 'ugc', scene_count: scenes, overlays } })
    console.log(`📝 drafted ${job.id} → awaiting approval (suggest=${cinematic ? 'faithful' : 'ugc'}, scenes=${scenes})`)
  } catch (e) {
    console.warn(`analyze ${job.id} failed:`, e.message)
    await stamp({ status: 'failed', clone_meta: { ...meta, error: e.message } })
    await logErr(job.user_id, `Video analyze/draft failed — ${e.message}`, { kind: 'render_failed', stage: 'analyze', job: job.id })
  }
}

// ── PHASE B: user approved → generate the video with the APPROVED script → status='done' ──
async function generateJob(job) {
  const meta = job.clone_meta || {}
  const isService = meta.product_type === 'service'   // service/app brand → no physical product path
  const productImages = Array.isArray(meta.product_image_urls) ? meta.product_image_urls : []
  const stamp = (b) => patch(`creative_generations?id=eq.${job.id}`, b)
  // Live progress the modal polls: {label, pct, eta_sec}. fal gives no % for video gen, so WE report
  // the real pipeline step + a running ETA (best-effort; never fails the render).
  const prog = (label, pct, etaSec) => stamp({ clone_meta: { ...meta, progress: { label, pct: Math.round(pct), eta_sec: Math.round(etaSec || 0), at: Date.now() } } }).catch(() => {})   // `at` = heartbeat, lets a watchdog spot stalls
  try {
    const finalScript = meta.final_script || meta.script || ''

    // BEAT-SHEET BACKFILL — if analysis failed at draft time (e.g. a Gemini 429 burst), the job
    // reached approval with beat_sheet null and every prompt lost the creator/setting ("avatar: as
    // analysed" = nothing) → Seedance invents a random person. One more attempt here (analyzeVideo
    // now retries internally) restores clone fidelity; still degrades gracefully if it fails again.
    if (!meta.beat_sheet && job.source_video_url) {
      try {
        const late = await analyzeVideo(job.source_video_url)
        if (late) { meta.beat_sheet = late; await stamp({ clone_meta: { ...meta } }) ; console.log(`🩹 ${job.id} beat sheet backfilled at generate time`) }
      } catch (e) { console.warn('late analyze:', e?.message) }
    }

    // Person-free product reference for fal — used by EVERY mode. Uploaded product photos often show a
    // hand holding the item, which fal's likeness filter rejects on image_urls (→ whole render 422s).
    // Nano Banana re-shoots the product alone on a clean background once (~1-2¢, cached on the row).
    let cleanProduct = meta.clean_product || null
    // Service brands have no product to "re-shoot" cleanly — skip (a logo/screenshot must not be
    // turned into a fake product still).
    if (!isService && !cleanProduct && productImages.length) {
      try {
        await prog('Preparing your product…', 5, 0)
        cleanProduct = await composeCleanProduct({ productImageUrls: productImages, jobId: job.id })
        if (cleanProduct) { console.log(`🧴 ${job.id} clean product ref composed`); await stamp({ clone_meta: { ...meta, clean_product: cleanProduct } }); meta.clean_product = cleanProduct }
      } catch (e) { console.warn(`clean-product ${job.id}:`, e.message) }
    }
    // ASSET-LOCK · PRODUCT SHEET (Higgsfield method) — one composite of the product from front + 3/4 so
    // Seedance 2.5 knows it from every side and holds it as the camera moves. It's a SINGLE image, so it
    // replaces the clean re-shoot as the lead ref (ref count stays 2 → no size inflation). Cached once.
    let productSheet = meta.product_sheet || null
    if (!isService && !productSheet && productImages.length) {
      try {
        productSheet = await composeProductSheet({ productImageUrls: productImages, jobId: job.id })
        if (productSheet) { console.log(`🗂 ${job.id} product sheet composed`); await stamp({ clone_meta: { ...meta, product_sheet: productSheet } }); meta.product_sheet = productSheet }
      } catch (e) { console.warn(`product-sheet ${job.id}:`, e.message) }
    }
    // PRODUCT REFS (2026-07-16): extra reference images add "visual weight" and Seedance inflates the
    // product's size — so refs are capped at TWO: the product sheet / clean re-shoot (or first photo) +
    // the user's second selected photo when they picked one (box + product together looked great on
    // HAIRRESQ). The size guardrails (vision-measured anchor in every prompt + the post-render scale
    // verifier with auto re-roll) are what make the second ref safe to allow.
    const falProductImages = [productSheet || cleanProduct || productImages[0], productImages[1]].filter(Boolean).slice(0, 2)

    // ── FAITHFUL mode: clone the source's edit structure scene-by-scene, then stitch. Each scene is
    // its own Seedance clip with a scene-appropriate prompt (b-roll/lifestyle/product allowed — no
    // forced talking head). No video reference per scene: the beat sheet grounds each prompt, and
    // skipping the ref avoids fal's likeness blocks entirely. ──
    if (meta.mode === 'faithful') {
      const nScenes = Math.max(2, Math.min(16, Number(meta.scene_count) || 2))
      // GENDER LOCK: buildScenePlan copies the on-camera person from beat_sheet.avatar. When the
      // analysis produced no avatar (empty/'none' — e.g. a cached/older beat sheet that only carried
      // beats), the scene writer INVENTS a person and its guess ignores the source's real gender —
      // that's how a man's ad came back as a woman. Backfill the avatar from a real source frame
      // (gender-first description) before planning, unless the user asked to recast. ~2¢, one call.
      if (!meta.character_look && job.source_video_url) {
        const av = String(meta.beat_sheet?.avatar || '').toLowerCase().trim()
        if (!av || av === 'none' || av.startsWith('none')) {
          try {
            const desc = await describeCreator(job.source_video_url, 1, `${job.id}-avatar`)
            if (desc) { meta.beat_sheet = { ...(meta.beat_sheet || {}), avatar: desc }; console.log(`🧍 ${job.id} backfilled source avatar for gender lock`) }
          } catch (e) { console.warn(`avatar backfill ${job.id}:`, e.message) }
        }
      }
      // Reuse the stamped plan on resume — a fresh plan would mismatch the checkpointed clips.
      const scenes = (Array.isArray(meta.scene_plan) && meta.scene_plan.length)
        ? meta.scene_plan
        : await buildScenePlan(meta.beat_sheet, meta.product_details || { name: 'the product' }, productImages.length, nScenes, meta.character_look, finalScript, isService)
      // USER-CHOSEN LENGTH drives the cut: distribute duration_target evenly across the kept scenes, so
      // the footage matches the approved script's pacing. (Scene durations used to keep the SOURCE's
      // timings — a 71s source with a 15s script rendered minutes of footage that the dead-air guard
      // then chopped into a mess.) Only when the plan is fresh — a resumed plan keeps its clip timings.
      const targetSecs = Number(meta.duration_target) || 0
      if (targetSecs && !(Array.isArray(meta.scene_plan) && meta.scene_plan.length)) {
        const per = Math.max(3, Math.min(15, Math.round(targetSecs / Math.max(1, scenes.length))))
        for (const s of scenes) s.duration = per
        console.log(`🎯 ${job.id} cinematic length ${targetSecs}s → ${scenes.length} scenes × ${per}s`)
      }
      const base = join(tmpdir(), `fj-${job.id}`)
      const tmp = []
      let falCost = 0   // estimated fal spend for this job (checkpoint reuses cost nothing)
      try {
        const files = []
        // Checkpointing: each finished clip URL is stamped into clone_meta immediately, so a worker
        // restart (deploy/crash) RESUMES from the last completed scene instead of re-rendering —
        // and re-billing fal for — the whole job.
        const clipsDone = meta.scene_clips || {}
        // CAST ANCHORS — the long-form-UGC identity mechanism, applied to Cinematic. The first time a
        // character (A/B) appears in a RENDERED scene we grab a frame of them; every later scene that
        // features them passes that frame as an @Image ref ("the SAME person as this frame"). Identity
        // flows through pixels, not adjectives — the fix for "a different person in every scene".
        const charAnchors = { ...(meta.scene_char_anchors || {}) }
        // ── PHASE 2.5 (CINEMATIC ONLY) · SEED IDENTITY FROM THE SYNTHETIC CAST SHEET ──────────────
        // fal's likeness filter blocks REAL faces but ACCEPTS AI-generated portraits — so the cast
        // sheet (a clean, synthetic, front-facing portrait built during the storyboard) is a safe,
        // strong character reference. Seeding it as anchor "A" up front means every people-scene locks
        // to the SAME approved presenter from scene 1 onward — the AdMove result — instead of capturing
        // identity from scene 1's RENDER, which is where the "invented a woman" drift crept in whenever
        // a real-frame reference got filter-blocked. The per-scene capture below only fills anchors we
        // DON'T already have, so this cast-sheet seed is never overwritten. UGC never reaches this code.
        if (meta.cast_sheet && !charAnchors.A) { charAnchors.A = meta.cast_sheet; console.log(`🎭 ${job.id} identity seeded from cast sheet (cinematic)`) }
        const N = scenes.length
        const PER_SCENE = 75   // ~seconds a scene render takes → drives the ETA
        for (let i = 0; i < scenes.length; i++) {
          const s = scenes[i]
          // Live progress: scenes are the bulk of the wait (10%→82%), ETA = remaining scenes + finish.
          await prog(`Creating scene ${i + 1} of ${N}…`, 10 + (i / N) * 72, (N - i) * PER_SCENE + 35)
          // Scenes render VISUALS ONLY (ambience, no spoken dialogue) — the narration is one
          // continuous TTS track muxed after the stitch, so the voice can't change between scenes.

          // Resume path: this scene already rendered before a restart → reuse its clip.
          if (clipsDone[i]) {
            const f0 = `${base}-${i}.mp4`
            try {
              await downloadToFile(clipsDone[i], f0)
              tmp.push(f0)
              const fa = await ensureAudio(f0)
              if (!tmp.includes(fa)) tmp.push(fa)
              files.push(fa)
              console.log(`🎞 ${job.id} scene ${i + 1}/${scenes.length} (checkpoint reuse)`)
              continue
            } catch { delete clipsDone[i] /* expired url → regenerate */ }
          }

          // Seedance's minimum render is ~4s: short scenes (fast-cut ads have 1-2s shots) RENDER at
          // 4s and are TRIMMED to their true planned duration by concatClips — so the final cut keeps
          // the source's real rhythm. fal cost is on the rendered seconds.
          const renderDur = Math.max(4, Math.min(15, Math.ceil(Number(s.duration) || 4)))

          // Cut the exact beat range from the original ad as this scene's structural reference.
          let sceneRef = null
          if (job.source_video_url && s.src_start != null) {
            const refDur = Math.min(14, Math.max(3, (s.src_end != null ? s.src_end : s.src_start + s.duration) - s.src_start))
            try { sceneRef = await trimReference(job.source_video_url, job.id, { start: s.src_start, duration: refDur, tag: `sc${i}` }) }
            catch (e) { console.warn(`scene ${i + 1} trim:`, e.message) }
          }

          // PEOPLE+PRODUCT scenes: compose a product-perfect keyframe FIRST (Nano Banana still of the
          // person holding the EXACT product) and lead the video model's references with it — the
          // video model animates a frame that's already correct instead of inventing a blurry bottle.
          let keyframe = null
          // If the FOUNDER already approved a keyframe for this scene in the storyboard (beats[i].preview),
          // animate THAT — their choice, already on-brand and likeness-safe — instead of composing a fresh one.
          const approvedKeyframe = meta.beat_sheet && Array.isArray(meta.beat_sheet.beats) && meta.beat_sheet.beats[i] && meta.beat_sheet.beats[i].preview
          if (approvedKeyframe) {
            keyframe = approvedKeyframe
            console.log(`🖼 ${job.id} scene ${i + 1} using founder-approved storyboard keyframe`)
          } else if (s.has_people && productImages.length) {
            try {
              keyframe = await composeKeyframe({ scenePrompt: s.prompt, productImageUrls: productImages, jobId: job.id, tag: `sc${i}`, aspect: meta.aspect })
              if (keyframe) console.log(`🖼 ${job.id} scene ${i + 1} keyframe composed (product-locked)`)
            } catch (e) { console.warn(`scene ${i + 1} keyframe failed (${e.message}) — continuing without`) }
          }
          // Cast for this scene (letters from the plan; default: one main character on people scenes).
          const cast = Array.isArray(s.cast) && s.cast.length ? s.cast.map(String) : (s.has_people ? ['A'] : [])
          const anchorRefs = [...new Set(cast.map((c) => charAnchors[c]).filter(Boolean))].slice(0, 2)
          // People-free b-roll: a composition still from the source's same beat (faceless → likeness-safe).
          let compStill = null
          if (!s.has_people && sceneRef) { try { compStill = await stillFromClip(sceneRef, job.id, `sc${i}`) } catch (e) { console.warn(`scene ${i + 1} comp still:`, e.message) } }

          const baseImgs = keyframe ? [keyframe, ...falProductImages] : [...falProductImages]
          const anchorIdx = baseImgs.length + 1                       // 1-based @Image index of the first cast anchor
          const compIdx = baseImgs.length + anchorRefs.length + 1     // …and of the composition still
          const sceneImages = [...baseImgs, ...anchorRefs, ...(compStill ? [compStill] : [])].slice(0, 9)
          let scenePrompt = keyframe
            ? `${s.prompt} IMPORTANT — the creator PERFORMS this action fully and visibly on camera (e.g. applies/rolls/sprays/uses the product on themselves as described) — real, continuous movement, NOT just holding the product still. The product in their hands is EXACTLY [Image1] — identical container, cap/applicator, colour and label — kept sharp and identical throughout the motion.`
            : s.prompt
          if (anchorRefs.length) scenePrompt += ` CHARACTER LOCK: [Image${anchorIdx}]${anchorRefs.length > 1 ? ` and [Image${anchorIdx + 1}]` : ''} show this ad's cast one moment ago — treat ${anchorRefs.length > 1 ? 'them' : 'it'} as ground truth: the person${cast.length > 1 ? 's' : ''} in this scene ${cast.length > 1 ? 'are' : 'is'} EXACTLY the same — same face, hair, outfit and styling, continuing seamlessly. Do NOT invent a different person.`
          if (compStill) scenePrompt += ` COMPOSITION: match the framing, subject placement and camera feel of [Image${compIdx}] (a frame from the reference ad's same beat). Do NOT copy any brand text or logos from it — any product shown must be the user's product, exactly as its reference photo.`
          scenePrompt += STYLE_LOCK
          if (process.env.SEEDANCE_DIRECTOR !== 'off') scenePrompt += DIRECTOR_STYLE

          let videoUrl = null
          // GENERATOR ROUTING BY CONTENT — the general fidelity rule (any product, not one vial):
          //  • PRODUCT scene → Seedance led by the FACELESS product keyframe (image-to-video), NO
          //    real-person video ref. The faceless keyframe passes fal's likeness filter (it only
          //    blocks faces in REFERENCE media, never faces Seedance GENERATES in its output), so
          //    Seedance freely generates a fresh person around the pixel-locked product. Sharp product
          //    + real person, no likeness block, no wasted blocked attempt. Motion is Seedance's own —
          //    an accepted trade for a product that's actually correct.
          //  • PEOPLE, NO product → VACE pose-restyle (motion copy is its strength; nothing to blur).
          //  • PEOPLE-free b-roll → Seedance with the source motion ref (no faces → safe).
          if (s.has_people && s.has_product !== false) {
            console.log(`🎞 ${job.id} scene ${i + 1}/${scenes.length} (${s.duration}s, product-scene · seedance keyframe-led)`)
            try {
              ;({ videoUrl } = await falGenerate({ prompt: scenePrompt, imageUrls: sceneImages, resolution: meta.resolution, duration: renderDur, aspect: meta.aspect, tier: meta.tier, generateAudio: false }))
            } catch (e) {
              // The keyframe shows the action (for an application shot, near the head) and Nano Banana
              // sometimes leaves a face in it → fal's likeness filter rejects it. Salvage: retry with
              // just the person-free clean product ref + prompt (no keyframe). If THAT is blocked too,
              // fall through to the bulletproof ladder below (videoUrl stays null) — a likeness block
              // must never kill the job. Non-policy errors still surface.
              if (e.code === 'content_policy_images' || e.code === 'content_policy_video') {
                console.warn(`scene ${i + 1} keyframe blocked (likeness) — retry clean-product only`)
                try {
                  ;({ videoUrl } = await falGenerate({ prompt: `${s.prompt} The product is EXACTLY the attached reference — identical container, cap, colour and label, sharp and in focus.`, imageUrls: falProductImages, resolution: meta.resolution, duration: renderDur, aspect: meta.aspect, tier: meta.tier, generateAudio: false }))
                } catch (e2) {
                  if (e2.code === 'content_policy_images' || e2.code === 'content_policy_video') console.warn(`scene ${i + 1} clean-product blocked too — falling to ladder`)
                  else throw e2
                }
              } else throw e
            }
            if (videoUrl) falCost += clipCost(meta.tier, renderDur)
          }
          if (!videoUrl && s.has_people && s.has_product === false && sceneRef && process.env.CLONE_PEOPLE_RESTYLE !== '0') {
            // PEOPLE-ONLY scene (no product in frame) → pose-guided restyle (Wan VACE): copies the
            // movement skeleton + camera from the source with entirely NEW people.
            console.log(`🎞 ${job.id} scene ${i + 1}/${scenes.length} (${s.duration}s, pose-restyle)`)
            try { videoUrl = await restyleScene({ prompt: scenePrompt, refVideoUrl: sceneRef, imageUrls: sceneImages, duration: renderDur, aspect: meta.aspect }); falCost += VACE_EST_USD_PER_RUN }
            catch (e) { console.warn(`scene ${i + 1} restyle failed (${e.message}) — falling back to prompt-only`) }
          }
          if (!videoUrl && !s.has_people && sceneRef) {
            // PEOPLE-FREE b-roll → source segment straight into Seedance as a motion reference
            // (no faces → no likeness block); prompt-only retry if fal objects anyway.
            console.log(`🎞 ${job.id} scene ${i + 1}/${scenes.length} (${s.duration}s, motion-ref)`)
            try { ({ videoUrl } = await falGenerate({ prompt: scenePrompt, imageUrls: sceneImages, videoUrl: sceneRef, resolution: meta.resolution, duration: renderDur, aspect: meta.aspect, tier: meta.tier, generateAudio: false })); falCost += clipCost(meta.tier, renderDur) }
            catch (e) {
              // ANY content-policy block (video ref OR image — fal mislabels which) → drop the refs and
              // let the bulletproof ladder below salvage. Real errors still surface.
              if (e.code === 'content_policy_video' || e.code === 'content_policy_images') console.warn(`scene ${i + 1} ref blocked (likeness) — laddering down`)
              else throw e
            }
          }
          if (!videoUrl) {
            // BULLETPROOF FALLBACK LADDER — a scene must NEVER fail the whole job on a likeness block.
            // Step down until fal accepts: keyframe/product images → product-only image → PURE PROMPT
            // (text can't be flagged for likeness). Product fidelity degrades a step at a time, but the
            // render always completes.
            const step = async (imgs, promptForImgs) => (await falGenerate({ prompt: imgs.length ? promptForImgs : s.prompt, imageUrls: imgs, resolution: meta.resolution, duration: renderDur, aspect: meta.aspect, tier: meta.tier, generateAudio: false })).videoUrl
            const blocked = (e) => e.code === 'content_policy_images' || e.code === 'content_policy_video'
            console.log(`🎞 ${job.id} scene ${i + 1}/${scenes.length} (${s.duration}s, prompt-only${keyframe ? '+keyframe' : ''})`)
            try { videoUrl = await step(sceneImages, scenePrompt) }
            catch (e1) {
              if (!blocked(e1)) throw e1
              console.warn(`scene ${i + 1} images blocked — retry product-only`)
              try { videoUrl = await step(falProductImages, `${s.prompt} The product is EXACTLY the attached reference — same container, colour and label, sharp.`) }
              catch (e2) {
                if (!blocked(e2)) throw e2
                console.warn(`scene ${i + 1} product image blocked too — retry pure prompt (no images)`)
                videoUrl = await step([], s.prompt)
              }
            }
            falCost += clipCost(meta.tier, renderDur)
          }
          let f = `${base}-${i}.mp4`
          await downloadToFile(videoUrl, f)
          tmp.push(f)
          // Debuting cast member(s) in this scene → capture their identity anchor from the rendered clip
          // (a frame near the end, same helper the UGC segment chain uses). Later scenes lock to it.
          for (const c of cast) {
            if (charAnchors[c]) continue
            try {
              const a = await lastFrameAnchor(f, job.id, `cast${c}-${i}`)
              if (a) { charAnchors[c] = a; console.log(`🎭 ${job.id} cast anchor "${c}" captured from scene ${i + 1}`) }
            } catch (e) { console.warn(`cast anchor ${c} (scene ${i + 1}):`, e.message) }
          }
          f = await ensureAudio(f)          // VACE clips are silent → pad a silent track for concat
          if (!tmp.includes(f)) tmp.push(f)
          files.push(f)
          // Checkpoint this scene so a restart never re-renders (or re-bills fal for) it.
          clipsDone[i] = videoUrl
          await stamp({ clone_meta: { ...meta, scene_plan: scenes, scene_clips: clipsDone, scene_char_anchors: charAnchors } })
          meta.scene_plan = scenes; meta.scene_clips = clipsDone; meta.scene_char_anchors = charAnchors   // keep meta current so progress writes don't clobber checkpoints
        }
        // Assemble a full cut from a clip list: concat → VO mux → end-card. Reused by the main cut,
        // the hook variants (different scene 1) and the extra-language outputs (different VO).
        let mainVoUrl = null   // the MAIN cut's VO, uploaded so the Remotion timeline can play it
        const assemble = async (clipFiles, voText, tag) => {
          const catX = `${base}-${tag}-cat.mp4`
          tmp.push(catX)
          await concatClips(clipFiles, catX, scenes.map((sc) => sc.duration))   // hard-cap each clip to its planned length
          let cut = catX
          if (voText && voText.trim()) {
            try {
              // Cap the VO to the stitched-clip length (+small tail) BEFORE TTS, so a long script can't
              // freeze-extend the video past the source. Fall back to the known scene-duration sum if
              // ffprobe can't read the concat (that fallback is why an earlier render still hit 42s).
              const clipDur = (await probeDuration(catX)) || scenes.reduce((a, s) => a + (Number(s.duration) || 5), 0) || 15
              const voForTts = capScriptToSeconds(voText, clipDur * 1.25 + 2)
              const vo = await ttsVoiceover(voForTts, `${job.id}-${tag}`, meta.voice, meta.language)
              tmp.push(vo)
              if (tag === 'main') { try { mainVoUrl = await uploadAudioR2(vo, `creatives/vo/${job.id}.mp3`) } catch (e) { console.warn(`vo upload ${job.id}:`, e.message) } }
              const mixed = `${base}-${tag}-vo.mp4`
              tmp.push(mixed)
              await muxVoiceover(catX, vo, mixed)
              cut = mixed
            } catch (e) { console.warn(`tts/mux (${tag}) failed for ${job.id} (shipping without VO):`, e.message) }
          }
          return withEndCard(cut, meta, job.id, tag, tmp)
        }

        // Pace the voiceover to the FULL stitched length so the voice covers the whole ad (UGC-style)
        // instead of finishing early and getting the tail trimmed. Expanded once, reused by every cut.
        const vidSecs = scenes.reduce((a, s) => a + (Number(s.duration) || 5), 0)
        const voScript = await fillScriptToLength(finalScript, vidSecs, meta.language, meta.product_details?.name)
        await prog('Stitching + voiceover…', 86, 30)
        const main = await assemble(files, voScript, 'main')
        await prog('Finishing up…', 95, 12)
        let ovMain = await burnOverlays(main.file, meta.overlays, job.id); tmp.push(ovMain);
        // Service/app only: drop the user's real screenshots into the app-demo beats (physical untouched).
        if (isService) { ovMain = await burnAppDemo(ovMain, meta.beat_sheet && meta.beat_sheet.app_demo, meta.product_image_urls, job.id, meta.screencast_url); tmp.push(ovMain) }
        const url = await uploadVideo(ovMain, `creatives/${job.user_id}/${job.id}.mp4`)
        // Settle the end-card tx on the MAIN cut's outcome (applied → commit, failed → refund).
        if (meta.end_card && meta.end_card.tx) {
          if (main.applied) await rpc('commit_credits', { p_tx: meta.end_card.tx, p_metadata: { endcard: true } })
          else await rpc('refund_credits', { p_tx: meta.end_card.tx })
        }
        // Remotion is the DEFAULT cinematic assembly: emit the timeline (silent scene clips + VO track +
        // captions + brand) and request a render that REPLACES image_url with the Remotion cut. The
        // ffmpeg `url` above stays as image_url until selfmade-render succeeds → automatic fallback if it fails.
        let cineTimeline = null
        try { cineTimeline = buildCinematicTimeline(meta, scenes, clipsDone, voScript, mainVoUrl) } catch (e) { console.warn(`cine timeline ${job.id}:`, e.message) }
        await stamp({ status: 'done', media_type: 'video', image_url: url, clone_meta: { ...meta, scene_plan: scenes, script: voScript, final_script: voScript, fal_cost_est: +falCost.toFixed(2), ...(meta.hook_variants_tx ? { hook_label: 'Original hook' } : {}), ...(cineTimeline ? { timeline: cineTimeline, render: { status: 'requested', aspects: ['9:16'], replaceImageUrl: true } } : {}) } })
        if (job.credit_tx) await rpc('commit_credits', { p_tx: job.credit_tx, p_metadata: { mode: 'faithful', scenes: scenes.length, actual_cost_usd: +falCost.toFixed(2) } })
        console.log(`🎬 cloned (faithful, ${scenes.length} scenes) ${job.id} → ${url}`)

        // ── EXTRA LANGUAGES: transcreate + new TTS over the SAME rendered visuals → own creative. ──
        for (const ex of (Array.isArray(meta.extra_langs) ? meta.extra_langs : [])) {
          try {
            const script2 = await transcreateScript(voScript || meta.script || '', ex.lang)
            const cut = await assemble(files, script2, `lang-${ex.lang}`)
            const url2 = await uploadVideo(cut.file, `creatives/${job.user_id}/${job.id}-${ex.lang}.mp4`)
            await insertRow({ user_id: job.user_id, parent_id: job.id, type: 'video_clone', media_type: 'video', status: 'done', tier: job.tier || 'pro', prompt: `clone · ${ex.lang}`, image_url: url2, clone_meta: { language: ex.lang, script: script2, variant_of: job.id, variant: `lang-${ex.lang}` } })
            if (ex.tx) await rpc('commit_credits', { p_tx: ex.tx, p_metadata: { lang: ex.lang, actual_cost_usd: 0.02 } })
            console.log(`🌍 ${job.id} extra language ${ex.lang} → ${url2}`)
          } catch (e) {
            console.warn(`extra lang ${ex.lang} failed for ${job.id}:`, e.message)
            if (ex.tx) await rpc('refund_credits', { p_tx: ex.tx })
          }
        }

        // ── HOOK VARIANTS: re-render ONLY scene 1 two more ways, stitch two full alt cuts. ──
        if (meta.hook_variants_tx) {
          try {
            const variants = await hookVariantPrompts(scenes[0].prompt)
            let vCost = 0
            for (let vi = 0; vi < variants.length; vi++) {
              const label = variants[vi].label
              const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-')
              const { videoUrl } = await falGenerate({ prompt: variants[vi].prompt, imageUrls: falProductImages, resolution: meta.resolution, duration: scenes[0].duration, aspect: meta.aspect, tier: meta.tier, generateAudio: false })
              vCost += clipCost(meta.tier, scenes[0].duration)
              let vf = `${base}-${slug}.mp4`
              await downloadToFile(videoUrl, vf)
              tmp.push(vf)
              vf = await ensureAudio(vf)
              if (!tmp.includes(vf)) tmp.push(vf)
              const cut = await assemble([vf, ...files.slice(1)], finalScript, slug)
              const urlV = await uploadVideo(cut.file, `creatives/${job.user_id}/${job.id}-${slug}.mp4`)
              // Clear A/B label so the user can tell the versions apart in My Creatives.
              await insertRow({ user_id: job.user_id, parent_id: job.id, type: 'video_clone', media_type: 'video', status: 'done', tier: job.tier || 'pro', prompt: `Hook: ${label}`, image_url: urlV, clone_meta: { variant_of: job.id, hook_label: label, hook_prompt: variants[vi].prompt, script: finalScript } })
              console.log(`⚡ ${job.id} hook「${label}」→ ${urlV}`)
            }
            await rpc('commit_credits', { p_tx: meta.hook_variants_tx, p_metadata: { hook_variants: 2, actual_cost_usd: +vCost.toFixed(2) } })
          } catch (e) {
            console.warn(`hook variants failed for ${job.id}:`, e.message)
            await rpc('refund_credits', { p_tx: meta.hook_variants_tx })
          }
        }
      } finally {
        for (const f of tmp) await rm(f, { force: true }).catch(() => {})
      }
      return
    }

    // ── LONG-FORM UGC (30/60s): the approved script splits into 2/4 segments at sentence
    // boundaries; every segment prompt opens with the SAME character paragraph, and each clip after
    // the first is anchored to the previous clip's final frame (@Image1) so the creator carries
    // through the cuts. Physical segments also pass a per-segment product-truth check that re-rolls a
    // clip that invents a part.
    //
    // VOICE (default = Seedance NATIVE audio): Seedance generates the mouth AND the voice together, so
    // lips actually sync — English (and short Urdu) come out great this way. The tradeoff is that each
    // segment is a separate generation, so the voice can shift at the SEAM between clips (the garbled
    // ejad-milk 11-14s). Set meta.tts_overlay=true to instead render segments SILENT + lay ONE
    // continuous overlay voice (ElevenLabs for non-English, else OpenAI) — one clean voice, no seam
    // shift, but lips only approximate. Default off per the user's call (native English is excellent). ──
    const useOverlayVoice = meta.tts_overlay === true
    const nSeg = Math.min(4, Math.max(1, Number(meta.segments) || 1))
    if (nSeg > 1) {
      // Reuse the stamped plan + clips on resume (see faithful-mode checkpointing note).
      const plan = (meta.segment_plan && Array.isArray(meta.segment_plan.segments) && meta.segment_plan.segments.length)
        ? meta.segment_plan
        : await buildSegmentPlan(meta.beat_sheet, meta.product_details || { name: 'the product' }, productImages.length, finalScript, nSeg, meta.character_look, isService)
      const base = join(tmpdir(), `sj-${job.id}`)
      const tmp = []
      let falCost = 0
      try {
        const files = []
        const segClips = meta.segment_clips || {}
        const segAnchors = meta.segment_anchors || {}
        const productFixWindows = []   // segment indices we cover with a FULL real-photo shot (fal-cap fallback)
        const cutawaySegs = []         // segments re-shot product-FREE → weave a short real-photo cutaway in
        // Once Seedance proves it can't render THIS product, every LATER segment is shot product-free (the
        // creator talks, hands empty) and the product is shown only via accurate real-photo cutaways —
        // so no wrong product is ever on screen and nothing is pasted onto a moving hand. Persisted for resume.
        let productBroken = meta.product_broken === true
        let anchor = null
        // Render each segment to match its SCRIPT length (min 5s — Seedance's floor), not a flat 15s.
        // Flat 15s meant a 6-word line got ~9s of trailing dead-air (the mid-video "hang") AND we paid
        // fal for seconds no one hears. ~2.6 words/sec + a 1s tail, clamped 5–15s.
        const segDurs = plan.segments.map((s) => {
          const words = String(s.script || s.text || '').trim().split(/\s+/).filter(Boolean).length
          return Math.max(5, Math.min(15, Math.round(words / 2.6) + 1))
        })
        for (let i = 0; i < plan.segments.length; i++) {
          if (segClips[i]) {
            const f0 = `${base}-${i}.mp4`
            try {
              await downloadToFile(segClips[i], f0)
              tmp.push(f0); files.push(f0)
              anchor = segAnchors[i] || anchor
              console.log(`🎞 ${job.id} segment ${i + 1}/${plan.segments.length} (checkpoint reuse)`)
              continue
            } catch { delete segClips[i] /* expired url → regenerate */ }
          }
          // Product-free once Seedance has proven it can't render this product (see productBroken).
          const productFree = !isService && productBroken
          const prompt = productFree
            ? segmentPrompt(plan, plan.segments[i], i, plan.segments.length, false, 0, meta.language, { productFree: true })
            : segmentPrompt(plan, plan.segments[i], i, plan.segments.length, false, productImages.length, meta.language, { sizeAnchor: meta.product_details && meta.product_details.size_anchor })
          // COST FIX: we USED to pass the previous clip's last frame (the creator's face) as an anchor for
          // cross-cut continuity. But that face frame reliably trips fal's likeness filter at RESULT time —
          // and fal CHARGES for the rejected clip — after which we fell back to product-only anyway. So a
          // 2-segment render was paying for ~3 clips (seg1 + doomed anchored seg2 + product-only seg2).
          // We now go product-only from the start: SAME shipped output, ~30% cheaper. Continuity is held by
          // the identical character description repeated in every segment prompt. (Set meta.try_anchor=true
          // to restore the old anchored attempt.)
          const useAnchor = !productFree && anchor && meta.try_anchor === true
          // STORYBOARD-FIRST: if the founder approved a keyframe for this scene (Storyboard step wrote it to
          // beat_sheet.beats[i].preview — AI-generated OR their own uploaded asset), lead the reference set
          // with it so Seedance 2.5 renders the video the user already signed off on. Falls back to product
          // photos via the moderation ladder below, so a blocked/absent keyframe never kills the segment.
          const approvedKf = !productFree && meta.beat_sheet?.beats?.[i]?.preview ? meta.beat_sheet.beats[i].preview : null
          const imgs = productFree ? []
            : approvedKf ? [approvedKf, ...falProductImages].slice(0, 9)
            : useAnchor ? [anchor, ...falProductImages].slice(0, 9)
            : falProductImages
          console.log(`🎞 ${job.id} segment ${i + 1}/${plan.segments.length}${productFree ? ' (product-free)' : useAnchor ? ' (anchored)' : ''}`)
          const segDur = segDurs[i]
          // Default (native voice): generateAudio TRUE → Seedance speaks + lip-syncs the segment itself.
          // Overlay mode (meta.tts_overlay): FALSE → silent clip, one continuous voice added after concat.
          const genAudio = !useOverlayVoice
          let videoUrl
          const segBlocked = (x) => x.code === 'content_policy_images' || x.code === 'content_policy_video'
          // Ladder: (anchor+products if enabled →) products only → PURE PROMPT. A segment must never kill
          // the whole long-form render on a moderation block (same contract as faithful mode).
          const rungs = productFree ? [[]] : [imgs, ...((approvedKf || useAnchor) ? [falProductImages] : []), []]
          for (let ri = 0; ri < rungs.length; ri++) {
            try { ({ videoUrl } = await falGenerate({ prompt, imageUrls: rungs[ri], resolution: meta.resolution, duration: segDur, aspect: meta.aspect, tier: meta.tier, generateAudio: genAudio })); break }
            catch (e) {
              if (!segBlocked(e) || ri === rungs.length - 1) throw e
              console.warn(`segment ${i + 1} refs blocked — laddering down`)
            }
          }
          falCost += clipCost(meta.tier, segDur, genAudio)
          const f = `${base}-${i}.mp4`
          await downloadToFile(videoUrl, f)
          // PER-SEGMENT PRODUCT CHECK (physical only): if Seedance invented a part the real product
          // doesn't have (a cap on a capless pouch), re-roll with a hard correction — and VERIFY THE
          // RE-ROLL TOO (the ejad job's first re-roll ALSO grew a spout and shipped unchecked). Up to
          // 2 corrective rolls; the 2nd drops the anchor and goes clean-product-only with the size
          // anchor, the strongest constraint we have. After 2, ship the last take (never-fail).
          if (!isService && !productFree && meta.reroll_product_check !== false) {
            const prodRef = falProductImages[0] || productImages[0]
            const pd = meta.product_details || {}
            const prodDesc = [pd.name && pd.name !== 'the product' ? pd.name : '', pd.observed].filter(Boolean).join(' — ')
            // Product-AGNOSTIC correction: anchor to the photo + the product's own detected description,
            // and forbid inventing/removing parts across ALL container types — not just pouches/caps.
            const fixLine = `\n\nCRITICAL PRODUCT ACCURACY: render the product EXACTLY as the attached photo${prodDesc ? ` (it is: ${prodDesc})` : ''} — same container type, silhouette, closure and parts. The photo shows the COMPLETE product; every edge and closure is exactly as pictured. Do NOT add, remove, invent or change ANY part (cap, lid, spout, nozzle, pump, straw, neck, box, wrapper, sleeve): if the real product doesn't have it, it must not appear; if it does, keep it. Keep the exact form factor shown (a pouch stays a pouch, a bottle stays that bottle, a jar stays that jar).`
            let verdict = await verifySegmentProduct(f, prodRef, prodDesc, job.id, i)
            // SELF-HEAL (default ON): before spending a full segment re-roll, try a SURGICAL Seedance 2.5
            // edit on this exact clip — fix the product in place, keep the good motion/voice/framing, and
            // pay for only these ~5s. Download to a SEPARATE file and verify; only adopt it if it clears
            // (else discard and fall through to the existing re-roll ladder — original clip untouched).
            // This is our vision-check-and-auto-fix pass — it runs server-side BEFORE status=done, so the
            // user only ever sees a video whose product already passed the check. Set VIDEO_FIX_ENGINE=off
            // to disable and go straight to the re-roll ladder.
            if (verdict === 'mismatch' && process.env.VIDEO_FIX_ENGINE !== 'off' && falCost < MAX_FAL_USD) {
              try {
                console.warn(`✎ ${job.id} seg ${i + 1}: Seedance 2.5-Edit fixing product in place (no full re-roll)`)
                const editUrl = await seedanceEditSegment({ clipUrl: videoUrl, productImg: prodRef, aspect: meta.aspect,
                  instruction: `Within this clip, replace the product the person holds/shows with the EXACT product in the reference image${prodDesc ? ` (${prodDesc})` : ''} — same container type, closure, colour and label. Change NOTHING else: keep the same person, motion, camera, lighting and audio.` })
                if (editUrl) {
                  falCost += clipCost(meta.tier, segDur, false)
                  // Overwrite f's file with the edit and verify it. If it clears, we keep it; if not,
                  // verdict stays 'mismatch' → the existing re-roll below regenerates f from scratch,
                  // so overwriting here is safe either way (const f is fine — we write the file, not the var).
                  await rm(f, { force: true }).catch(() => {})
                  await downloadToFile(editUrl, f)
                  const ev = await verifySegmentProduct(f, prodRef, prodDesc, `${job.id}-e`, i)
                  if (ev === 'match') { videoUrl = editUrl; verdict = 'match'; console.log(`✓ ${job.id} seg ${i + 1} fixed by 2.5-Edit — skipped the re-roll`) }
                  else console.warn(`2.5-Edit didn't clear seg ${i + 1} — falling to re-roll`)
                }
              } catch (e) { console.warn(`2.5-Edit seg ${i + 1} failed (${e.message}) — falling to re-roll`) }
            }
            if (verdict === 'mismatch') {
              // HARD SPEND CAP: never re-roll if this job's fal spend is already at the ceiling — the
              // persistent mismatch gets the FREE real-photo cover instead of burning another generation.
              if (falCost >= MAX_FAL_USD) {
                console.warn(`⛔ ${job.id} seg ${i + 1}: fal cap $${MAX_FAL_USD} reached — skipping re-roll, will cover with real photo`)
              } else try {
                console.warn(`↻ ${job.id} re-rolling segment ${i + 1} (invented product part)`)
                const rr = await falGenerate({ prompt: `${prompt}${fixLine}`, imageUrls: imgs, resolution: meta.resolution, duration: segDur, aspect: meta.aspect, tier: meta.tier, generateAudio: genAudio })
                falCost += clipCost(meta.tier, segDur, genAudio)
                await rm(f, { force: true }).catch(() => {})
                await downloadToFile(rr.videoUrl, f)
                videoUrl = rr.videoUrl
                verdict = await verifySegmentProduct(f, prodRef, prodDesc, `${job.id}-r`, i)
              } catch (e) { console.warn(`segment ${i + 1} re-roll failed (keeping current take):`, e.message) }
            }
            // Still wrong after the corrective re-roll → Seedance genuinely can't render this product.
            // From here on we stop asking it to: mark productBroken so every LATER segment is shot
            // product-free. For THIS segment, RE-SHOOT it product-free too (a clean talking-head, nothing
            // to mis-render) and weave in a short real-photo CUTAWAY — the "2s product close-up then back
            // to the creator" pattern. If we're at the fal cap, fall back to covering the whole segment.
            if (verdict === 'mismatch') {
              productBroken = true
              if (falCost < MAX_FAL_USD) {
                try {
                  console.warn(`🎬 ${job.id} segment ${i + 1} → product-free re-shoot + real-photo cutaway (Seedance can't render this product)`)
                  const pfPrompt = segmentPrompt(plan, plan.segments[i], i, plan.segments.length, false, 0, meta.language, { productFree: true })
                  const pf = await falGenerate({ prompt: pfPrompt, imageUrls: [], resolution: meta.resolution, duration: segDur, aspect: meta.aspect, tier: meta.tier, generateAudio: genAudio })
                  falCost += clipCost(meta.tier, segDur, genAudio)
                  await rm(f, { force: true }).catch(() => {})
                  await downloadToFile(pf.videoUrl, f)
                  videoUrl = pf.videoUrl
                  cutawaySegs.push(i)
                } catch (e) {
                  console.warn(`segment ${i + 1} product-free re-shoot failed (${e.message}) — covering full segment`)
                  productFixWindows.push(i)
                }
              } else {
                console.warn(`⛔ ${job.id} seg ${i + 1}: fal cap — covering full segment with real photo`)
                productFixWindows.push(i)
              }
            }
          }
          tmp.push(f); files.push(f)
          if (i < plan.segments.length - 1) anchor = await lastFrameAnchor(f, job.id, i)
          segClips[i] = videoUrl
          if (anchor) segAnchors[i] = anchor
          await stamp({ clone_meta: { ...meta, segment_plan: plan, segment_clips: segClips, segment_anchors: segAnchors, product_broken: productBroken } })
        }
        // FREEZE GUARD: if Seedance couldn't render the product for a CONTIGUOUS RUN OF TRAILING
        // segments, do NOT paste a 20s+ static product photo over the whole tail — that's the "frozen
        // second half" the ejad-milk 60s hit (segments 3+4 both failed → 24s still image). Drop those
        // trailing segments and ship a shorter, fully-LIVE cut instead: a clean 26s ad beats a 52s ad
        // whose back half is a frozen photo. Always keep ≥1 segment. Middle failures still get a
        // bounded real-photo cover (below).
        const flaggedSet = new Set(productFixWindows)
        let keepN = files.length
        while (keepN > 1 && flaggedSet.has(keepN - 1)) keepN--
        const droppedTail = files.length - keepN
        if (droppedTail) console.warn(`✂️ ${job.id} dropping ${droppedTail} trailing segment(s) Seedance couldn't render — shipping a live ${keepN}-segment cut instead of a frozen product hold`)
        const keptFiles = files.slice(0, keepN)
        const keptDurs = segDurs.slice(0, keepN)
        // Only segments that FAILED but sit INSIDE the kept range still need the (bounded) real-photo cover.
        const midFails = productFixWindows.filter((i) => i < keepN)
        const cat = `${base}-cat.mp4`
        tmp.push(cat)
        await concatClips(keptFiles, cat, keptDurs)   // each segment trimmed to its own script-matched length
        // Native mode (default): the concatenated clips already carry Seedance's own lip-synced voice —
        // ship it as-is. Overlay mode (meta.tts_overlay): the clips are silent, so lay ONE continuous
        // voice over the whole stitched video (ElevenLabs for non-English, else OpenAI).
        let voiced = cat
        if (useOverlayVoice && finalScript && finalScript.trim()) {
          try {
            const clipDur = (await probeDuration(cat)) || keptDurs.reduce((a, d) => a + d, 0) || 15
            const vo = await ttsVoiceover(capScriptToSeconds(finalScript, clipDur * 1.25 + 2), `${job.id}-seg`, meta.voice, meta.language)
            tmp.push(vo)
            const mixed = `${base}-vo.mp4`; tmp.push(mixed)
            await muxVoiceover(cat, vo, mixed)
            voiced = mixed
          } catch (e) { console.warn(`seg tts/mux failed for ${job.id} (shipping without VO):`, e.message) }
        }
        // PRODUCT B-ROLL CUTAWAYS: for products Seedance can't render, the failed segment was re-shot
        // product-free (a clean talking-head) and we now CUT AWAY to the REAL product photo for ~2.5s
        // within it — the "product close-up, then back to the creator" pattern real editors use. No hand
        // sticker, no frozen half. Cap-fallback segments (productFixWindows) instead get a longer real-
        // photo cover of their whole window. Voice keeps playing throughout.
        if ((cutawaySegs.length || midFails.length) && !isService) {
          try {
            const prodUrl = (Array.isArray(meta.product_image_urls) && meta.product_image_urls[0]) || meta.clean_product
            const starts = []; let acc = 0
            for (let k = 0; k < keptDurs.length; k++) { starts[k] = acc; acc += keptDurs[k] }
            const windows = []
            // Short cutaway (~2.5s, but ≤ half the segment) placed a beat into each product-free re-shoot.
            for (const i of cutawaySegs) {
              if (i >= keepN) continue
              const len = Math.min(2.5, Math.max(1.5, keptDurs[i] * 0.5))
              windows.push({ from: starts[i] + Math.min(1.2, keptDurs[i] * 0.25), len })
            }
            // Cap-fallback: cover the whole failed segment (we couldn't re-shoot it product-free).
            for (const i of midFixWindows) windows.push({ from: starts[i], len: keptDurs[i] })
            if (windows.length) {
              const covered = `${base}-covered.mp4`; tmp.push(covered)
              voiced = await coverWindowsWithProduct(voiced, covered, windows, prodUrl, job.id, tmp)
            }
          } catch (e) { console.warn(`product cutaway/cover failed for ${job.id} (shipping as-is):`, e.message) }
        }
        const fin = await withEndCard(voiced, meta, job.id, 'main', tmp)
        if (meta.end_card && meta.end_card.tx) {
          if (fin.applied) await rpc('commit_credits', { p_tx: meta.end_card.tx, p_metadata: { endcard: true } })
          else await rpc('refund_credits', { p_tx: meta.end_card.tx })
        }
        let ovFin = await burnOverlays(fin.file, meta.overlays, job.id)
        if (isService) { ovFin = await burnAppDemo(ovFin, meta.beat_sheet && meta.beat_sheet.app_demo, meta.product_image_urls, job.id, meta.screencast_url) }
        const url = await uploadVideo(ovFin, `creatives/${job.user_id}/${job.id}.mp4`)
        // CLOBBER FIX: keep segment_clips/segment_anchors in the FINAL write. `...meta` is the pre-loop
        // snapshot (no clips); the per-segment stamps wrote clips to the DB but not to this local `meta`,
        // so spreading `...meta` here wiped them — which killed the "Fix one section" tweak panel
        // (segmentTweakable needs segment_clips). Persist the accumulated clips + anchors explicitly.
        await stamp({ status: 'done', media_type: 'video', image_url: url, clone_meta: { ...meta, segment_plan: plan, segment_clips: segClips, segment_anchors: segAnchors, script: finalScript, final_script: finalScript, fal_cost_est: +falCost.toFixed(2), dropped_segments: droppedTail, shipped_segments: keepN, product_broken: productBroken, cutaway_segments: cutawaySegs.length } })
        if (job.credit_tx) await rpc('commit_credits', { p_tx: job.credit_tx, p_metadata: { mode: 'ugc_long', segments: nSeg, actual_cost_usd: +falCost.toFixed(2) } })
        console.log(`🎬 cloned (long UGC, ${nSeg} segments) ${job.id} → ${url}`)
      } finally {
        for (const f of tmp) await rm(f, { force: true }).catch(() => {})
      }
      return
    }

    // ── UGC mode (default): one talking-head clip. ──
    // FIT THE SCRIPT TO THE CLIP LENGTH. The draft was capped to the SOURCE ad's talk-time (e.g. a
    // 41s Telugu ad), but the user may pick a SHORTER clip (15s). A too-long script crammed into a
    // short clip makes Seedance rush, garble, and hallucinate a foreign-sounding tail (the audio
    // "leak"). Re-cap to the clip's real seconds at the target language's speaking rate so the speech
    // fills the clip cleanly and ends on a real sentence.
    const UGC_WPS = { en: 2.3, ur: 1.9, hi: 2.0, ar: 1.7, es: 2.5, fr: 2.4, de: 2.1 }
    const fitRate = UGC_WPS[(meta.language || 'en').slice(0, 2)] || 2.1
    const bucketSecs = Number(meta.duration) || 15         // the user's chosen MAX bucket (15/…)
    const fitScript = capScriptToSeconds(finalScript, bucketSecs, fitRate)
    // FIT THE CLIP LENGTH TO THE SPEECH — the bucket (15s) is a MAX, not a fixed length. If the source
    // ad (and its transcreated script) is only ~8s, render an ~8-9s clip, NOT 15s: Seedance fills any
    // leftover seconds with HALLUCINATED audio (the "voice hibernates after 8s" bug). We also never
    // exceed the source's own length (clone = match the source). Clamped to Seedance's 5-15s range.
    const scriptWords = (fitScript || '').trim().split(/\s+/).filter(Boolean).length
    const speechSecs = scriptWords ? scriptWords / fitRate : bucketSecs
    const srcSecs = Number(meta?.beat_sheet?.duration_seconds) || Number(meta.source_seconds) || bucketSecs
    const clipSecs = Math.max(5, Math.min(bucketSecs, Math.ceil(Math.min(speechSecs + 1, srcSecs + 0.5))))
    if (clipSecs !== bucketSecs) console.log(`⏱ ${job.id} UGC clip fit to ${clipSecs}s (speech≈${speechSecs.toFixed(1)}s, src≈${srcSecs}s, bucket=${bucketSecs}s) — no dead-air tail`)
    // Rebuild the prompt around the (fitted) approved script so the spoken audio matches exactly.
    const { prompt, script } = await buildSeedancePrompt(meta.beat_sheet, meta.product_details || { name: 'the product' }, productImages.length, fitScript, meta.character_look, meta.language, isService)

    // Trim the competitor clip to fal's ≤15s / ≤720p reference limits (raw ad videos exceed them).
    let refVideo = null
    if (job.source_video_url) { try { refVideo = await trimReference(job.source_video_url, job.id) } catch (e) { console.warn('trim ref:', e.message) } }

    // Try WITH the video as a motion reference. fal blocks reference videos that contain real people
    // (likeness policy) — which is nearly every UGC ad — so on a content_policy_violation we retry
    // WITHOUT the video: Gemini's beat sheet already grounds the prompt in the ad's structure/hook,
    // and Seedance generates a fresh (non-real) creator. Product-only/no-people videos keep the motion ref.
    // Preview-accurate voice (meta.tts_overlay, already resolved above as useOverlayVoice): render SILENT
    // + overlay the exact TTS voice the user auditioned. Default = native Seedance voice (tightest sync).
    const genArgs = { prompt, resolution: meta.resolution, duration: clipSecs, aspect: meta.aspect, tier: meta.tier, ...(useOverlayVoice ? { generateAudio: false } : {}) }
    await prog('Filming your video…', 35, 150)   // the fal render is one long await — keep the bar moving
    // NEVER-FAIL LADDER (same contract as faithful mode): a moderation block on ANY reference must
    // degrade fidelity a step, not kill the render. fal moderation is borderline/non-deterministic —
    // the same product photo can pass one render and fail the next, and some product CATEGORIES
    // (e.g. smoking/vaping devices) are rejected outright no matter the shot. Ordered rungs, best
    // fidelity first, ending in PURE PROMPT (text can't be flagged) so a usable ad always ships:
    //   1. clean product + motion-ref video   2. clean product only   3. ORIGINAL uploaded photo
    //   4. pure prompt (no refs — product from the description only).
    const blockedUgc = (e) => e.code === 'content_policy_images' || e.code === 'content_policy_video' || /content_policy_violation|likeness|real people/i.test(String(e.message))
    const rungs = [
      { imageUrls: falProductImages, videoUrl: refVideo || null, tag: 'clean+motion' },
      { imageUrls: falProductImages, videoUrl: null, tag: 'clean product' },
      { imageUrls: productImages.slice(0, 1), videoUrl: null, tag: 'original photo' },
      { imageUrls: [], videoUrl: null, tag: 'pure prompt' },
    ].filter((r, i) => i === 0 || r.imageUrls.length || i === 3)   // skip empty-image middle rungs
    let videoUrl, requestId
    for (let ri = 0; ri < rungs.length; ri++) {
      try {
        ({ videoUrl, requestId } = await falGenerate({ ...genArgs, imageUrls: rungs[ri].imageUrls, videoUrl: rungs[ri].videoUrl }))
        if (ri > 0) console.warn(`ugc ${job.id}: landed on rung "${rungs[ri].tag}"`)
        break
      } catch (e) {
        if (!blockedUgc(e) || ri === rungs.length - 1) throw e
        console.warn(`ugc ${job.id}: "${rungs[ri].tag}" blocked — laddering down`)
      }
    }

    const singleTmp = []
    let singleFile = join(tmpdir(), `sc-${job.id}.mp4`)
    singleTmp.push(singleFile)
    await downloadToFile(videoUrl, singleFile)
    await prog('Checking product size…', 78, 30)

    let falCostUgc = 0   // extra fal spend from the auto size-fix re-roll (ours to absorb)
    // ── AUTO SIZE-VERIFIER (verify-and-retry, the pattern that fixed image clones): LOOK at the
    // finished render; if the product is judged OVERSIZED vs its measured anchor, re-roll ONCE with
    // a hard corrective prompt — the user never receives the inflated version. Bounded to one retry;
    // the second roll ships regardless (never-fail). Check ~1¢; retry only costs on actual failures. ──
    try {
      const anchor = (meta.product_details && meta.product_details.size_anchor) || null
      const verdict = isService ? 'skip' : await verifyProductScale(singleFile, anchor, job.id)   // no product to scale-check
      console.log(`📏 ${job.id} scale verdict: ${verdict}`)
      if (verdict === 'oversized') {
        await prog('Product size looked off — auto-fixing…', 80, 120)
        const fixPrompt = `${prompt}${CHIP_FIX.size}${anchor ? ` The product's true size: ${anchor}.` : ''}`
        let fixedUrl = null
        try {
          ({ videoUrl: fixedUrl } = await falGenerate({ ...genArgs, prompt: fixPrompt, videoUrl: null }))
        } catch (e) {
          if (blockedUgc(e)) { try { ({ videoUrl: fixedUrl } = await falGenerate({ ...genArgs, prompt: fixPrompt, imageUrls: [], videoUrl: null })) } catch { /* keep original */ } }
        }
        if (fixedUrl) {
          falCostUgc += clipCost(meta.tier, clipSecs, true)
          await downloadToFile(fixedUrl, singleFile)
          const v2 = await verifyProductScale(singleFile, anchor, `${job.id}-r2`)
          console.log(`📏 ${job.id} scale after auto-fix: ${v2} (shipping this cut)`)
        }
      }
    } catch (e) { console.warn(`scale-verify ${job.id}:`, e.message) }

    // PRODUCT-PART CHECK on the single clip too (same product-agnostic verifier as the segment path):
    // catch an invented/removed part on ANY product/format — a 15s clip can grow a wrong cap just like
    // a long-form segment. Up to 2 verified corrective rolls; then ship (never-fail). Physical only.
    if (!isService && meta.reroll_product_check !== false) {
      try {
        const prodRef = falProductImages[0] || productImages[0]
        const pd = meta.product_details || {}
        const prodDesc = [pd.name && pd.name !== 'the product' ? pd.name : '', pd.observed].filter(Boolean).join(' — ')
        const fixLine = `\n\nCRITICAL PRODUCT ACCURACY: render the product EXACTLY as the attached photo${prodDesc ? ` (it is: ${prodDesc})` : ''} — same container type, silhouette, closure and parts. The photo shows the COMPLETE product. Do NOT add, remove, invent or change ANY part (cap, lid, spout, nozzle, pump, straw, neck, box, wrapper). Keep the exact form factor shown.`
        for (let attempt = 0; attempt < 1 && prodRef; attempt++) {
          const verdict = await verifySegmentProduct(singleFile, prodRef, prodDesc, `${job.id}-p${attempt}`, 0)
          if (verdict !== 'mismatch') break
          await prog('Product looked off — auto-fixing…', 82, 100)
          const anchor2 = (meta.product_details && meta.product_details.size_anchor) ? ` The product's true size: ${meta.product_details.size_anchor}.` : ''
          let fixedUrl = null
          const rrImgs = attempt === 0 ? falProductImages : falProductImages.slice(0, 1)
          try { ({ videoUrl: fixedUrl } = await falGenerate({ ...genArgs, prompt: `${prompt}${fixLine}${attempt === 1 ? anchor2 : ''}`, imageUrls: rrImgs, videoUrl: null })) }
          catch (e) { if (blockedUgc(e)) { try { ({ videoUrl: fixedUrl } = await falGenerate({ ...genArgs, prompt: `${prompt}${fixLine}`, imageUrls: [], videoUrl: null })) } catch { /* keep current */ } } }
          if (!fixedUrl) break
          falCostUgc += clipCost(meta.tier, clipSecs, true)
          await downloadToFile(fixedUrl, singleFile)
          console.log(`🔬 ${job.id} product-part re-roll ${attempt + 1} applied`)
        }
      } catch (e) { console.warn(`part-verify ${job.id}:`, e.message) }
    }

    // Preview-accurate voice: the clip is silent (generateAudio:false) — lay the exact TTS voice the
    // user auditioned over it (ElevenLabs non-EN / OpenAI EN), so the render matches the preview.
    if (useOverlayVoice && (fitScript || script) && String(fitScript || script).trim()) {
      try {
        const vo = await ttsVoiceover(String(fitScript || script), `${job.id}-ov`, meta.voice, meta.language)
        singleTmp.push(vo)
        const voiced = join(tmpdir(), `sc-${job.id}-ov.mp4`); singleTmp.push(voiced)
        await muxVoiceover(singleFile, vo, voiced)
        singleFile = voiced
        console.log(`🎙 ${job.id} single-take voiced with overlay TTS (preview-accurate)`)
      } catch (e) { console.warn(`single-take overlay-voice mux failed for ${job.id} (shipping silent):`, e.message) }
    }

    const fin = await withEndCard(singleFile, meta, job.id, 'main', singleTmp)
    if (meta.end_card && meta.end_card.tx) {
      if (fin.applied) await rpc('commit_credits', { p_tx: meta.end_card.tx, p_metadata: { endcard: true } })
      else await rpc('refund_credits', { p_tx: meta.end_card.tx })
    }
    const ovFin = await burnOverlays(fin.file, meta.overlays, job.id); const url = await uploadVideo(ovFin, `creatives/${job.user_id}/${job.id}.mp4`)
    for (const f of singleTmp) await rm(f, { force: true }).catch(() => {})

    const falCost = clipCost(meta.tier, clipSecs, true) + falCostUgc
    await stamp({ status: 'done', media_type: 'video', image_url: url, clone_meta: { ...meta, seedance_prompt: prompt, script, fal_request_id: requestId, fal_cost_est: +falCost.toFixed(2) } })
    if (job.credit_tx) await rpc('commit_credits', { p_tx: job.credit_tx, p_metadata: { fal_request_id: requestId, actual_cost_usd: +falCost.toFixed(2) } })
    console.log(`🎬 cloned ${job.id} → ${url}`)
  } catch (e) {
    const msg = String(e?.message || e)
    // ── SELF-HEAL — the system fixes what an admin used to fix by hand. TRANSIENT failures (a fal
    // queue timeout, a network blip, a 5xx, an aborted download) leave the job in 'processing' with a
    // bumped auto_retries counter and RETURN: the pump re-picks it next tick and the render RESUMES
    // from the per-scene checkpoints — finished scenes cost nothing to reuse, so a retry re-renders
    // only what actually failed. Two automatic attempts; only then does it hard-fail + refund. Real
    // errors (content policy, bad input, insufficient credits) never retry — they fail honestly at once.
    const retryable = /timed out|still IN_PROGRESS|fetch failed|network|ECONNRESET|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|abort|socket|\b(500|502|503|504)\b|overload|unavailable|Premature close|terminated/i.test(msg)
      && !/content_policy|likeness|real people|insufficient|no product|not found/i.test(msg)
    const tries = Number(meta.auto_retries || 0)
    if (retryable && tries < 2) {
      console.warn(`🩺 ${job.id} transient failure (auto-retry ${tries + 1}/2) — resuming from checkpoints: ${msg.slice(0, 140)}`)
      // Backoff (2 min, then 5 min) so a longer provider outage doesn't burn both retries in seconds.
      await stamp({ clone_meta: { ...meta, auto_retries: tries + 1, retry_after: Date.now() + (tries === 0 ? 120_000 : 300_000), last_auto_retry: msg.slice(0, 180), progress: { label: 'Hit a busy patch — retrying automatically…', pct: 12, eta_sec: 240, at: Date.now() } } })
      return   // status stays 'processing' → the pump re-picks; scene checkpoints make the resume cheap
    }
    console.warn(`generate ${job.id} failed:`, msg)
    await stamp({ status: 'failed', clone_meta: { ...meta, error: msg } })
    if (job.credit_tx) await rpc('refund_credits', { p_tx: job.credit_tx })
    // Add-on reservations must never strand when the base render fails.
    for (const ex of (Array.isArray(meta.extra_langs) ? meta.extra_langs : [])) if (ex.tx) await rpc('refund_credits', { p_tx: ex.tx })
    if (meta.end_card && meta.end_card.tx) await rpc('refund_credits', { p_tx: meta.end_card.tx })
    if (meta.hook_variants_tx) await rpc('refund_credits', { p_tx: meta.hook_variants_tx })
    // ── ADMIN VISIBILITY — a final failure means the self-heal couldn't save it. Log it durably and
    // email the admin so systemic problems surface WITHOUT a user having to report them. Best-effort.
    try {
      await fetch(`${U}/rest/v1/activity_logs`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: job.user_id, action_type: 'VIDEO_RENDER_FAILED', entity_type: 'video_clone', description: `${meta.mode || 'video'} render failed after ${tries} auto-retries: ${msg.slice(0, 200)}`, performed_by: 'video-clone-worker' }) })
    } catch { /* best-effort */ }
    await logErr(job.user_id, `Video render failed after ${tries} retries — ${msg.slice(0, 200)}`, { kind: 'render_failed', stage: 'generate', mode: meta.mode || 'video', job: job.id })
    try {
      const { sendEmail, emailShell } = await import('./email.mjs')
      const to = process.env.ADMIN_ALERT_EMAIL || 'moeez@virginteez.com'
      await sendEmail({ to, subject: `⚠️ video render failed (${meta.mode || 'video'}) — ${job.id.slice(0, 8)}`, html: emailShell({ heading: 'Video render failed', bodyHtml: `<p>Job <b>${job.id}</b> failed after ${tries} automatic retries and was refunded.</p><p><b>Error:</b> ${msg.slice(0, 300)}</p><p>User: ${job.user_id}</p>` }) })
    } catch { /* best-effort */ }
  }
}

// ── Concurrent pump. The old loop was fully SERIAL: one 20-minute faithful render blocked every
// other user's ANALYSIS (user B couldn't even get a script drafted until user A's video finished).
// ── TWEAK: post-render, per-scene fixes without a full re-render. The user clicks a chip on ONE
// scene ("product looks wrong" / "wrong action" / …) or a whole-video op (trim / redo voiceover /
// remove scene). We regenerate ONLY what's asked (≤1 fal clip), then re-stitch from the cached
// scene_clips — everything else costs nothing. Failure is safe: the original video stays as-was
// (image_url untouched until the new cut uploads) and the tweak tx refunds. ──
const CHIP_FIX = {
  redo:    '',
  size:    ' CRITICAL FIX: the product is rendered at the WRONG SIZE. Show it at its TRUE real-world scale relative to the hand and face — a small handheld item stays small between the fingers. Get it readable by bringing the CAMERA closer, never by enlarging the product. An oversized, out-of-proportion product looks fake.',
  product: ' CRITICAL FIX: the product must EXACTLY match the attached reference — identical container, cap and label, sharp and readable — at its TRUE real-world size and proportion relative to the hand; never enlarged, stretched or out of proportion.',
  action:  ' CRITICAL FIX: the person must ACTIVELY and visibly USE/apply the product on camera — real continuous motion (applying, rolling, spraying, demonstrating), never merely holding it still.',
  person:  ' CRITICAL FIX: recast the on-camera person — natural, realistic, matching the reference creator description (gender, age range, hair, wardrobe); no uncanny or distorted features.',
  closeup: ' CRITICAL FIX: reframe as a TIGHT macro close-up — camera moved close, hands + product filling the frame at true real-world scale, label sharp and readable.',
}

async function tweakJob(job) {
  const meta = job.clone_meta || {}
  const t = meta.tweak || {}
  const isService = meta.product_type === 'service'   // service/app brand → no physical product path
  const stamp = (b) => patch(`creative_generations?id=eq.${job.id}`, b)
  const prog = (label, pct, etaSec) => stamp({ clone_meta: { ...meta, progress: { label, pct: Math.round(pct), eta_sec: Math.round(etaSec || 0), at: Date.now() } } }).catch(() => {})   // `at` = heartbeat, lets a watchdog spot stalls
  // Restore the row to its previous DONE state (original video intact) + refund the tweak tx.
  const bail = async (why) => {
    console.warn(`tweak ${job.id} failed: ${why}`)
    if (t.tx) await rpc('refund_credits', { p_tx: t.tx }).catch(() => {})
    const { tweak, progress, ...rest } = meta
    await stamp({ status: 'done', clone_meta: { ...rest, tweak_error: String(why).slice(0, 200) } })
    await logErr(job.user_id, `Video tweak failed — ${String(why).slice(0, 200)}`, { kind: 'render_failed', stage: 'tweak', job: job.id })
  }
  try {
    const base = join(tmpdir(), `tw-${job.id}`)
    const tmp = []
    let falCost = 0

    // Product refs for a scene redo (clean product first — always person-free/safe).
    // ONE ref only — same true-scale rule as the main render (extra refs inflate the product's size).
    const productImages = [meta.clean_product, ...(Array.isArray(meta.product_image_urls) ? meta.product_image_urls : [])].filter(Boolean).slice(0, 1)

    // ── UGC single-clip fix: re-roll the WHOLE clip with a chip-targeted corrective prompt and a
    // single product ref (fal moderation is a fresh dice-roll each time, so re-sending the image
    // usually locks the real product back in). Same never-fail ladder, then end-card/overlays. ──
    if (t.type === 'redo_ugc') {
      const fix = CHIP_FIX[t.chip] ?? ''
      await prog('Re-rolling your video…', 15, 150)
      console.log(`🔧 ${job.id} tweak: redo UGC clip (chip=${t.chip || 'redo'})`)
      // "Fix a moment" free-text note (same contract as redo_segment): respell the spoken script if
      // the note is about speech, and append the note to the prompt as the top-priority fix.
      const note = typeof t.note === 'string' ? t.note.trim().slice(0, 300) : ''
      let scriptForPrompt = meta.final_script || meta.script || null
      if (note && scriptForPrompt) scriptForPrompt = await applyFixNote(scriptForPrompt, note, meta.language)
      const { prompt } = await buildSeedancePrompt(meta.beat_sheet, meta.product_details || { name: 'the product' }, 1, scriptForPrompt, meta.character_look, meta.language, isService)
      const noteLine = note ? `\n\nUSER'S FIX (top priority — this is exactly what was wrong with the last take): ${note.replace(/"/g, "'")}` : ''
      const fullPrompt = `${prompt}${fix}${noteLine}`
      const rawFirst = (Array.isArray(meta.product_image_urls) ? meta.product_image_urls : []).slice(0, 1)
      const rungs = [
        { imageUrls: productImages, tag: 'clean product' },
        ...(rawFirst.length && rawFirst[0] !== productImages[0] ? [{ imageUrls: rawFirst, tag: 'original photo' }] : []),
        { imageUrls: [], tag: 'pure prompt' },
      ]
      const blocked = (e) => e.code === 'content_policy_images' || e.code === 'content_policy_video'
      let videoUrl = null
      for (let ri = 0; ri < rungs.length; ri++) {
        try {
          ({ videoUrl } = await falGenerate({ prompt: fullPrompt, imageUrls: rungs[ri].imageUrls, resolution: meta.resolution, duration: meta.duration || 15, aspect: meta.aspect, tier: meta.tier }))
          if (ri > 0) console.warn(`tweak ugc ${job.id}: landed on rung "${rungs[ri].tag}"`)
          break
        } catch (e) {
          if (!blocked(e) || ri === rungs.length - 1) throw e
          console.warn(`tweak ugc ${job.id}: "${rungs[ri].tag}" blocked — laddering down`)
        }
      }
      falCost += clipCost(meta.tier, meta.duration || 15, true)
      const f = `${base}-ugc.mp4`
      tmp.push(f)
      await downloadToFile(videoUrl, f)
      await prog('Finishing up…', 85, 20)
      const fin = await withEndCard(f, meta, job.id, 'tweak', tmp)
      const burned = await burnOverlays(fin.file, meta.overlays, job.id)
      tmp.push(burned)
      const ver = Math.random().toString(36).slice(2, 8)
      const url = await uploadVideo(burned, `creatives/${job.user_id}/${job.id}-t${ver}.mp4`)
      const { tweak, progress, ...rest } = meta
      await stamp({ status: 'done', image_url: url, clone_meta: { ...rest, last_tweak: { type: t.type, chip: t.chip ?? null } } })
      if (t.tx) await rpc('commit_credits', { p_tx: t.tx, p_metadata: { tweak: t.type, chip: t.chip ?? null, actual_cost_usd: +falCost.toFixed(2) } })
      for (const x of tmp) await rm(x, { force: true }).catch(() => {})
      console.log(`🔧 tweaked (redo_ugc) ${job.id} → ${url} ($${falCost.toFixed(2)})`)
      return
    }

    // ── CUTAWAY PATCH ("fix 2 seconds without paying for the clip"): Seedance can't render under 5s
    // and can't inpaint mid-clip, so a full segment re-roll (~12s at the audio rate) is the expensive
    // hammer. This is the scalpel: render ONE 5s SILENT product close-up (silent rate — the cheapest
    // thing we can buy) and splice it over ONLY the flawed seconds as a b-roll cutaway, keeping the
    // original video's audio track running underneath. UGC ads cut to product close-ups constantly,
    // so the patch reads as intentional editing. Works on ANY finished video (single-take, long-form,
    // faithful). ~$1.05 fal vs ~$3.60 for a segment re-roll. ──
    if (t.type === 'patch_broll') {
      if (!job.image_url) return bail('no finished video to patch')
      const srcV = `${base}-patch-src.mp4`; tmp.push(srcV)
      await downloadToFile(job.image_url, srcV)
      const vidDur = (await probeDuration(srcV)) || 15
      let from = Math.max(0, Math.min(Number(t.from) || 0, vidDur - 2))
      let len = Math.max(2, Math.min(5, (Number(t.to) || from + 4) - from))
      if (from + len > vidDur) len = Math.max(2, vidDur - from)
      await prog(`Patching ${from.toFixed(0)}s–${(from + len).toFixed(0)}s…`, 15, 90)
      console.log(`🩹 ${job.id} cutaway patch ${from.toFixed(1)}s+${len.toFixed(1)}s`)

      // RELIABLE FIX — composite the user's REAL product photo (Ken Burns) instead of GENERATING a
      // product close-up. Seedance reliably re-invents a spout/cap on this pouch (proven: 6/6 re-rolls
      // on job 105ab42a all added one), so any GENERATED insert risks the same error. The real image is
      // 100% accurate — and it's ffmpeg-only, so the patch costs ~nothing in fal.
      const prodUrl = (Array.isArray(meta.product_image_urls) && meta.product_image_urls[0]) || meta.clean_product
      if (!prodUrl) return bail('no product image to composite')
      const prodLocal = `${base}-prod.png`; tmp.push(prodLocal)
      await downloadToFile(prodUrl, prodLocal)
      const dims = await probeOut(['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=s=x:p=0', srcV])
      const [W, H] = String(dims || '').trim().split('x').map((n) => parseInt(n) || 0)
      const w = W || 720, h = H || 1280
      await prog('Building the product insert…', 45, 25)
      // 1) still: the real product centered over a soft blurred version of itself (on-brand ambient bg)
      const still = `${base}-still.png`; tmp.push(still)
      await ff(['-y', '-i', prodLocal, '-filter_complex',
        `[0:v]split=2[a][b];[a]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=18:2,eq=brightness=-0.05[bg];[b]scale=-1:${Math.round(h * 0.66)}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2[v]`,
        '-map', '[v]', '-frames:v', '1', still])
      // 2) Ken-Burns the still into a clip of the patch length (fallback to a static hold if zoompan errors)
      const broll = `${base}-card.mp4`; tmp.push(broll)
      try {
        await ff(['-y', '-loop', '1', '-i', still, '-vf', `zoompan=z='min(zoom+0.0006,1.10)':d=${Math.round(len * 24)}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${w}x${h}:fps=24,format=yuv420p`, '-t', String(len), '-r', '24', broll])
      } catch (e) {
        console.warn(`patch zoompan failed (${e.message}) — static hold`)
        await ff(['-y', '-loop', '1', '-t', String(len), '-i', still, '-vf', 'fps=24,format=yuv420p', '-r', '24', broll])
      }
      // 3) overlay the insert over ONLY [from, from+len]; original audio (0:a) is untouched
      await prog('Splicing the patch in…', 70, 20)
      const patched = `${base}-patched.mp4`; tmp.push(patched)
      await ff(['-y', '-i', srcV, '-i', broll,
        '-filter_complex',
        `[1:v]setpts=PTS-STARTPTS+${from.toFixed(2)}/TB[b];[0:v][b]overlay=eof_action=pass:enable='between(t,${from.toFixed(2)},${(from + len).toFixed(2)})'[v]`,
        '-map', '[v]', '-map', '0:a?', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', patched])

      const ver = Math.random().toString(36).slice(2, 8)
      const url = await uploadVideo(patched, `creatives/${job.user_id}/${job.id}-t${ver}.mp4`)
      const { tweak, progress, ...rest } = meta
      await stamp({ status: 'done', image_url: url, clone_meta: { ...rest, last_tweak: { type: t.type, from: +from.toFixed(1), len: +len.toFixed(1) } } })
      if (t.tx) await rpc('commit_credits', { p_tx: t.tx, p_metadata: { tweak: t.type, from: +from.toFixed(1), len: +len.toFixed(1), actual_cost_usd: +falCost.toFixed(2) } })
      for (const x of tmp) await rm(x, { force: true }).catch(() => {})
      console.log(`🩹 patched ${job.id} → ${url} ($${falCost.toFixed(2)})`)
      return
    }

    // ── LONG-FORM UGC segment re-roll: regenerate ONE segment of a 30/60s video and re-stitch from
    // the cached segment_clips — only the changed segment costs fal. The rest of the video is reused
    // byte-for-byte, then a single fresh TTS voiceover is laid over the whole thing (as in the main
    // long-form path). Continuity: the re-rolled segment reuses its original entry anchor, so its
    // START still matches the prior cut; its END may differ slightly from the next (reused) segment. ──
    // redo_segment re-rolls ONE cached segment (fal cost); redo_vo/trim on a long-form video just
    // re-stitch the cached segments + a fresh voiceover (no fal cost) — either way this segment path
    // owns any tweak on a multi-segment UGC render (the scene path below has no segment cache).
    const isSegVideo = Number(meta.segments || 1) > 1 && meta.mode !== 'faithful'
      && meta.segment_plan && Array.isArray(meta.segment_plan.segments) && meta.segment_plan.segments.length > 0
    if (isSegVideo && (t.type === 'redo_segment' || t.type === 'redo_vo' || t.type === 'trim')) {
      const plan = meta.segment_plan
      const useOverlayVoice = meta.tts_overlay === true   // native voice by default; overlay only if the render used it
      const segClips = { ...(meta.segment_clips || {}) }
      const segAnchors = { ...(meta.segment_anchors || {}) }
      const segs = plan.segments
      if (!Object.keys(segClips).length) return bail('no cached segments to tweak (older render)')
      const segDurs = segs.map((s) => Math.max(5, Math.min(15, Math.round(String(s.script || s.text || '').trim().split(/\s+/).filter(Boolean).length / 2.6) + 1)))

      // Re-roll one segment only for redo_segment; redo_vo/trim reuse every cached clip untouched.
      const si = Number(t.scene)
      if (t.type === 'redo_segment') {
        if (!(Number.isInteger(si) && si >= 0 && si < segs.length)) return bail('bad segment index')
        await prog(`Re-rolling section ${si + 1}…`, 15, 150)
        console.log(`🔧 ${job.id} tweak: redo segment ${si + 1}/${segs.length} (chip=${t.chip || 'redo'})`)
        const falProductImages = [meta.clean_product || (Array.isArray(meta.product_image_urls) ? meta.product_image_urls[0] : null), (Array.isArray(meta.product_image_urls) ? meta.product_image_urls[1] : null)].filter(Boolean).slice(0, 2)
        // Product-only by default (the face anchor reliably trips fal's likeness filter + gets charged);
        // continuity is held by the character description. meta.try_anchor=true restores the anchored attempt.
        const anchor = si > 0 && meta.try_anchor === true ? segAnchors[si - 1] : null
        const fix = CHIP_FIX[t.chip] ?? ''
        // "Fix a moment" free-text note: respell/edit the spoken line if the note is about speech
        // (pronunciation of "Ejad"/"ras malai"), and ALWAYS append it to the video prompt as the
        // top-priority instruction (covers visual notes like "remove the cap" too).
        const note = typeof t.note === 'string' ? t.note.trim().slice(0, 300) : ''
        const segForPrompt = note ? { ...segs[si], script: await applyFixNote(String(segs[si].script || ''), note, meta.language) } : segs[si]
        const noteLine = note ? `\n\nUSER'S FIX (top priority — this is exactly what was wrong with the last take): ${note.replace(/"/g, "'")}` : ''
        // CREATOR LOCK: describe the person from a KEPT neighbouring segment of the finished video so
        // the re-shoot keeps the SAME model (the "it changed the model looks" bug). Best-effort.
        let creatorLock = null
        try {
          const kept = si > 0 ? si - 1 : (segs.length > 1 ? si + 1 : -1)
          if (kept >= 0 && job.image_url) {
            const at = segDurs.slice(0, kept).reduce((a, d) => a + d, 0) + segDurs[kept] / 2
            creatorLock = await describeCreator(job.image_url, at, job.id)
          }
        } catch (e) { console.warn(`creator-lock ${job.id}:`, e.message) }
        const prompt = segmentPrompt(plan, segForPrompt, si, segs.length, !!anchor, falProductImages.length, meta.language, { sizeAnchor: meta.product_details && meta.product_details.size_anchor, creatorLock }) + fix + noteLine
        const imgs = anchor ? [anchor, ...falProductImages].slice(0, 9) : falProductImages
        const blocked = (e) => e.code === 'content_policy_images' || e.code === 'content_policy_video'
        // Ladder down on moderation blocks (anchor+products → products only → pure prompt), same as the
        // main long-form path, so one blocked ref never kills the tweak after we've spent fal money.
        const rungs = [imgs, ...(anchor ? [falProductImages] : []), []]
        let videoUrl = null
        for (let ri = 0; ri < rungs.length; ri++) {
          try { ({ videoUrl } = await falGenerate({ prompt, imageUrls: rungs[ri], resolution: meta.resolution, duration: segDurs[si], aspect: meta.aspect, tier: meta.tier, generateAudio: !useOverlayVoice })); break }
          catch (e) { if (!blocked(e) || ri === rungs.length - 1) throw e }
        }
        if (!videoUrl) return bail('segment re-roll blocked by moderation')
        falCost += clipCost(meta.tier, segDurs[si], !useOverlayVoice)
        segClips[si] = videoUrl
      } else {
        await prog(t.type === 'redo_vo' ? 'Re-recording the voiceover…' : 'Re-trimming…', 20, 40)
      }

      // Download every segment (new + cached) in order, re-concat, re-voiceover, finish.
      await prog('Re-stitching your video…', 55, 60)
      const files = []
      for (let i = 0; i < segs.length; i++) {
        const f = `${base}-${i}.mp4`; tmp.push(f)
        await downloadToFile(segClips[i], f); files.push(f)
      }
      const cat = `${base}-cat.mp4`; tmp.push(cat)
      await concatClips(files, cat, segDurs)
      let voiced = cat
      // Native mode keeps the clips' own Seedance voice. Overlay mode re-lays one continuous voice
      // (and is the only mode where "redo voiceover" means anything).
      const finalScript = t.type === 'redo_vo' ? (t.script || meta.final_script || meta.script || '') : (meta.final_script || meta.script || '')
      if (useOverlayVoice && finalScript && finalScript.trim()) {
        try {
          const clipDur = (await probeDuration(cat)) || segDurs.reduce((a, d) => a + d, 0) || 15
          const vo = await ttsVoiceover(capScriptToSeconds(finalScript, clipDur * 1.25 + 2), `${job.id}-segtw`, meta.voice, meta.language)
          tmp.push(vo)
          const mixed = `${base}-vo.mp4`; tmp.push(mixed)
          await muxVoiceover(cat, vo, mixed)
          voiced = mixed
        } catch (e) { console.warn(`seg-tweak tts/mux failed (shipping without VO):`, e.message) }
      }
      const fin = await withEndCard(voiced, meta, job.id, 'tweak', tmp)
      let ovFin = await burnOverlays(fin.file, meta.overlays, job.id)
      if (isService) ovFin = await burnAppDemo(ovFin, meta.beat_sheet && meta.beat_sheet.app_demo, meta.product_image_urls, job.id, meta.screencast_url)
      const ver = Math.random().toString(36).slice(2, 8)
      const url = await uploadVideo(ovFin, `creatives/${job.user_id}/${job.id}-t${ver}.mp4`)
      const { tweak, progress, ...rest } = meta
      await stamp({ status: 'done', image_url: url, clone_meta: { ...rest, segment_clips: segClips, segment_anchors: segAnchors, ...(t.type === 'redo_vo' && t.script ? { final_script: t.script } : {}), last_tweak: { type: t.type, segment: t.type === 'redo_segment' ? si : null, chip: t.chip ?? null } } })
      if (t.tx) await rpc('commit_credits', { p_tx: t.tx, p_metadata: { tweak: t.type, segment: t.type === 'redo_segment' ? si : null, chip: t.chip ?? null, actual_cost_usd: +falCost.toFixed(2) } })
      for (const x of tmp) await rm(x, { force: true }).catch(() => {})
      console.log(`🔧 tweaked (${t.type}, segment video) ${job.id} → ${url} ($${falCost.toFixed(2)})`)
      return
    }

    const scenes = Array.isArray(meta.scene_plan) ? [...meta.scene_plan] : []
    const clips = { ...(meta.scene_clips || {}) }
    if (!scenes.length || !Object.keys(clips).length) return bail('no cached scenes to tweak (older render)')

    // 1) Apply the requested change to the scene/clip lists.
    let keep = scenes.map((_, i) => i)
    if (t.type === 'remove_scene') {
      const i = Number(t.scene)
      if (!(i >= 0 && i < scenes.length)) return bail('bad scene index')
      if (scenes.length < 3) return bail('need at least 2 scenes to keep')
      keep = keep.filter((k) => k !== i)
      await prog('Removing the scene + restitching…', 20, 40)
    } else if (t.type === 'redo_scene') {
      const i = Number(t.scene)
      if (!(i >= 0 && i < scenes.length)) return bail('bad scene index')
      const fix = CHIP_FIX[t.chip] ?? ''
      // Free-text fix → gpt-4o rewrites the scene prompt into filmable action; chip (if any) still
      // appends its corrective clause. Persist the new prompt so a re-tweak / expired-clip regen uses it.
      const note = typeof t.note === 'string' ? t.note.trim().slice(0, 400) : ''
      const basePrompt = note ? await rewriteScenePrompt(scenes[i].prompt, note, meta.product_details?.name) : scenes[i].prompt
      let prompt = `${basePrompt}${fix}`
      // Keep the SAME cast + grade on a re-shoot: pass the character anchor(s) captured at render time
      // and the style lock, so fixing one scene doesn't swap the person or the look.
      const castAnchors = scenes[i].has_people !== false
        ? [...new Set((Array.isArray(scenes[i].cast) && scenes[i].cast.length ? scenes[i].cast : ['A']).map((c) => (meta.scene_char_anchors || {})[c]).filter(Boolean))].slice(0, 2)
        : []
      const tweakImgs = [...productImages, ...castAnchors].slice(0, 9)
      if (castAnchors.length) prompt += ` CHARACTER LOCK: [Image${productImages.length + 1}]${castAnchors.length > 1 ? ` and [Image${productImages.length + 2}]` : ''} show this ad's cast — the person${castAnchors.length > 1 ? 's' : ''} in this scene must be EXACTLY the same: same face, hair, outfit and styling.`
      prompt += STYLE_LOCK
      scenes[i] = { ...scenes[i], prompt: `${basePrompt}${fix}` }
      await prog(`Redoing scene ${i + 1}…`, 15, 90)
      console.log(`🔧 ${job.id} tweak: redo scene ${i + 1} (chip=${t.chip || 'redo'}${note ? ', +note' : ''}${castAnchors.length ? ', +anchor' : ''})`)
      // Mini-ladder: product+anchor refs → no refs (pure prompt). Same never-fail contract as the main render.
      let videoUrl = null
      try { ({ videoUrl } = await falGenerate({ prompt, imageUrls: tweakImgs, resolution: meta.resolution, duration: scenes[i].duration, aspect: meta.aspect, tier: meta.tier, generateAudio: false })) }
      catch (e) {
        if (e.code === 'content_policy_images' || e.code === 'content_policy_video') {
          console.warn(`tweak scene ${i + 1} refs blocked — pure prompt`)
          ;({ videoUrl } = await falGenerate({ prompt, imageUrls: [], resolution: meta.resolution, duration: scenes[i].duration, aspect: meta.aspect, tier: meta.tier, generateAudio: false }))
        } else throw e
      }
      falCost += clipCost(meta.tier, scenes[i].duration)
      clips[i] = videoUrl
    } else if (t.type === 'redo_vo' || t.type === 'trim') {
      await prog(t.type === 'redo_vo' ? 'Re-recording the voiceover…' : 'Re-trimming…', 20, 40)
    } else return bail(`unknown tweak type ${t.type}`)

    // 2) Materialize the kept clips (expired fal URL → regenerate that scene at OUR cost, no extra charge).
    const files = []
    const durs = []
    for (const i of keep) {
      let f = `${base}-${i}.mp4`
      try {
        await downloadToFile(clips[i], f)
      } catch {
        console.warn(`tweak ${job.id}: cached clip ${i + 1} expired — regenerating (our cost)`)
        await prog(`Refreshing scene ${i + 1}…`, 40, 60)
        const { videoUrl } = await falGenerate({ prompt: scenes[i].prompt, imageUrls: productImages, resolution: meta.resolution, duration: scenes[i].duration, aspect: meta.aspect, tier: meta.tier, generateAudio: false })
        falCost += clipCost(meta.tier, scenes[i].duration)
        clips[i] = videoUrl
        await downloadToFile(videoUrl, f)
      }
      tmp.push(f)
      f = await ensureAudio(f)
      if (!tmp.includes(f)) tmp.push(f)
      files.push(f)
      durs.push(scenes[i].duration)
    }

    // 3) Re-assemble: concat → VO → end-card → overlays → upload (versioned key so the old URL's CDN
    //    cache can't serve a stale cut).
    await prog('Stitching + voiceover…', 70, 45)
    const cat = `${base}-cat.mp4`
    tmp.push(cat)
    await concatClips(files, cat, durs)
    let cut = cat
    const voText = t.type === 'redo_vo' ? (t.script || meta.final_script || meta.script || '') : (meta.final_script || meta.script || '')
    if (voText && voText.trim()) {
      try {
        const clipDur = (await probeDuration(cat)) || durs.reduce((a, d) => a + (Number(d) || 5), 0)
        const vo = await ttsVoiceover(capScriptToSeconds(voText, clipDur * 1.25 + 2), `${job.id}-tweak`, meta.voice, meta.language)
        tmp.push(vo)
        const mixed = `${base}-vo.mp4`
        tmp.push(mixed)
        await muxVoiceover(cat, vo, mixed)
        cut = mixed
      } catch (e) { console.warn(`tweak tts/mux failed (shipping without VO):`, e.message) }
    }
    const carded = await withEndCard(cut, meta, job.id, 'tweak', tmp)
    const burned = await burnOverlays(carded.file, meta.overlays, job.id)
    tmp.push(burned)
    await prog('Uploading…', 92, 10)
    const ver = Math.random().toString(36).slice(2, 8)
    const url = await uploadVideo(burned, `creatives/${job.user_id}/${job.id}-t${ver}.mp4`)

    // 4) Persist: new cut is live; scene lists reflect a removal; tweak cleared.
    const newScenes = keep.map((i) => scenes[i])
    const newClips = {}
    keep.forEach((i, k) => { newClips[k] = clips[i] })
    const { tweak, progress, ...rest } = meta
    await stamp({ status: 'done', image_url: url, clone_meta: { ...rest, scene_plan: newScenes, scene_clips: newClips, scene_count: newScenes.length, ...(t.type === 'redo_vo' && t.script ? { final_script: t.script } : {}), last_tweak: { type: t.type, scene: t.scene ?? null, chip: t.chip ?? null } } })
    if (t.tx) await rpc('commit_credits', { p_tx: t.tx, p_metadata: { tweak: t.type, scene: t.scene ?? null, chip: t.chip ?? null, actual_cost_usd: +falCost.toFixed(2) } })
    for (const f of tmp) await rm(f, { force: true }).catch(() => {})
    console.log(`🔧 tweaked (${t.type}) ${job.id} → ${url} ($${falCost.toFixed(2)})`)
  } catch (e) {
    await bail(e?.message || e)
  }
}

// Now analyses (fast, cheap) and generations run as independent concurrent pools; the in-flight set
// prevents double-pickup across poll ticks (single container, so process-local state suffices —
// rows stay in their status while being worked, and checkpointing makes crash-restarts safe).
const MAX_ANALYZE = Number(process.env.CLONE_ANALYZE_CONCURRENCY || 3)
const MAX_GEN = Number(process.env.CLONE_GEN_CONCURRENCY || 2)
const inflight = new Set()
let anActive = 0
let genActive = 0

async function pump() {
  // image_url is REQUIRED by the tweak branch — patch_broll downloads the finished video from it; without
  // it, job.image_url was undefined and every patch bailed "no finished video to patch".
  const sel = 'select=id,user_id,tier,source_video_url,image_url,clone_meta,credit_tx&type=eq.video_clone&order=created_at.asc&limit=6'
  if (anActive < MAX_ANALYZE) {
    const analyzing = await getJSON(`creative_generations?${sel}&status=eq.analyzing`).catch(() => [])
    for (const j of analyzing || []) {
      if (inflight.has(j.id) || anActive >= MAX_ANALYZE) continue
      inflight.add(j.id); anActive++
      analyzeJob(j).catch((e) => console.warn('analyze crash:', e?.message)).finally(() => { inflight.delete(j.id); anActive-- })
    }
  }
  if (genActive < MAX_GEN) {
    const generating = await getJSON(`creative_generations?${sel}&status=eq.processing&image_url=is.null`).catch(() => [])
    for (const j of generating || []) {
      if (inflight.has(j.id) || genActive >= MAX_GEN) continue
      // Self-heal backoff: a job that just auto-retried waits out its retry_after before re-pickup.
      if (j?.clone_meta?.retry_after && Date.now() < Number(j.clone_meta.retry_after)) continue
      inflight.add(j.id); genActive++
      generateJob(j).catch((e) => console.warn('generate crash:', e?.message)).finally(() => { inflight.delete(j.id); genActive-- })
    }
  }
  // Tweak jobs — processing rows that STILL HAVE a video (image_url set) + clone_meta.tweak. They're
  // excluded from the fresh-render branch by its image_url=is.null filter, so no double-handling.
  if (genActive < MAX_GEN) {
    const tweaks = await getJSON(`creative_generations?${sel}&status=eq.processing&image_url=not.is.null`).catch(() => [])
    for (const j of tweaks || []) {
      if (!j?.clone_meta?.tweak) continue
      if (inflight.has(j.id) || genActive >= MAX_GEN) continue
      inflight.add(j.id); genActive++
      tweakJob(j).catch((e) => console.warn('tweak crash:', e?.message)).finally(() => { inflight.delete(j.id); genActive-- })
    }
  }
  // Caption jobs (cheap: Whisper + ffmpeg burn) — their own type, share the gen concurrency budget.
  if (genActive < MAX_GEN) {
    const capSel = 'select=id,user_id,tier,source_video_url,clone_meta,credit_tx&type=eq.video_captions&status=eq.processing&image_url=is.null&order=created_at.asc&limit=4'
    const captioning = await getJSON(`creative_generations?${capSel}`).catch(() => [])
    for (const j of captioning || []) {
      if (inflight.has(j.id) || genActive >= MAX_GEN) continue
      inflight.add(j.id); genActive++
      captionJob(j).catch((e) => console.warn('caption crash:', e?.message)).finally(() => { inflight.delete(j.id); genActive-- })
    }
  }
}

console.log(`🎬 video-clone-worker up — analyse→review (approval gate)→generate · concurrency A${MAX_ANALYZE}/G${MAX_GEN}`)
for (;;) { try { await pump() } catch (e) { console.warn('tick error:', e?.message || e) } await sleep(EVERY) }
