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
{"setting":"","avatar":"","camera":"","hook_type":"","beats":[{"t":"0-2s","action":""}],"product_role":"","transcript":"","tone":"","duration_seconds":0,"is_talking_head":true}
- setting: physical scene. avatar: who's on camera (age, look, wardrobe) or "none". camera: framing + movement.
- hook_type: first-3-seconds pattern. beats: 3-8 time-ranged actions. transcript: exact spoken words. Be concrete.
- is_talking_head: true ONLY if a person ON CAMERA speaks the main audio to the viewer (lips visibly delivering it). A narrator VOICEOVER over b-roll/lifestyle/montage footage = false. Multiple scene cuts with no consistent on-camera speaker = false.`

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

// ── Creator-look override: the user can recast the on-camera creator(s) to a chosen ethnicity/look
// (Pakistani / Indian / Arab / …) while keeping everything else from the reference. 'match' (or empty)
// = today's behavior: copy the reference creator exactly. ──
function lookClause(beat, look) {
  if (look && look !== 'match') {
    return `RECAST the on-camera creator(s) as ${look} in appearance — this is the user's explicit choice. Keep the reference creator's age range, wardrobe style, hair style vibe and energy (avatar field: ${(beat && beat.avatar) || 'as analysed'}), but the person's ethnicity/look must clearly read as ${look}`
  }
  return `the EXACT creator(s) copying their age/ETHNICITY/hair/wardrobe from the avatar field (${(beat && beat.avatar) || 'as analysed'})`
}

// ── gpt-4o: beat sheet + product → Seedance prompt + script. When forcedScript is given (the user's
// APPROVED/edited voiceover) the prompt is built around EXACTLY that script. ──
async function buildSeedancePrompt(beat, product, nImages, forcedScript, look, lang) {
  const refList = Array.from({ length: nImages }, (_, i) => `@Image${i + 1}`).join(', ')
  const recast = look && look !== 'match'
  const L = langName(lang)
  const nonEn = lang && lang !== 'en'
  const sys = `You write prompts for ByteDance Seedance 2.0 (reference-to-video). This is a TALKING-HEAD UGC ad:
a real-looking creator talks straight to the phone camera and delivers the script out loud. Rules:
- ONE dense paragraph: subject (the on-camera creator) → they SPEAK to camera → action/product → camera → lighting → mood, then a short beat-by-beat timeline.
- The creator must be SPEAKING ALOUD to the viewer, lips moving in sync — NOT a silent scene, NOT b-roll with background music. Describe their mouth moving, natural gestures, eye contact with the lens.
- PRODUCT IS THE HERO — the creator physically HOLDS the user's product (${refList || 'the product'}) in their hand for MOST of the clip: brings it up to the lens, turns it, and actively USES/demonstrates it across several beats (e.g. takes a puff / applies it / shows how it works), then a close-up of it in-hand. Do NOT show a single static product shot — it must be handled and in-use throughout, and match ${refList || 'the product'} exactly.
- REPLICATE THE REFERENCE FAITHFULLY — this is a CLONE, not a reinvention. Use the beat sheet's EXACT setting (${(beat && beat.setting) || 'as analysed'}), ${lookClause(beat, look)}, the same camera work, and the same beat timing. The ONLY things you change: swap in the user's product${recast ? ', recast the creator as instructed' : ''} and adapt the spoken words to it. Do NOT change the location${recast ? '' : ', do NOT change the people\'s ethnicity or look'}, do NOT move them to a generic sofa/studio.
- UGC realism: iPhone selfie, arm's length, natural light, authentic handheld, no on-screen captions/subtitles.
- LANGUAGE: the creator speaks ${L}. ${nonEn ? `TRANSCREATE, never translate — write the script NATIVELY the way a real local creator talks in an ad (local idioms, local rhythm). Use the language's own script/alphabet.` : `NEVER the reference ad's language if it differs — the clone speaks English.`} Replicate the scene and the people; only the words are ${nonEn ? 'in the chosen language' : 'English'}.
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
  const beats = Array.isArray(beat && beat.beats) ? beat.beats.length : 4
  return Math.min(4, Math.max(2, Math.ceil(beats / 2)))
}

// ── gpt-4o: beat sheet → per-scene Seedance prompts for FAITHFUL mode. Each reference scene becomes
// its own clip prompt (b-roll / lifestyle / product shots allowed — NO forced talking head); clips are
// stitched afterwards, mirroring the source's edit structure. ──
async function buildScenePlan(beat, product, nImages, nScenes, look, voiceover) {
  const refList = Array.from({ length: nImages }, (_, i) => `@Image${i + 1}`).join(', ')
  const recast = look && look !== 'match'
  const sys = `You write prompts for ByteDance Seedance 2.0 (reference-to-video). The reference ad is a MULTI-SCENE / B-roll style ad. Clone it FAITHFULLY, scene by scene — this is a CLONE of its edit structure, not a talking-head rewrite.
Rules:
- Map the beat sheet's beats (in the "beats" array) onto EXACTLY ${nScenes} scenes, IN ORDER, covering the ad's full arc (hook first). Each scene must RECREATE a specific reference beat — its subject, its action, its shot type — not invent a new one. If there are more beats than scenes, group adjacent beats; if fewer, expand the strongest beats. Each scene = one continuous shot.
- Per scene, write ONE dense Seedance prompt that reproduces THAT reference beat: subject → the exact action from the beat → camera (copy the reference's framing/movement) → lighting → mood. Stay faithful to what the reference actually shows in that beat (e.g. a couple close-up stays a couple close-up; a gym shot stays a gym shot). Cinematic b-roll, lifestyle moments and product close-ups are all allowed — do NOT force anyone to talk to camera, and do NOT drift to a generic studio.
- PRODUCT SWAP — wherever the reference features its product, feature the user's product (${refList || 'the product'}) instead, matching ${refList || 'the product'} exactly. The product must appear (held / in use / close-up) in at least half of the scenes.
- PEOPLE — when a scene has people, ${recast ? `recast them as ${look} in appearance (user's explicit choice), keeping the reference's age range, wardrobe style and energy` : 'copy the reference people (age/ethnicity/wardrobe/energy) from the beat sheet'}.
${voiceover ? `- NARRATION IS ADDED IN POST — scenes must contain NO on-camera speech (ambience/music energy only). Design the visuals to fit this voiceover's arc, in order: "${String(voiceover).replace(/"/g, "'")}". Put the chunk each scene covers in its "script" field for reference only — do NOT write spoken dialogue into the prompt.` : '- No dialogue — scenes are music/ambience-driven b-roll. Leave "script" empty.'}
- Per scene pick "duration": 5 for a quick cut, 10 for a longer beat (numbers only).
Return ONLY minified JSON: {"scenes":[{"prompt":"","script":"","duration":5}]}  (exactly ${nScenes} scenes, in order).`
  const usr = `REFERENCE AD (beat sheet):\n${JSON.stringify(beat || { note: 'analysis unavailable — infer a natural multi-scene structure' })}\n\nUSER PRODUCT:\n${JSON.stringify(product)}\n\nProduct image tokens: ${refList || '(none)'}.`
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: OPENAI_MODEL, temperature: 0.7, response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: sys }, { role: 'user', content: usr }] }),
  })
  if (!r.ok) throw new Error(`openai scenes ${r.status} ${(await r.text()).slice(0, 160)}`)
  const j = await r.json()
  const out = JSON.parse(j.choices?.[0]?.message?.content || '{}')
  const scenes = Array.isArray(out.scenes) ? out.scenes.filter((s) => s && s.prompt) : []
  if (!scenes.length) throw new Error('no scenes from gpt')
  return scenes.slice(0, nScenes).map((s) => ({
    prompt: String(s.prompt), script: String(s.script || ''),
    duration: Number(s.duration) >= 8 ? 10 : 5,
  }))
}

// ── gpt-4o: split the APPROVED script into N contiguous segments for long-form UGC (30/60s).
// Returns ONE reusable character paragraph + ONE voice description — pasted VERBATIM into every
// segment prompt so the person/voice can't drift between clips — plus per-segment script + action. ──
async function buildSegmentPlan(beat, product, nImages, script, nSegments, look) {
  const refList = Array.from({ length: nImages }, (_, i) => `@Image${i + 1}`).join(', ')
  const recast = look && look !== 'match'
  const sys = `You direct a ${nSegments}-segment TALKING-HEAD UGC ad (segments are stitched into one continuous video). Rules:
- Split the user's voiceover script into EXACTLY ${nSegments} contiguous chunks at natural sentence boundaries — in order, no overlap, no rewriting; together they must be the full script word-for-word.
- "character": ONE dense reusable paragraph describing the on-camera creator in precise repeatable detail — age, ${recast ? `${look} appearance (user's explicit choice)` : `ethnicity/look copied from the reference avatar (${(beat && beat.avatar) || 'as analysed'})`}, hair, wardrobe, plus the exact setting (${(beat && beat.setting) || 'as analysed'}). The SAME paragraph opens every segment prompt so the person cannot drift.
- "voice": one short line describing their voice (tone, pace, energy) — reused each segment for audio consistency.
- Per segment "action": what they physically do with the user's product (${refList || 'the product'}) in that segment — hold it up, demonstrate, close-up — following the reference beats in order.
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
function segmentPrompt(plan, seg, i, total, hasAnchor, nImages, lang) {
  const productRef = hasAnchor
    ? (nImages ? `@Image2${nImages > 1 ? `–@Image${nImages + 1}` : ''}` : 'the product')
    : (nImages ? `@Image1${nImages > 1 ? `–@Image${nImages}` : ''}` : 'the product')
  const parts = [plan.character]
  if (hasAnchor) parts.push(`This is segment ${i + 1} of ${total} of ONE continuous selfie take. @Image1 shows this exact creator one moment ago — treat it as ground truth: the SAME face, hair, outfit, room and lighting, continuing seamlessly. The user's product is ${productRef} and must match it exactly.`)
  else parts.push(`The user's product is ${productRef} and must match it exactly.`)
  parts.push(`They speak to camera in ${langName(lang).split(' — ')[0]} — ${plan.voice} — lips moving in sync, saying these exact words aloud: "${String(seg.script || '').replace(/"/g, "'")}"`)
  if (seg.action) parts.push(String(seg.action))
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

// ── Multi-clip assembly helpers (faithful scenes + long-form UGC segments) ────
async function downloadToFile(url, path) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`download clip ${r.status}`)
  await writeFile(path, Buffer.from(await r.arrayBuffer()))
}

// Concat local clips into one mp4. Re-encode via the concat demuxer — clips come from the same
// model/resolution/aspect but re-encoding guarantees clean joins.
async function concatClips(files, out) {
  const list = `${out}.txt`
  await writeFile(list, files.map((f) => `file '${f}'`).join('\n'))
  try {
    await ff(['-y', '-f', 'concat', '-safe', '0', '-i', list,
      '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out])
  } finally { await rm(list, { force: true }).catch(() => {}) }
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

// ── Single-voice narration (faithful/b-roll mode): one TTS track for the WHOLE script, muxed over
// the stitched video. Per-clip generated voices differ audibly between scenes; b-roll needs no lip
// sync, so one continuous voice is both correct and more professional. OpenAI TTS (key already set).
async function ttsVoiceover(text, id, voice) {
  const r = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST', headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: process.env.CLONE_TTS_MODEL || 'gpt-4o-mini-tts', voice: voice || process.env.CLONE_TTS_VOICE || 'nova', input: String(text).slice(0, 4000), response_format: 'mp3' }),
  })
  if (!r.ok) throw new Error(`tts ${r.status} ${(await r.text()).slice(0, 120)}`)
  const f = join(tmpdir(), `vo-${id}.mp3`)
  await writeFile(f, Buffer.from(await r.arrayBuffer()))
  return f
}
async function muxVoiceover(videoIn, voMp3, out) {
  // The narration is frequently LONGER than the stitched scenes (a 30-day script vs ~35s of clips) —
  // it must NEVER be cut off mid-sentence (that produced videos ending on 'day 21'). Freeze-extend
  // the last video frame (tpad, generous 180s that -shortest trims back) so the video always outlasts
  // the audio; mix ducked ambient with the FULL narration (duration=longest); -shortest caps the
  // output to the narration length — the final shot holds like an end-card for any tail.
  try {
    await ff(['-y', '-i', videoIn, '-i', voMp3, '-filter_complex',
      '[0:v]tpad=stop_mode=clone:stop_duration=180[vp];[0:a]volume=0.22[a0];[a0][1:a]amix=inputs=2:duration=longest[a]',
      '-map', '[vp]', '-map', '[a]', '-shortest', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out])
  } catch {
    // No/odd ambient stream → narration over the frame-extended video only.
    await ff(['-y', '-i', videoIn, '-i', voMp3, '-filter_complex', '[0:v]tpad=stop_mode=clone:stop_duration=180[vp]',
      '-map', '[vp]', '-map', '1:a', '-shortest', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out])
  }
}

// ── fal Seedance 2.0 reference-to-video (queue REST) ──────────────────────────
async function falGenerate({ prompt, imageUrls, videoUrl, resolution, duration, aspect, tier }) {
  const model = tier === 'fast' ? 'bytedance/seedance-2.0/fast/reference-to-video' : 'bytedance/seedance-2.0/reference-to-video'
  const input = { prompt, image_urls: (imageUrls || []).slice(0, 9), resolution: resolution || '720p', aspect_ratio: aspect || '9:16', generate_audio: true }
  if (videoUrl) input.video_urls = [videoUrl]
  if (duration) input.duration = String(duration)
  let sub = await fetch(`https://queue.fal.run/${model}`, { method: 'POST', headers: { Authorization: `Key ${FAL_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
  if (!sub.ok) {
    const txt = (await sub.text()).slice(0, 300)
    // Duration out of range for this model tier → retry once at the safe default.
    if (/duration/i.test(txt) && input.duration && input.duration !== '10') {
      input.duration = '10'
      sub = await fetch(`https://queue.fal.run/${model}`, { method: 'POST', headers: { Authorization: `Key ${FAL_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
      if (!sub.ok) throw new Error(`fal submit ${sub.status} ${(await sub.text()).slice(0, 200)}`)
    } else throw new Error(`fal submit ${sub.status} ${txt}`)
  }
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
    const { prompt, script, gloss } = await buildSeedancePrompt(beat, meta.product_details || { name: 'the product' }, productImages.length, null, meta.character_look, meta.language)
    // Suggest faithful (scene-by-scene) cloning when the source is a multi-scene / B-roll ad —
    // collapsing those into a talking head isn't a clone. The user picks the mode at approve time.
    const cinematic = detectCinematic(beat)
    const scenes = sceneCountFor(beat)
    await stamp({ status: 'review', clone_meta: { ...meta, beat_sheet: beat, seedance_prompt: prompt, script, script_gloss: gloss, suggested_mode: cinematic ? 'faithful' : 'ugc', scene_count: scenes } })
    console.log(`📝 drafted ${job.id} → awaiting approval (suggest=${cinematic ? 'faithful' : 'ugc'}, scenes=${scenes})`)
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
    const finalScript = meta.final_script || meta.script || ''

    // ── FAITHFUL mode: clone the source's edit structure scene-by-scene, then stitch. Each scene is
    // its own Seedance clip with a scene-appropriate prompt (b-roll/lifestyle/product allowed — no
    // forced talking head). No video reference per scene: the beat sheet grounds each prompt, and
    // skipping the ref avoids fal's likeness blocks entirely. ──
    if (meta.mode === 'faithful') {
      const nScenes = Math.min(4, Math.max(2, Number(meta.scene_count) || 2))
      const scenes = await buildScenePlan(meta.beat_sheet, meta.product_details || { name: 'the product' }, productImages.length, nScenes, meta.character_look, finalScript)
      const base = join(tmpdir(), `fj-${job.id}`)
      const tmp = []
      try {
        const files = []
        for (let i = 0; i < scenes.length; i++) {
          const s = scenes[i]
          // Scenes render VISUALS ONLY (ambience, no spoken dialogue) — the narration is one
          // continuous TTS track muxed after the stitch, so the voice can't change between scenes.
          console.log(`🎞 ${job.id} scene ${i + 1}/${scenes.length} (${s.duration}s)`)
          const { videoUrl } = await falGenerate({ prompt: s.prompt, imageUrls: productImages, resolution: meta.resolution, duration: s.duration, aspect: meta.aspect, tier: meta.tier })
          const f = `${base}-${i}.mp4`
          await downloadToFile(videoUrl, f)
          tmp.push(f); files.push(f)
        }
        const cat = `${base}-cat.mp4`
        tmp.push(cat)
        await concatClips(files, cat)
        let finalFile = cat
        if (finalScript.trim()) {
          try {
            const vo = await ttsVoiceover(finalScript, job.id, meta.voice)
            tmp.push(vo)
            const mixed = `${base}-vo.mp4`
            tmp.push(mixed)
            await muxVoiceover(cat, vo, mixed)
            finalFile = mixed
          } catch (e) { console.warn(`tts/mux failed for ${job.id} (shipping without VO):`, e.message) }
        }
        const mp4 = await readFile(finalFile)
        const key = `creatives/${job.user_id}/${job.id}.mp4`
        await r2.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key, Body: mp4, ContentType: 'video/mp4', CacheControl: 'public, max-age=31536000, immutable' }))
        const url = `${R2_PUBLIC}/${key}`
        await stamp({ status: 'done', media_type: 'video', image_url: url, clone_meta: { ...meta, scene_plan: scenes, script: finalScript } })
        if (job.credit_tx) await rpc('commit_credits', { p_tx: job.credit_tx, p_metadata: { mode: 'faithful', scenes: scenes.length } })
        console.log(`🎬 cloned (faithful, ${scenes.length} scenes) ${job.id} → ${url}`)
      } finally {
        for (const f of tmp) await rm(f, { force: true }).catch(() => {})
      }
      return
    }

    // ── LONG-FORM UGC (30/60s): the approved script splits into 2/4 segments at sentence
    // boundaries; every segment prompt opens with the SAME character paragraph, and each clip after
    // the first is anchored to the previous clip's final frame (@Image1) so the creator carries
    // through the cuts. Clips keep Seedance's own lip-synced audio (a TTS overlay would break sync),
    // with the voice description repeated verbatim to hold tone steady. ──
    const nSeg = Math.min(4, Math.max(1, Number(meta.segments) || 1))
    if (nSeg > 1) {
      const plan = await buildSegmentPlan(meta.beat_sheet, meta.product_details || { name: 'the product' }, productImages.length, finalScript, nSeg, meta.character_look)
      const base = join(tmpdir(), `sj-${job.id}`)
      const tmp = []
      try {
        const files = []
        let anchor = null
        for (let i = 0; i < plan.segments.length; i++) {
          const prompt = segmentPrompt(plan, plan.segments[i], i, plan.segments.length, !!anchor, productImages.length, meta.language)
          const imgs = anchor ? [anchor, ...productImages].slice(0, 9) : productImages
          console.log(`🎞 ${job.id} segment ${i + 1}/${plan.segments.length}${anchor ? ' (anchored)' : ''}`)
          const { videoUrl } = await falGenerate({ prompt, imageUrls: imgs, resolution: meta.resolution, duration: 15, aspect: meta.aspect, tier: meta.tier })
          const f = `${base}-${i}.mp4`
          await downloadToFile(videoUrl, f)
          tmp.push(f); files.push(f)
          if (i < plan.segments.length - 1) anchor = await lastFrameAnchor(f, job.id, i)
        }
        const cat = `${base}-cat.mp4`
        tmp.push(cat)
        await concatClips(files, cat)
        const mp4 = await readFile(cat)
        const key = `creatives/${job.user_id}/${job.id}.mp4`
        await r2.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key, Body: mp4, ContentType: 'video/mp4', CacheControl: 'public, max-age=31536000, immutable' }))
        const url = `${R2_PUBLIC}/${key}`
        await stamp({ status: 'done', media_type: 'video', image_url: url, clone_meta: { ...meta, segment_plan: plan, script: finalScript } })
        if (job.credit_tx) await rpc('commit_credits', { p_tx: job.credit_tx, p_metadata: { mode: 'ugc_long', segments: nSeg } })
        console.log(`🎬 cloned (long UGC, ${nSeg} segments) ${job.id} → ${url}`)
      } finally {
        for (const f of tmp) await rm(f, { force: true }).catch(() => {})
      }
      return
    }

    // ── UGC mode (default): one talking-head clip, unchanged behavior. ──
    // Rebuild the prompt around the approved (possibly edited) script so the voiceover matches exactly.
    const { prompt, script } = await buildSeedancePrompt(meta.beat_sheet, meta.product_details || { name: 'the product' }, productImages.length, finalScript, meta.character_look, meta.language)

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
