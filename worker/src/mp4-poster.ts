/**
 * mp4 poster extraction — real first-frame thumbnails for the video back-catalog.
 *
 * The drain posters NEW video ads from FB's still-valid preview URL. But OLD video ads
 * (drained before the poster patch, or whose FB preview URL has expired) have no poster
 * and fall back to the branded placeholder — which keeps the grid from looking broken but
 * tells the user nothing about the ad. This pulls one real frame from the mp4 ALREADY in
 * R2 (no FB URL, no IPRoyal) and sets discovery_creatives.poster_url, so every video shows
 * its actual content without the user having to hit play.
 *
 * Targets null-poster video creatives KEYSET BY ad_id — ad_id is indexed
 * (discovery_creatives_ad_id_idx) so each batch is ~0.25s, NOT the 4.5s unindexed
 * created_at sort that ruled out the URL re-host approach. Postered rows drop out of the
 * filter, so it converges and is safe to re-run.
 *
 * CPU-HEAVY (ffmpeg per video) → do NOT run on the crawl box during the count-push. Run
 * it POST-push when CPU frees, or on a SEPARATE box pointed at the same R2 + DB. Gentle by
 * default (concurrency 2 + inter-batch sleep) so it yields if it must share the box.
 *
 *   docker run -d --name mp4-poster --env-file /opt/worker/.env \
 *     -v /opt/worker/src/mp4-poster.ts:/app/src/mp4-poster.ts \
 *     -e MP4POSTER_CONCURRENCY=2 selfmade-worker npx tsx src/mp4-poster.ts
 *   # tunables: MP4POSTER_CONCURRENCY (default 2), MP4POSTER_BATCH (default 120)
 */
import { supabase } from './db.js'
import { uploadBufferToR2 } from './r2.js'
import { imageHash } from './hash.js'
import { spawn } from 'child_process'

const CONCURRENCY = Math.max(1, parseInt(process.env.MP4POSTER_CONCURRENCY ?? '2', 10))
const BATCH = Math.max(20, parseInt(process.env.MP4POSTER_BATCH ?? '120', 10))
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

let postered = 0
let scanned = 0
let failed = 0

// Grab the FIRST frame straight from the R2 mp4 over HTTP. `-frames:v 1` stops after one
// frame, so ffmpeg reads only the start of the file (minimal R2 egress + decode). Scaled
// to 480w to match the grid's CDN size. JPEG to stdout → we never touch disk.
function extractFrame(url: string): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const args = [
      '-y', '-loglevel', 'error',
      '-i', url,
      '-frames:v', '1',
      '-vf', 'scale=480:-1',
      '-f', 'image2', '-vcodec', 'mjpeg',
      'pipe:1',
    ]
    const ff = spawn('ffmpeg', args)
    const chunks: Buffer[] = []
    ff.stdout.on('data', (d) => chunks.push(d as Buffer))
    ff.stderr.on('data', () => {})
    const to = setTimeout(() => { ff.kill('SIGKILL'); resolve(null) }, 25_000)
    ff.on('close', (code) => {
      clearTimeout(to)
      resolve(code === 0 && chunks.length ? Buffer.concat(chunks) : null)
    })
    ff.on('error', () => { clearTimeout(to); resolve(null) })
  })
}

async function processOne(c: { id: string; ad_id: string; position: number; r2_url: string }): Promise<void> {
  const buf = await extractFrame(c.r2_url)
  if (!buf) { failed++; return }              // unreadable / dead mp4 → leave placeholder
  const h = await imageHash(buf).catch(() => null)
  const url = await uploadBufferToR2(buf, `posters/${h || c.id}.jpg`, 'image/jpeg')
  if (!url) { failed++; return }
  await (supabase as any).from('discovery_creatives').update({ poster_url: url }).eq('id', c.id)
  postered++
}

async function main() {
  console.log(`🎞️  mp4-poster started (concurrency=${CONCURRENCY}, batch=${BATCH})`)
  let cursor: string | null = null   // ad_id keyset (INDEXED → fast)
  for (;;) {
    let q = (supabase as any)
      .from('discovery_creatives')
      .select('id, ad_id, position, r2_url')
      .eq('asset_type', 'video')
      .is('poster_url', null)
      .order('ad_id', { ascending: false })   // newest first ≈ feed order → visible videos get posters first
      .limit(BATCH)
    if (cursor) q = q.lt('ad_id', cursor)
    const { data: cres, error } = await q
    if (error) { console.error('query failed:', error.message); break }
    if (!cres?.length) break

    for (let i = 0; i < cres.length; i += CONCURRENCY) {
      const chunk = cres.slice(i, i + CONCURRENCY)
      await Promise.all(chunk.map((c: any) => processOne(c)))
      scanned += chunk.length
      await sleep(200)   // breathe — yield CPU to anything else on the box
    }
    cursor = cres[cres.length - 1].ad_id
    console.log(`  scanned ${scanned} · postered ${postered} · failed ${failed}`)
  }
  console.log(`✅ mp4-poster done — scanned ${scanned}, postered ${postered}, failed ${failed}`)
  process.exit(0)
}

main().catch((e) => { console.error('fatal:', e); process.exit(1) })
