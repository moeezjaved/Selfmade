/**
 * video-clone-worker — turns a COMPETITOR video ad into the user's OWN product ad.
 *
 * Pipeline per job (creative_generations, type='video_clone', status='processing', image_url IS NULL):
 *   1. ANALYSE  — Gemini watches the competitor video (source_video_url) → structured beat sheet +
 *                 transcript (setting, avatar, camera, per-beat timing, spoken script, hook type).
 *   2. PROMPT   — gpt-4o takes the beat sheet + the user's product (clone_meta.product_image_urls +
 *                 product_details) → a Seedance-formatted prompt (@Image1 refs) + adapted script.
 *   3. GENERATE — fal.ai Seedance 2.0 reference-to-video: prompt + product image_urls + the competitor
 *                 video as the motion/pacing reference → polls the fal queue → result MP4 url.
 *   4. DELIVER  — download the MP4 → R2 → mark the row done → commit the reserved credits.
 * Any failure → row 'failed' + refund.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY, OPENAI_API_KEY, FAL_KEY,
 *      R2_* (ACCOUNT_ID/ACCESS_KEY_ID/SECRET_ACCESS_KEY/BUCKET_NAME/PUBLIC_URL).
 * Runs on the droplet next to animate-worker. No ffmpeg needed (generation is remote).
 */
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

const U = (process.env.SUPABASE_URL || '').split('\n')[0].replace(/\/$/, '')
const K = process.env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: 'Bearer ' + K, 'Content-Type': 'application/json' }
const GEMINI_KEY = process.env.GEMINI_API_KEY
const GEMINI_MODEL = process.env.GEMINI_VIDEO_ANALYZE_MODEL || 'gemini-2.5-flash'
const OPENAI_KEY = process.env.OPENAI_API_KEY
const OPENAI_MODEL = process.env.CLONE_PROMPT_MODEL || 'gpt-4o'
const FAL_KEY = process.env.FAL_KEY
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

// ── 1. Gemini: watch the competitor video → structured beat sheet ─────────────
const BEAT_SCHEMA_PROMPT = `You are a UGC ad director. Watch this video ad and return ONLY minified JSON (no prose, no code fence) with this exact shape:
{"setting":"","avatar":"","camera":"","hook_type":"","beats":[{"t":"0-2s","action":""}],"product_role":"","transcript":"","tone":"","duration_seconds":0}
- setting: the physical location/scene. avatar: who's on camera (age, look, wardrobe) or "none".
- camera: framing + movement (e.g. handheld arm's-length selfie, single continuous shot).
- hook_type: the first-3-seconds pattern (unboxing, problem-solution, testimonial, POV, demo…).
- beats: 3-8 entries, each a time range + what happens. transcript: the exact spoken words.
- product_role: how the product appears/is used. tone: the mood. Be concrete and specific.`

async function analyzeVideo(videoUrl) {
  // Fetch the competitor MP4 and inline it (base64) to Gemini. Ad videos are short (<~20MB); if a
  // fetch/analyze fails we return null and fall back to a generic prompt so the clone still runs.
  const vr = await fetch(videoUrl)
  if (!vr.ok) throw new Error(`fetch source video ${vr.status}`)
  const buf = Buffer.from(await vr.arrayBuffer())
  if (buf.length > 19 * 1024 * 1024) { console.warn('video >19MB, skipping Gemini analysis'); return null }
  const body = {
    contents: [{ parts: [
      { inline_data: { mime_type: vr.headers.get('content-type') || 'video/mp4', data: buf.toString('base64') } },
      { text: BEAT_SCHEMA_PROMPT },
    ] }],
    generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
  }
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!r.ok) { console.warn('gemini analyze', r.status, (await r.text()).slice(0, 160)); return null }
  const j = await r.json()
  const text = j?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || ''
  try { return JSON.parse(text) } catch { console.warn('gemini non-JSON beat sheet'); return null }
}

// ── 2. gpt-4o: beat sheet + product → Seedance prompt + adapted script ────────
async function buildSeedancePrompt(beat, product, nImages) {
  const refList = Array.from({ length: nImages }, (_, i) => `@Image${i + 1}`).join(', ')
  const sys = `You write prompts for ByteDance Seedance 2.0 (reference-to-video). Rules:
- Seedance wants ONE dense paragraph: subject → action → camera → lighting → mood, then a short beat-by-beat timeline.
- Reference the user's product images by their tokens (${refList || 'none provided'}) exactly where the product appears.
- Keep the SAME structure/pacing/vibe/hook as the reference ad, but swap in the user's product and rewrite the spoken script to sell IT.
- UGC realism: iPhone quality, natural light, authentic handheld feel, no on-screen captions/subtitles.
Return ONLY minified JSON: {"prompt":"","script":""}  — prompt = the Seedance generation prompt; script = the exact voiceover to be spoken.`
  const usr = `REFERENCE AD (beat sheet):\n${JSON.stringify(beat || { note: 'analysis unavailable — infer a natural UGC structure' })}\n\nUSER PRODUCT:\n${JSON.stringify(product)}\n\nProduct image tokens available: ${refList || '(none)'}.\nWrite the Seedance prompt + a fresh script selling the user's product in the same style.`
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: OPENAI_MODEL, temperature: 0.7, response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: sys }, { role: 'user', content: usr }] }),
  })
  if (!r.ok) throw new Error(`openai ${r.status} ${(await r.text()).slice(0, 160)}`)
  const j = await r.json()
  const out = JSON.parse(j.choices?.[0]?.message?.content || '{}')
  if (!out.prompt) throw new Error('no prompt from gpt')
  return { prompt: String(out.prompt), script: String(out.script || '') }
}

// ── 3. fal Seedance 2.0 reference-to-video (queue REST) ───────────────────────
async function falGenerate({ prompt, imageUrls, videoUrl, resolution, duration, aspect, tier }) {
  const model = tier === 'fast' ? 'bytedance/seedance-2.0/fast/reference-to-video' : 'bytedance/seedance-2.0/reference-to-video'
  const input = {
    prompt,
    image_urls: (imageUrls || []).slice(0, 9),
    resolution: resolution || '720p',
    aspect_ratio: aspect || '9:16',
    generate_audio: true,
  }
  if (videoUrl) input.video_urls = [videoUrl]
  if (duration) input.duration = String(duration)
  // submit
  const sub = await fetch(`https://queue.fal.run/${model}`, {
    method: 'POST', headers: { Authorization: `Key ${FAL_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  })
  if (!sub.ok) throw new Error(`fal submit ${sub.status} ${(await sub.text()).slice(0, 200)}`)
  const { request_id, status_url, response_url } = await sub.json()
  const statusUrl = status_url || `https://queue.fal.run/${model}/requests/${request_id}/status`
  const resultUrl = response_url || `https://queue.fal.run/${model}/requests/${request_id}`
  // poll (Seedance can take a few minutes; cap ~12 min)
  for (let i = 0; i < 120; i++) {
    await sleep(6000)
    const sr = await fetch(statusUrl, { headers: { Authorization: `Key ${FAL_KEY}` } })
    if (!sr.ok) continue
    const st = await sr.json()
    if (st.status === 'COMPLETED') break
    if (st.status === 'FAILED' || st.status === 'ERROR') throw new Error(`fal job ${st.status}`)
  }
  const rr = await fetch(resultUrl, { headers: { Authorization: `Key ${FAL_KEY}` } })
  if (!rr.ok) throw new Error(`fal result ${rr.status}`)
  const data = await rr.json()
  const url = data?.video?.url || data?.data?.video?.url
  if (!url) throw new Error('fal returned no video url')
  return { videoUrl: url, requestId: request_id }
}

async function processJob(job) {
  const meta = job.clone_meta || {}
  const productImages = Array.isArray(meta.product_image_urls) ? meta.product_image_urls : []
  const stamp = (patchBody) => patch(`creative_generations?id=eq.${job.id}`, patchBody)
  try {
    // 1. analyse (best-effort — a null beat sheet still produces a decent generic UGC prompt)
    let beat = null
    if (job.source_video_url) { try { beat = await analyzeVideo(job.source_video_url) } catch (e) { console.warn('analyze:', e.message) } }

    // 2. prompt + script
    const { prompt, script } = await buildSeedancePrompt(beat, meta.product_details || { name: 'the product' }, productImages.length)

    // 3. generate
    const { videoUrl, requestId } = await falGenerate({
      prompt, imageUrls: productImages, videoUrl: job.source_video_url,
      resolution: meta.resolution, duration: meta.duration, aspect: meta.aspect, tier: meta.tier,
    })

    // 4. deliver → R2
    const dl = await fetch(videoUrl)
    if (!dl.ok) throw new Error(`download result ${dl.status}`)
    const mp4 = Buffer.from(await dl.arrayBuffer())
    const key = `creatives/${job.user_id}/${job.id}.mp4`
    await r2.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key, Body: mp4, ContentType: 'video/mp4', CacheControl: 'public, max-age=31536000, immutable' }))
    const url = `${R2_PUBLIC}/${key}`

    await stamp({ status: 'done', media_type: 'video', image_url: url,
      clone_meta: { ...meta, beat_sheet: beat, seedance_prompt: prompt, script, fal_request_id: requestId } })
    if (job.credit_tx) await rpc('commit_credits', { p_tx: job.credit_tx, p_metadata: { fal_request_id: requestId } })
    console.log(`🎬 cloned ${job.id} → ${url}`)
  } catch (e) {
    console.warn(`clone ${job.id} failed:`, e.message)
    await stamp({ status: 'failed', clone_meta: { ...meta, error: e.message } })
    if (job.credit_tx) await rpc('refund_credits', { p_tx: job.credit_tx })
  }
}

async function tick() {
  const jobs = await getJSON(`creative_generations?select=id,user_id,tier,source_video_url,clone_meta,credit_tx&type=eq.video_clone&status=eq.processing&image_url=is.null&order=created_at.asc&limit=2`).catch(() => [])
  for (const j of jobs || []) await processJob(j)
}

console.log('🎬 video-clone-worker up — Gemini analyse → gpt prompt → Seedance generate → R2')
for (;;) { try { await tick() } catch (e) { console.warn('tick error:', e?.message || e) } await sleep(EVERY) }
