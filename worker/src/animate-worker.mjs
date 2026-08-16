/**
 * animate-worker — renders "just animation" MP4s (Ken Burns zoom / shine sweep) from a static ad
 * image using FFmpeg, keeping the ad pixel-exact. Polls creative_generations for queued motion jobs
 * (type='animated', status='processing', image_url IS NULL, operation IS NULL), renders a short clip,
 * uploads to R2, marks the row done, and commits (or refunds) the reserved credits.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, R2_* (ACCOUNT_ID/ACCESS_KEY_ID/SECRET_ACCESS_KEY/
 *      BUCKET_NAME/PUBLIC_URL). Needs ffmpeg on PATH (same box as mp4-poster).
 */
import { spawn } from 'node:child_process'
import { readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

const U = (process.env.SUPABASE_URL || '').split('\n')[0].replace(/\/$/, '')
const K = process.env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: 'Bearer ' + K, 'Content-Type': 'application/json' }
const EVERY = 6000
const DUR = 5           // seconds
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
})
const R2_PUBLIC = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '')

async function getJSON(path) { const r = await fetch(`${U}/rest/v1/${path}`, { headers: H }); if (!r.ok) throw new Error(`${r.status} ${await r.text()}`); return r.json() }
async function patch(path, body) { const r = await fetch(`${U}/rest/v1/${path}`, { method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify(body) }); if (!r.ok) console.warn('patch', path, r.status, (await r.text()).slice(0, 120)) }
async function rpc(fn, body) { const r = await fetch(`${U}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H, body: JSON.stringify(body) }); if (!r.ok) console.warn('rpc', fn, r.status, (await r.text()).slice(0, 120)) }
async function logErr(userId, message, extra) { try { await fetch(`${U}/rest/v1/error_logs`, { method: 'POST', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify({ user_id: userId || null, error_message: String(message || '').slice(0, 2000), page_url: '/studio', extra: extra || null }) }) } catch { /* never block */ } }

function ff(args) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', args)
    let err = ''
    p.stderr.on('data', (d) => { err += d.toString() })
    p.on('close', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}: ${err.slice(-400)}`)))
    p.on('error', reject)
  })
}

// Longer side → target; keeps aspect. Even dims for h264.
function scaleFilter(target) {
  return `scale='if(gt(iw,ih),${target},-2)':'if(gt(iw,ih),-2,${target})':flags=lanczos`
}

async function render(inFile, outFile, motion, target) {
  const s = scaleFilter(target)
  if (motion === 'shine') {
    // Static scaled base + a soft white band that sweeps left→right (geq alpha moves with T).
    const vf = `${s},format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)+90*exp(-((X-(W*mod(T*0.45,1.4)-0.2*W))^2)/(2*(0.05*W)^2))',format=yuv420p`
    await ff(['-y', '-loop', '1', '-i', inFile, '-vf', vf, '-t', String(DUR), '-r', '30', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outFile])
  } else {
    // Ken Burns slow push-in, centered.
    const vf = `${s},zoompan=z='min(zoom+0.0009,1.14)':d=${DUR * 30}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':fps=30,format=yuv420p`
    await ff(['-y', '-loop', '1', '-i', inFile, '-vf', vf, '-t', String(DUR), '-r', '30', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outFile])
  }
}

async function processJob(job) {
  const target = job.tier === '4k' ? 2160 : 1080
  const motion = (job.prompt || '').includes('shine') ? 'shine' : 'zoom'
  const base = join(tmpdir(), `anim-${job.id}`)
  const inFile = `${base}.in`, outFile = `${base}.mp4`
  try {
    const ir = await fetch(job.source_image_url)
    if (!ir.ok) throw new Error(`fetch image ${ir.status}`)
    await writeFile(inFile, Buffer.from(await ir.arrayBuffer()))

    await render(inFile, outFile, motion, target)
    const mp4 = await readFile(outFile)

    const key = `creatives/${job.user_id}/${job.id}.mp4`
    await r2.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key, Body: mp4, ContentType: 'video/mp4', CacheControl: 'public, max-age=31536000, immutable' }))
    const url = `${R2_PUBLIC}/${key}`

    await patch(`creative_generations?id=eq.${job.id}`, { status: 'done', media_type: 'video', image_url: url })
    if (job.credit_tx) await rpc('commit_credits', { p_tx: job.credit_tx, p_metadata: {} })
    console.log(`🎬 animated ${job.id} (${motion}, ${target}p)`)
  } catch (e) {
    console.warn(`animate ${job.id} failed:`, e.message)
    await patch(`creative_generations?id=eq.${job.id}`, { status: 'failed' })
    await logErr(job.user_id, `Animation render failed — ${e.message}`, { kind: 'render_failed', stage: 'animate', job: job.id })
    if (job.credit_tx) await rpc('refund_credits', { p_tx: job.credit_tx })
  } finally {
    await rm(inFile, { force: true }).catch(() => {})
    await rm(outFile, { force: true }).catch(() => {})
  }
}

async function tick() {
  const jobs = await getJSON(`creative_generations?select=id,user_id,tier,prompt,source_image_url,credit_tx&type=eq.animated&status=eq.processing&image_url=is.null&source_image_url=not.is.null&order=created_at.asc&limit=3`).catch(() => [])
  for (const j of jobs || []) await processJob(j)
}

console.log('🎬 animate-worker up — rendering motion clips (zoom / shine)')
for (;;) { try { await tick() } catch (e) { console.warn('tick error:', e?.message || e) } await sleep(EVERY) }
