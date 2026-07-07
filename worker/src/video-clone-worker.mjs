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

// ── Gemini: watch the competitor video → structured beat sheet ────────────────
const BEAT_SCHEMA_PROMPT = `You are a UGC ad director. Watch this video ad and return ONLY minified JSON (no prose, no code fence):
{"setting":"","avatar":"","camera":"","hook_type":"","beats":[{"t":"0-2s","action":""}],"product_role":"","transcript":"","tone":"","duration_seconds":0}
- setting: physical scene. avatar: who's on camera (age, look, wardrobe) or "none". camera: framing + movement.
- hook_type: first-3-seconds pattern. beats: 3-8 time-ranged actions. transcript: exact spoken words. Be concrete.`

async function analyzeVideo(videoUrl) {
  if (!GEMINI_KEY) return null
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

// ── gpt-4o: beat sheet + product → Seedance prompt + script. When forcedScript is given (the user's
// APPROVED/edited voiceover) the prompt is built around EXACTLY that script. ──
async function buildSeedancePrompt(beat, product, nImages, forcedScript) {
  const refList = Array.from({ length: nImages }, (_, i) => `@Image${i + 1}`).join(', ')
  const sys = `You write prompts for ByteDance Seedance 2.0 (reference-to-video). This is a TALKING-HEAD UGC ad:
a real-looking creator talks straight to the phone camera and delivers the script out loud. Rules:
- ONE dense paragraph: subject (the on-camera creator) → they SPEAK to camera → action/product → camera → lighting → mood, then a short beat-by-beat timeline.
- The creator must be SPEAKING ALOUD to the viewer, lips moving in sync — NOT a silent scene, NOT b-roll with background music. Describe their mouth moving, natural gestures, eye contact with the lens.
- Reference the user's product images by their tokens (${refList || 'none'}) — the creator holds/shows the product as they talk.
- Keep the SAME structure/pacing/hook as the reference ad, swap in the user's product.
- UGC realism: iPhone selfie, arm's length, natural light, authentic handheld, no on-screen captions/subtitles.
${forcedScript ? '- CRITICAL — the creator says these EXACT words aloud to camera, lip-synced, word for word: "' + forcedScript.replace(/"/g, "'") + '". Weave "she says to camera: …" into the prompt so the model generates spoken dialogue, not narration.' : '- The creator speaks a natural spoken line to camera; put the exact words in the script field.'}
Return ONLY minified JSON: {"prompt":"","script":""}  (script = the exact words the creator speaks).`
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
  return { prompt: String(out.prompt), script: String(out.script || forcedScript || '') }
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
async function trimReference(url, id) {
  const base = join(tmpdir(), `ref-${id}`)
  const inFile = `${base}.in.mp4`, outFile = `${base}.out.mp4`
  try {
    const r = await fetch(url)
    if (!r.ok) throw new Error(`fetch ref ${r.status}`)
    await writeFile(inFile, Buffer.from(await r.arrayBuffer()))
    // first 14s; cap longer side at 1280 (shorter → ≤720); yuv420p h264 for compatibility.
    await ff(['-y', '-i', inFile, '-t', '14',
      '-vf', "scale='if(gt(iw,ih),1280,-2)':'if(gt(iw,ih),-2,1280)'",
      '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', outFile])
    const mp4 = await readFile(outFile)
    const key = `creatives/tmp/${id}-ref.mp4`
    await r2.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key, Body: mp4, ContentType: 'video/mp4', CacheControl: 'public, max-age=86400' }))
    return `${R2_PUBLIC}/${key}`
  } finally {
    await rm(inFile, { force: true }).catch(() => {})
    await rm(outFile, { force: true }).catch(() => {})
  }
}

// ── fal Seedance 2.0 reference-to-video (queue REST) ──────────────────────────
async function falGenerate({ prompt, imageUrls, videoUrl, resolution, duration, aspect, tier }) {
  const model = tier === 'fast' ? 'bytedance/seedance-2.0/fast/reference-to-video' : 'bytedance/seedance-2.0/reference-to-video'
  const input = { prompt, image_urls: (imageUrls || []).slice(0, 9), resolution: resolution || '720p', aspect_ratio: aspect || '9:16', generate_audio: true }
  if (videoUrl) input.video_urls = [videoUrl]
  if (duration) input.duration = String(duration)
  const sub = await fetch(`https://queue.fal.run/${model}`, { method: 'POST', headers: { Authorization: `Key ${FAL_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
  if (!sub.ok) throw new Error(`fal submit ${sub.status} ${(await sub.text()).slice(0, 200)}`)
  const { request_id, status_url, response_url } = await sub.json()
  const statusUrl = status_url || `https://queue.fal.run/${model}/requests/${request_id}/status`
  const resultUrl = response_url || `https://queue.fal.run/${model}/requests/${request_id}`
  for (let i = 0; i < 120; i++) {
    await sleep(6000)
    const sr = await fetch(statusUrl, { headers: { Authorization: `Key ${FAL_KEY}` } })
    if (!sr.ok) continue
    const st = await sr.json()
    if (st.status === 'COMPLETED') break
    if (st.status === 'FAILED' || st.status === 'ERROR') throw new Error(`fal job ${st.status}`)
  }
  const rr = await fetch(resultUrl, { headers: { Authorization: `Key ${FAL_KEY}` } })
  if (!rr.ok) throw new Error(`fal result ${rr.status}: ${(await rr.text()).slice(0, 220)}`)
  const data = await rr.json()
  const url = data?.video?.url || data?.data?.video?.url
  if (!url) throw new Error('fal returned no video url')
  return { videoUrl: url, requestId: request_id }
}

// ── PHASE A: analyse the competitor video + draft a script → status='review' (awaits approval) ──
async function analyzeJob(job) {
  const meta = job.clone_meta || {}
  const stamp = (b) => patch(`creative_generations?id=eq.${job.id}`, b)
  try {
    let beat = null
    if (job.source_video_url) { try { beat = await analyzeVideo(job.source_video_url) } catch (e) { console.warn('analyze:', e.message) } }
    const productImages = Array.isArray(meta.product_image_urls) ? meta.product_image_urls : []
    const { prompt, script } = await buildSeedancePrompt(beat, meta.product_details || { name: 'the product' }, productImages.length)
    await stamp({ status: 'review', clone_meta: { ...meta, beat_sheet: beat, seedance_prompt: prompt, script } })
    console.log(`📝 drafted ${job.id} → awaiting approval`)
  } catch (e) {
    console.warn(`analyze ${job.id} failed:`, e.message)
    await stamp({ status: 'failed', clone_meta: { ...meta, error: e.message } })
  }
}

// ── PHASE B: user approved → generate the video with the APPROVED script → status='done' ──
async function generateJob(job) {
  const meta = job.clone_meta || {}
  const productImages = Array.isArray(meta.product_image_urls) ? meta.product_image_urls : []
  const stamp = (b) => patch(`creative_generations?id=eq.${job.id}`, b)
  try {
    // Rebuild the prompt around the approved (possibly edited) script so the voiceover matches exactly.
    const finalScript = meta.final_script || meta.script || ''
    const { prompt, script } = await buildSeedancePrompt(meta.beat_sheet, meta.product_details || { name: 'the product' }, productImages.length, finalScript)

    // Trim the competitor clip to fal's ≤15s / ≤720p reference limits (raw ad videos exceed them).
    let refVideo = null
    if (job.source_video_url) { try { refVideo = await trimReference(job.source_video_url, job.id) } catch (e) { console.warn('trim ref:', e.message) } }

    // Try WITH the video as a motion reference. fal blocks reference videos that contain real people
    // (likeness policy) — which is nearly every UGC ad — so on a content_policy_violation we retry
    // WITHOUT the video: Gemini's beat sheet already grounds the prompt in the ad's structure/hook,
    // and Seedance generates a fresh (non-real) creator. Product-only/no-people videos keep the motion ref.
    const genArgs = { prompt, imageUrls: productImages, resolution: meta.resolution, duration: meta.duration, aspect: meta.aspect, tier: meta.tier }
    let videoUrl, requestId
    try {
      ({ videoUrl, requestId } = await falGenerate({ ...genArgs, videoUrl: refVideo }))
    } catch (e) {
      if (refVideo && /content_policy_violation|likeness|real people/i.test(e.message)) {
        console.warn(`ref video blocked (likeness) for ${job.id} — retrying prompt-only`)
        ;({ videoUrl, requestId } = await falGenerate({ ...genArgs, videoUrl: null }))
      } else throw e
    }

    const dl = await fetch(videoUrl)
    if (!dl.ok) throw new Error(`download result ${dl.status}`)
    const mp4 = Buffer.from(await dl.arrayBuffer())
    const key = `creatives/${job.user_id}/${job.id}.mp4`
    await r2.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key, Body: mp4, ContentType: 'video/mp4', CacheControl: 'public, max-age=31536000, immutable' }))
    const url = `${R2_PUBLIC}/${key}`

    await stamp({ status: 'done', media_type: 'video', image_url: url, clone_meta: { ...meta, seedance_prompt: prompt, script, fal_request_id: requestId } })
    if (job.credit_tx) await rpc('commit_credits', { p_tx: job.credit_tx, p_metadata: { fal_request_id: requestId } })
    console.log(`🎬 cloned ${job.id} → ${url}`)
  } catch (e) {
    console.warn(`generate ${job.id} failed:`, e.message)
    await stamp({ status: 'failed', clone_meta: { ...meta, error: e.message } })
    if (job.credit_tx) await rpc('refund_credits', { p_tx: job.credit_tx })
  }
}

async function tick() {
  const sel = 'select=id,user_id,tier,source_video_url,clone_meta,credit_tx&type=eq.video_clone&order=created_at.asc&limit=2'
  const analyzing = await getJSON(`creative_generations?${sel}&status=eq.analyzing`).catch(() => [])
  for (const j of analyzing || []) await analyzeJob(j)
  const generating = await getJSON(`creative_generations?${sel}&status=eq.processing&image_url=is.null`).catch(() => [])
  for (const j of generating || []) await generateJob(j)
}

console.log('🎬 video-clone-worker up — analyse→review (approval gate)→generate')
for (;;) { try { await tick() } catch (e) { console.warn('tick error:', e?.message || e) } await sleep(EVERY) }
