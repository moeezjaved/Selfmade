/**
 * selfmade-render — the Remotion export worker (Phase 1 Step 4).
 *
 * Polls creative_generations for jobs the editor flagged (clone_meta.render.status = 'requested'),
 * renders the timeline to an MP4 per requested aspect via Remotion (in ../remotion), uploads each to
 * R2, and writes clone_meta.exports = { aspect: url } + render.status = 'done'. This is the assembly
 * step that replaces the ffmpeg stitch — footage + editable layers → final video.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, R2_* (ACCOUNT_ID/ACCESS_KEY_ID/SECRET_ACCESS_KEY/
 *   BUCKET_NAME/PUBLIC_URL), REMOTION_DIR (default ../remotion), POLL_MS (default 5000).
 * Prereqs on the droplet: `cd remotion && npm install` once (pulls Remotion + Chromium on first render).
 */
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { spawn } from 'node:child_process'
import { readFile, writeFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const U = (process.env.SUPABASE_URL || '').split('\n')[0].replace(/\/$/, '')
const K = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const H = { apikey: K, Authorization: 'Bearer ' + K, 'Content-Type': 'application/json' }
const REMOTION_DIR = process.env.REMOTION_DIR || new URL('../../remotion', import.meta.url).pathname
const POLL_MS = parseInt(process.env.POLL_MS || '5000', 10)
const R2_PUBLIC = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '')

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
})

async function getJSON(path) { const r = await fetch(`${U}/rest/v1/${path}`, { headers: H }); if (!r.ok) throw new Error(`${r.status} ${await r.text()}`); return r.json() }
async function patchMeta(id, meta) {
  const r = await fetch(`${U}/rest/v1/creative_generations?id=eq.${id}`, { method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify({ clone_meta: meta }) })
  if (!r.ok) console.warn('patch', id, r.status, (await r.text()).slice(0, 140))
}

// Run `remotion render` for ONE aspect. The composition reads timeline.aspect for its dimensions.
function renderOne(propsFile, outFile) {
  return new Promise((resolve, reject) => {
    const p = spawn('npx', ['remotion', 'render', 'src/index.ts', 'AdComposition', outFile, `--props=${propsFile}`, '--log=error'], { cwd: REMOTION_DIR })
    let err = ''
    p.stderr.on('data', (d) => { err += d.toString() })
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.slice(-400) || `exit ${code}`))))
  })
}

async function processJob(job) {
  const meta = job.clone_meta || {}
  const timeline = meta.timeline
  const aspects = meta.render?.aspects?.length ? meta.render.aspects : ['9:16']
  if (!timeline) { await patchMeta(job.id, { ...meta, render: { ...meta.render, status: 'failed', error: 'no timeline' } }); return }

  // Mark rendering so a second worker doesn't grab it.
  await patchMeta(job.id, { ...meta, render: { ...meta.render, status: 'rendering' } })
  const dir = await mkdtemp(join(tmpdir(), 'render-'))
  const exports = { ...(meta.exports || {}) }

  try {
    for (const aspect of aspects) {
      const propsFile = join(dir, `props-${aspect.replace(':', 'x')}.json`)
      const outFile = join(dir, `out-${aspect.replace(':', 'x')}.mp4`)
      await writeFile(propsFile, JSON.stringify({ timeline: { ...timeline, aspect } }))
      console.log(`🎬 ${job.id} rendering ${aspect}…`)
      await renderOne(propsFile, outFile)
      const mp4 = await readFile(outFile)
      const key = `creatives/exports/${job.id}/${aspect.replace(':', 'x')}.mp4`
      await r2.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key, Body: mp4, ContentType: 'video/mp4', CacheControl: 'public, max-age=31536000, immutable' }))
      exports[aspect] = `${R2_PUBLIC}/${key}`
      console.log(`✅ ${job.id} ${aspect} → ${exports[aspect]}`)
    }
    await patchMeta(job.id, { ...meta, exports, render: { ...meta.render, status: 'done', finishedAt: new Date().toISOString() } })
  } catch (e) {
    console.warn(`render ${job.id} failed:`, String(e).slice(0, 200))
    await patchMeta(job.id, { ...meta, exports, render: { ...meta.render, status: 'failed', error: String(e).slice(0, 200) } })
  }
}

async function tick() {
  const jobs = await getJSON(`creative_generations?select=id,clone_meta&clone_meta->render->>status=eq.requested&order=created_at.asc&limit=1`).catch(() => [])
  for (const j of jobs) await processJob(j)
}

console.log(`🚀 selfmade-render up — remotion at ${REMOTION_DIR}, polling every ${POLL_MS}ms`)
async function loop() { try { await tick() } catch (e) { console.warn('tick', String(e).slice(0, 140)) } setTimeout(loop, POLL_MS) }
loop()
