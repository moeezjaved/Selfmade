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
const SEEDANCE_FAST_USD_PER_SEC = Number(process.env.FAL_SEEDANCE_FAST_USD_PER_SEC || 0.09)
const VACE_EST_USD_PER_RUN = Number(process.env.FAL_VACE_EST_USD || 0.5)
const clipCost = (tier, secs) => (tier === 'fast' ? SEEDANCE_FAST_USD_PER_SEC : SEEDANCE_USD_PER_SEC) * (Number(secs) || 10)
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
        { type: 'text', text: 'Describe this product for an ad script in ONE dense sentence: exactly what it IS (form factor — capsules / gummies / powder / spray / bottle / device / garment …), its packaging, colors, and any readable label text. State only what is visible — no guesses.' },
        { type: 'image_url', image_url: { url: imageUrl } },
      ] }],
    }),
  })
  if (!r.ok) throw new Error(`vision ${r.status}`)
  const j = await r.json()
  const text = (j.choices?.[0]?.message?.content || '').trim()
  return text || null
}
function productTruthRule(product) {
  const seen = product && product.observed ? `The product's ACTUAL appearance (described from its real photos): ${product.observed}. ` : ''
  return `- PRODUCT TRUTH — ${seen}The script and visuals must describe THE USER'S product truthfully: its real form factor, type and packaging. NEVER inherit the reference ad's product form, flavor or claims (e.g. reference sells gummies but the user's product is capsules → say and show capsules). When unsure, describe only what the product photos show.`
}

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
${productTruthRule(product)}
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
  // Scale with BOTH the beat count and the source duration — Gemini returns 3-8 beats regardless of
  // length, so beats alone undercounted badly (a 60s multi-cut ad got 2 scenes). ~15s of source per
  // scene, capped at 4 (the priced x2-x4 rows).
  const beats = Array.isArray(beat && beat.beats) ? beat.beats.length : 4
  const secs = Number(beat && beat.duration_seconds) || 15
  return Math.min(4, Math.max(2, Math.ceil(beats / 2), Math.ceil(secs / 15)))
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
${productTruthRule(product)}
${voiceover ? `- NARRATION IS ADDED IN POST — scenes must contain NO on-camera speech (ambience/music energy only). Design the visuals to fit this voiceover's arc, in order: "${String(voiceover).replace(/"/g, "'")}". Put the chunk each scene covers in its "script" field for reference only — do NOT write spoken dialogue into the prompt.` : '- No dialogue — scenes are music/ambience-driven b-roll. Leave "script" empty.'}
- Per scene pick "duration": 5 for a quick cut, 10 for a longer beat (numbers only).
- Per scene also report: "has_people": true if ANY person/face is visible in that reference beat (false = pure product/object/environment b-roll), and "src_start"/"src_end": the SECONDS range of the reference footage this scene recreates (derive from the beats' "t" ranges, e.g. "4-9s" → 4 and 9).
Return ONLY minified JSON: {"scenes":[{"prompt":"","script":"","duration":5,"has_people":false,"src_start":0,"src_end":5}]}  (exactly ${nScenes} scenes, in order).`
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
    has_people: s.has_people !== false,   // default TRUE (safe: no ref video unless surely people-free)
    src_start: Number.isFinite(+s.src_start) ? Math.max(0, +s.src_start) : null,
    src_end: Number.isFinite(+s.src_end) ? +s.src_end : null,
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
${productTruthRule(product)}
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

// ── Generic fal queue submit + poll (any model) ───────────────────────────────
async function falQueueRun(model, input, iters = 200) {
  const sub = await fetch(`https://queue.fal.run/${model}`, { method: 'POST', headers: { Authorization: `Key ${FAL_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
  if (!sub.ok) throw new Error(`fal ${model} submit ${sub.status} ${(await sub.text()).slice(0, 200)}`)
  const { request_id, status_url, response_url } = await sub.json()
  const statusUrl = status_url || `https://queue.fal.run/${model}/requests/${request_id}/status`
  const resultUrl = response_url || `https://queue.fal.run/${model}/requests/${request_id}`
  for (let i = 0; i < iters; i++) {
    await sleep(6000)
    const sr = await fetch(statusUrl, { headers: { Authorization: `Key ${FAL_KEY}` } })
    if (!sr.ok) continue
    const st = await sr.json()
    if (st.status === 'COMPLETED') break
    if (st.status === 'FAILED' || st.status === 'ERROR') throw new Error(`fal ${model} ${st.status}`)
  }
  const rr = await fetch(resultUrl, { headers: { Authorization: `Key ${FAL_KEY}` } })
  if (!rr.ok) throw new Error(`fal ${model} result ${rr.status}: ${(await rr.text()).slice(0, 200)}`)
  return rr.json()
}

// ── Pose-guided people-scene restyle (Wan VACE): copies the source's MOVEMENT SKELETON — blocking,
// gesture, camera — while generating entirely NEW people (no faces copied → no likeness issue).
// preprocess:true makes VACE derive the pose control from the raw footage itself. ──
async function restyleScene({ prompt, refVideoUrl, imageUrls, duration, aspect }) {
  const input = {
    prompt: `${prompt} Entirely new people with different faces than the reference — but the exact same motion, blocking, energy and camera movement.`,
    video_url: refVideoUrl,
    task: 'pose', preprocess: true,
    ref_image_urls: (imageUrls || []).slice(0, 3),
    resolution: '580p',
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
function assHead(style) {
  const st = CAPTION_STYLES[style] || CAPTION_STYLES.bold
  const styleLine = `Style: Default,${st.Fontname},${st.Fontsize},${st.PrimaryColour},${st.SecondaryColour},${st.OutlineColour},${st.BackColour},${st.Bold},0,0,0,100,100,0,0,${st.BorderStyle},${st.Outline},${st.Shadow},${st.Alignment},40,40,${st.MarginV},1`
  return `[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\nWrapStyle: 2\n\n[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\n${styleLine}\n\n[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n`
}
const assSafe = (t) => String(t).replace(/\n/g, ' ').replace(/\{/g, '(').replace(/\}/g, ')')
// Phrase captions (used for translated/cross-language captions).
function buildAss(segments, style) {
  const events = segments.filter((s) => s.text).map((s) =>
    `Dialogue: 0,${assTime(s.start)},${assTime(s.end)},Default,,0,0,0,,${assSafe(s.text)}`).join('\n')
  return assHead(style) + events + '\n'
}
// Word-by-word KARAOKE captions (same-language): words grouped into ~3-word lines; \k timing paints
// each word from SecondaryColour → PrimaryColour exactly as it's spoken. The TikTok look.
function buildKaraokeAss(words, style) {
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
  return assHead(style) + events + '\n'
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
    let ass
    if (want !== spoken && tr.segments.length) {
      const translated = await translateSegments(tr.segments, want)
      ass = buildAss(translated, style)
    } else if (tr.words.length) {
      ass = buildKaraokeAss(tr.words, style)
    } else {
      ass = buildAss(tr.segments, style)
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
        { role: 'system', content: `TRANSCREATE this ad voiceover into ${langName(lang)}. Same message, same energy, natural native delivery — never literal translation. Keep brand/product names as-is. Return ONLY JSON: {"script":""}.` },
        { role: 'user', content: String(text) },
      ] }),
  })
  if (!r.ok) throw new Error(`transcreate ${r.status}`)
  const out = JSON.parse((await r.json()).choices?.[0]?.message?.content || '{}')
  if (!out.script) throw new Error('no transcreated script')
  return String(out.script)
}

// Two ALTERNATIVE hook treatments for the opening scene (question / bold-claim / visual-shock).
async function hookVariantPrompts(scenePrompt) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: OPENAI_MODEL, temperature: 0.8, response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Given this Seedance prompt for an ad\'s OPENING scene, write 2 ALTERNATIVE hook treatments: (1) a bold-claim/curiosity pattern, (2) a visual-shock/pattern-interrupt. Same product, same setting language, same approximate duration and style constraints — only the hook concept changes. Return ONLY JSON: {"variants":["",""]}' },
        { role: 'user', content: String(scenePrompt) },
      ] }),
  })
  if (!r.ok) throw new Error(`hooks ${r.status}`)
  const out = JSON.parse((await r.json()).choices?.[0]?.message?.content || '{}')
  const v = Array.isArray(out.variants) ? out.variants.filter(Boolean).slice(0, 2) : []
  if (v.length < 2) throw new Error('no hook variants')
  return v.map(String)
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

// ── PHASE A: analyse the competitor video + draft a script → status='review' (awaits approval) ──
async function analyzeJob(job) {
  const meta = job.clone_meta || {}
  const stamp = (b) => patch(`creative_generations?id=eq.${job.id}`, b)
  try {
    let beat = null
    if (job.source_video_url) { try { beat = await analyzeVideo(job.source_video_url) } catch (e) { console.warn('analyze:', e.message) } }
    const productImages = Array.isArray(meta.product_image_urls) ? meta.product_image_urls : []
    // LOOK at the product photo once (vision) so scripts describe what it actually is — capsules vs
    // gummies etc. Persisted into product_details so every later prompt builder gets it too.
    let productDetails = meta.product_details || { name: 'the product' }
    if (!productDetails.observed && productImages[0]) {
      try { const obs = await describeProduct(productImages[0]); if (obs) productDetails = { ...productDetails, observed: obs } }
      catch (e) { console.warn('describeProduct:', e.message) }
    }
    meta.product_details = productDetails
    const { prompt, script, gloss } = await buildSeedancePrompt(beat, productDetails, productImages.length, null, meta.character_look, meta.language)
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
      // Reuse the stamped plan on resume — a fresh plan would mismatch the checkpointed clips.
      const scenes = (Array.isArray(meta.scene_plan) && meta.scene_plan.length)
        ? meta.scene_plan
        : await buildScenePlan(meta.beat_sheet, meta.product_details || { name: 'the product' }, productImages.length, nScenes, meta.character_look, finalScript)
      const base = join(tmpdir(), `fj-${job.id}`)
      const tmp = []
      let falCost = 0   // estimated fal spend for this job (checkpoint reuses cost nothing)
      try {
        const files = []
        // Checkpointing: each finished clip URL is stamped into clone_meta immediately, so a worker
        // restart (deploy/crash) RESUMES from the last completed scene instead of re-rendering —
        // and re-billing fal for — the whole job.
        const clipsDone = meta.scene_clips || {}
        for (let i = 0; i < scenes.length; i++) {
          const s = scenes[i]
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

          // Cut the exact beat range from the original ad as this scene's structural reference.
          let sceneRef = null
          if (job.source_video_url && s.src_start != null) {
            const refDur = Math.min(14, Math.max(3, (s.src_end != null ? s.src_end : s.src_start + s.duration) - s.src_start))
            try { sceneRef = await trimReference(job.source_video_url, job.id, { start: s.src_start, duration: refDur, tag: `sc${i}` }) }
            catch (e) { console.warn(`scene ${i + 1} trim:`, e.message) }
          }

          let videoUrl = null
          if (s.has_people && sceneRef && process.env.CLONE_PEOPLE_RESTYLE !== '0') {
            // PEOPLE scene → pose-guided restyle (Wan VACE): copies the movement skeleton + camera
            // from the source with entirely NEW people. Falls back to prompt-only Seedance on error.
            console.log(`🎞 ${job.id} scene ${i + 1}/${scenes.length} (${s.duration}s, pose-restyle)`)
            try { videoUrl = await restyleScene({ prompt: s.prompt, refVideoUrl: sceneRef, imageUrls: productImages, duration: s.duration, aspect: meta.aspect }); falCost += VACE_EST_USD_PER_RUN }
            catch (e) { console.warn(`scene ${i + 1} restyle failed (${e.message}) — falling back to prompt-only`) }
          }
          if (!videoUrl && !s.has_people && sceneRef) {
            // PEOPLE-FREE b-roll → source segment straight into Seedance as a motion reference
            // (no faces → no likeness block); prompt-only retry if fal objects anyway.
            console.log(`🎞 ${job.id} scene ${i + 1}/${scenes.length} (${s.duration}s, motion-ref)`)
            try { ({ videoUrl } = await falGenerate({ prompt: s.prompt, imageUrls: productImages, videoUrl: sceneRef, resolution: meta.resolution, duration: s.duration, aspect: meta.aspect, tier: meta.tier })); falCost += clipCost(meta.tier, s.duration) }
            catch (e) {
              if (/content_policy_violation|likeness|real people/i.test(e.message)) console.warn(`scene ${i + 1} ref blocked (likeness) — retrying prompt-only`)
              else throw e
            }
          }
          if (!videoUrl) {
            console.log(`🎞 ${job.id} scene ${i + 1}/${scenes.length} (${s.duration}s, prompt-only)`)
            ;({ videoUrl } = await falGenerate({ prompt: s.prompt, imageUrls: productImages, resolution: meta.resolution, duration: s.duration, aspect: meta.aspect, tier: meta.tier }))
            falCost += clipCost(meta.tier, s.duration)
          }
          let f = `${base}-${i}.mp4`
          await downloadToFile(videoUrl, f)
          tmp.push(f)
          f = await ensureAudio(f)          // VACE clips are silent → pad a silent track for concat
          if (!tmp.includes(f)) tmp.push(f)
          files.push(f)
          // Checkpoint this scene so a restart never re-renders (or re-bills fal for) it.
          clipsDone[i] = videoUrl
          await stamp({ clone_meta: { ...meta, scene_plan: scenes, scene_clips: clipsDone } })
        }
        // Assemble a full cut from a clip list: concat → VO mux → end-card. Reused by the main cut,
        // the hook variants (different scene 1) and the extra-language outputs (different VO).
        const assemble = async (clipFiles, voText, tag) => {
          const catX = `${base}-${tag}-cat.mp4`
          tmp.push(catX)
          await concatClips(clipFiles, catX)
          let cut = catX
          if (voText && voText.trim()) {
            try {
              const vo = await ttsVoiceover(voText, `${job.id}-${tag}`, meta.voice)
              tmp.push(vo)
              const mixed = `${base}-${tag}-vo.mp4`
              tmp.push(mixed)
              await muxVoiceover(catX, vo, mixed)
              cut = mixed
            } catch (e) { console.warn(`tts/mux (${tag}) failed for ${job.id} (shipping without VO):`, e.message) }
          }
          return withEndCard(cut, meta, job.id, tag, tmp)
        }

        const main = await assemble(files, finalScript, 'main')
        const url = await uploadVideo(main.file, `creatives/${job.user_id}/${job.id}.mp4`)
        // Settle the end-card tx on the MAIN cut's outcome (applied → commit, failed → refund).
        if (meta.end_card && meta.end_card.tx) {
          if (main.applied) await rpc('commit_credits', { p_tx: meta.end_card.tx, p_metadata: { endcard: true } })
          else await rpc('refund_credits', { p_tx: meta.end_card.tx })
        }
        await stamp({ status: 'done', media_type: 'video', image_url: url, clone_meta: { ...meta, scene_plan: scenes, script: finalScript, fal_cost_est: +falCost.toFixed(2) } })
        if (job.credit_tx) await rpc('commit_credits', { p_tx: job.credit_tx, p_metadata: { mode: 'faithful', scenes: scenes.length, actual_cost_usd: +falCost.toFixed(2) } })
        console.log(`🎬 cloned (faithful, ${scenes.length} scenes) ${job.id} → ${url}`)

        // ── EXTRA LANGUAGES: transcreate + new TTS over the SAME rendered visuals → own creative. ──
        for (const ex of (Array.isArray(meta.extra_langs) ? meta.extra_langs : [])) {
          try {
            const script2 = await transcreateScript(finalScript || meta.script || '', ex.lang)
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
            const names = ['hookB', 'hookC']
            for (let vi = 0; vi < variants.length; vi++) {
              const { videoUrl } = await falGenerate({ prompt: variants[vi], imageUrls: productImages, resolution: meta.resolution, duration: scenes[0].duration, aspect: meta.aspect, tier: meta.tier })
              vCost += clipCost(meta.tier, scenes[0].duration)
              let vf = `${base}-${names[vi]}.mp4`
              await downloadToFile(videoUrl, vf)
              tmp.push(vf)
              vf = await ensureAudio(vf)
              if (!tmp.includes(vf)) tmp.push(vf)
              const cut = await assemble([vf, ...files.slice(1)], finalScript, names[vi])
              const urlV = await uploadVideo(cut.file, `creatives/${job.user_id}/${job.id}-${names[vi]}.mp4`)
              await insertRow({ user_id: job.user_id, parent_id: job.id, type: 'video_clone', media_type: 'video', status: 'done', tier: job.tier || 'pro', prompt: `clone · hook variant ${vi + 2}`, image_url: urlV, clone_meta: { variant_of: job.id, variant: names[vi], hook_prompt: variants[vi], script: finalScript } })
              console.log(`⚡ ${job.id} ${names[vi]} → ${urlV}`)
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
    // through the cuts. Clips keep Seedance's own lip-synced audio (a TTS overlay would break sync),
    // with the voice description repeated verbatim to hold tone steady. ──
    const nSeg = Math.min(4, Math.max(1, Number(meta.segments) || 1))
    if (nSeg > 1) {
      // Reuse the stamped plan + clips on resume (see faithful-mode checkpointing note).
      const plan = (meta.segment_plan && Array.isArray(meta.segment_plan.segments) && meta.segment_plan.segments.length)
        ? meta.segment_plan
        : await buildSegmentPlan(meta.beat_sheet, meta.product_details || { name: 'the product' }, productImages.length, finalScript, nSeg, meta.character_look)
      const base = join(tmpdir(), `sj-${job.id}`)
      const tmp = []
      let falCost = 0
      try {
        const files = []
        const segClips = meta.segment_clips || {}
        const segAnchors = meta.segment_anchors || {}
        let anchor = null
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
          const prompt = segmentPrompt(plan, plan.segments[i], i, plan.segments.length, !!anchor, productImages.length, meta.language)
          const imgs = anchor ? [anchor, ...productImages].slice(0, 9) : productImages
          console.log(`🎞 ${job.id} segment ${i + 1}/${plan.segments.length}${anchor ? ' (anchored)' : ''}`)
          const { videoUrl } = await falGenerate({ prompt, imageUrls: imgs, resolution: meta.resolution, duration: 15, aspect: meta.aspect, tier: meta.tier })
          falCost += clipCost(meta.tier, 15)
          const f = `${base}-${i}.mp4`
          await downloadToFile(videoUrl, f)
          tmp.push(f); files.push(f)
          if (i < plan.segments.length - 1) anchor = await lastFrameAnchor(f, job.id, i)
          segClips[i] = videoUrl
          if (anchor) segAnchors[i] = anchor
          await stamp({ clone_meta: { ...meta, segment_plan: plan, segment_clips: segClips, segment_anchors: segAnchors } })
        }
        const cat = `${base}-cat.mp4`
        tmp.push(cat)
        await concatClips(files, cat)
        const fin = await withEndCard(cat, meta, job.id, 'main', tmp)
        if (meta.end_card && meta.end_card.tx) {
          if (fin.applied) await rpc('commit_credits', { p_tx: meta.end_card.tx, p_metadata: { endcard: true } })
          else await rpc('refund_credits', { p_tx: meta.end_card.tx })
        }
        const url = await uploadVideo(fin.file, `creatives/${job.user_id}/${job.id}.mp4`)
        await stamp({ status: 'done', media_type: 'video', image_url: url, clone_meta: { ...meta, segment_plan: plan, script: finalScript, fal_cost_est: +falCost.toFixed(2) } })
        if (job.credit_tx) await rpc('commit_credits', { p_tx: job.credit_tx, p_metadata: { mode: 'ugc_long', segments: nSeg, actual_cost_usd: +falCost.toFixed(2) } })
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

    const singleTmp = []
    const singleFile = join(tmpdir(), `sc-${job.id}.mp4`)
    singleTmp.push(singleFile)
    await downloadToFile(videoUrl, singleFile)
    const fin = await withEndCard(singleFile, meta, job.id, 'main', singleTmp)
    if (meta.end_card && meta.end_card.tx) {
      if (fin.applied) await rpc('commit_credits', { p_tx: meta.end_card.tx, p_metadata: { endcard: true } })
      else await rpc('refund_credits', { p_tx: meta.end_card.tx })
    }
    const url = await uploadVideo(fin.file, `creatives/${job.user_id}/${job.id}.mp4`)
    for (const f of singleTmp) await rm(f, { force: true }).catch(() => {})

    const falCost = clipCost(meta.tier, meta.duration || 10)
    await stamp({ status: 'done', media_type: 'video', image_url: url, clone_meta: { ...meta, seedance_prompt: prompt, script, fal_request_id: requestId, fal_cost_est: +falCost.toFixed(2) } })
    if (job.credit_tx) await rpc('commit_credits', { p_tx: job.credit_tx, p_metadata: { fal_request_id: requestId, actual_cost_usd: +falCost.toFixed(2) } })
    console.log(`🎬 cloned ${job.id} → ${url}`)
  } catch (e) {
    console.warn(`generate ${job.id} failed:`, e.message)
    await stamp({ status: 'failed', clone_meta: { ...meta, error: e.message } })
    if (job.credit_tx) await rpc('refund_credits', { p_tx: job.credit_tx })
    // Add-on reservations must never strand when the base render fails.
    for (const ex of (Array.isArray(meta.extra_langs) ? meta.extra_langs : [])) if (ex.tx) await rpc('refund_credits', { p_tx: ex.tx })
    if (meta.end_card && meta.end_card.tx) await rpc('refund_credits', { p_tx: meta.end_card.tx })
    if (meta.hook_variants_tx) await rpc('refund_credits', { p_tx: meta.hook_variants_tx })
  }
}

// ── Concurrent pump. The old loop was fully SERIAL: one 20-minute faithful render blocked every
// other user's ANALYSIS (user B couldn't even get a script drafted until user A's video finished).
// Now analyses (fast, cheap) and generations run as independent concurrent pools; the in-flight set
// prevents double-pickup across poll ticks (single container, so process-local state suffices —
// rows stay in their status while being worked, and checkpointing makes crash-restarts safe).
const MAX_ANALYZE = Number(process.env.CLONE_ANALYZE_CONCURRENCY || 3)
const MAX_GEN = Number(process.env.CLONE_GEN_CONCURRENCY || 2)
const inflight = new Set()
let anActive = 0
let genActive = 0

async function pump() {
  const sel = 'select=id,user_id,tier,source_video_url,clone_meta,credit_tx&type=eq.video_clone&order=created_at.asc&limit=6'
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
      inflight.add(j.id); genActive++
      generateJob(j).catch((e) => console.warn('generate crash:', e?.message)).finally(() => { inflight.delete(j.id); genActive-- })
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
