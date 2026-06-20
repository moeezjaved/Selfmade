/**
 * On-disk cache for Facebook's static JS/CSS bundles (static.xx.fbcdn.net).
 *
 * The Ads Library page re-downloads ~1-2 MB of the SAME versioned JS/CSS on every
 * crawl, all through the metered IPRoyal proxy (~60% of post-video-block proxy
 * cost). Those URLs are content-hashed by Facebook, so caching by URL is safe — a
 * new bundle version is a new URL (cache miss → fresh fetch); the old URL is never
 * requested again. After the cache warms up, ~all JS/CSS serves from local disk
 * and never touches IPRoyal.
 *
 * Shared across the concurrent crawl SUBPROCESSES (scheduler spawns one indexer
 * process per brand) via the filesystem. Writes are atomic (temp + rename) so a
 * reader never sees a half-written file. Best-effort throughout — any cache error
 * just falls back to a normal proxied load.
 *
 * NOTE: we store the DECODED body + strip content-encoding/length, so fulfilling
 * from cache can't trip a gzip mismatch.
 */
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

const CACHE_DIR = process.env.ASSET_CACHE_DIR || '/tmp/fb-asset-cache'
let dirReady = false
async function ensureDir(): Promise<void> {
  if (dirReady) return
  await fs.mkdir(CACHE_DIR, { recursive: true })
  dirReady = true
}

function keyFor(url: string): string {
  return createHash('sha256').update(url).digest('hex').slice(0, 40)
}

/** Only static, versioned FB assets — never GraphQL (www.facebook.com) or HTML. */
export function isCacheableAsset(url: string): boolean {
  try { return new URL(url).hostname === 'static.xx.fbcdn.net' } catch { return false }
}

export interface CachedAsset {
  status: number
  headers: Record<string, string>
  body: Buffer
}

export async function readAsset(url: string): Promise<CachedAsset | null> {
  try {
    await ensureDir()
    const base = path.join(CACHE_DIR, keyFor(url))
    const [body, metaRaw] = await Promise.all([
      fs.readFile(base + '.bin'),
      fs.readFile(base + '.json', 'utf8'),
    ])
    const meta = JSON.parse(metaRaw)
    return { status: meta.status, headers: meta.headers, body }
  } catch {
    return null
  }
}

export async function writeAsset(url: string, status: number, rawHeaders: Record<string, string>, body: Buffer): Promise<void> {
  if (status !== 200 || body.length === 0) return   // only cache real 200s
  try {
    await ensureDir()
    const base = path.join(CACHE_DIR, keyFor(url))
    // store the DECODED body — strip encoding/length so a cache-fulfill can't
    // claim gzip on already-decoded bytes.
    const headers: Record<string, string> = { ...rawHeaders }
    delete headers['content-encoding']
    delete headers['content-length']
    const tmp = `${base}.${process.pid}.tmp`
    await fs.writeFile(tmp, body)
    await fs.rename(tmp, base + '.bin')              // atomic
    await fs.writeFile(tmp + '.j', JSON.stringify({ status, headers }))
    await fs.rename(tmp + '.j', base + '.json')      // atomic
  } catch {
    /* best-effort cache; ignore */
  }
}
