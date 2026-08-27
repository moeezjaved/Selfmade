/**
 * R2 storage helpers — upload to R2.
 *
 * Downloads happen elsewhere now:
 *   - Fast path:   worker/src/proxied-fetch.ts (undici + per-ad sticky session)
 *   - Legacy path: worker/src/extract.ts inside the browser context
 *
 * The old downloadFromCDN here used bare Node fetch from the droplet's
 * direct IP, which Meta's CDN gated with 1087-byte placeholders 100% of
 * the time. Removed to kill log noise + make the data flow obvious.
 */
import { S3Client, PutObjectCommand, DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
import { NodeHttpHandler } from '@smithy/node-http-handler'
import { Agent } from 'node:https'
import sharp from 'sharp'
import { config } from './config.js'

// R2 upload socket pool. The AWS SDK defaults to maxSockets=50, which caps concurrent uploads — at
// drain concurrency 24+ the pool saturates, hundreds of uploads queue ("socket usage at capacity=50"),
// and the backpressure surfaces as `saveCreatives failed: fetch failed`. Raising it (+ keepAlive) lets
// the drain actually use the box instead of being upload-bound. Env-tunable via R2_MAX_SOCKETS.
const R2_MAX_SOCKETS = parseInt(process.env.R2_MAX_SOCKETS || '256', 10)

const client = new S3Client({
  region: 'auto',
  endpoint: `https://${config.r2.accountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: config.r2.accessKeyId,
    secretAccessKey: config.r2.secretAccessKey,
  },
  requestHandler: new NodeHttpHandler({
    httpsAgent: new Agent({ keepAlive: true, maxSockets: R2_MAX_SOCKETS }),
    // Without these a stalled socket hangs forever — a single frozen DeleteObjects call froze a whole
    // 2.1M-object purge for 4 hours. Time out and let the retry logic recover instead.
    connectionTimeout: 10_000,
    requestTimeout: 30_000,
  }),
  maxAttempts: 3,
})

/**
 * Upload an already-downloaded buffer to R2.
 */
export async function uploadBufferToR2(
  buffer: Buffer,
  key: string,
  contentType: string,
): Promise<string | null> {
  try {
    await client.send(new PutObjectCommand({
      Bucket: config.r2.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    }))
    return `${config.r2.publicUrl}/${key}`
  } catch (err) {
    console.warn(`  ⚠️  R2 upload failed for ${key}:`, err instanceof Error ? err.message : err)
    return null
  }
}

/** Turn a public R2 URL back into its object key (strips the public-URL prefix). Null if it isn't ours. */
export function r2UrlToKey(url: string | null | undefined): string | null {
  if (!url) return null
  const base = `${config.r2.publicUrl}/`
  if (url.startsWith(base)) return url.slice(base.length)
  // Fallbacks for older rows saved under the raw r2.dev / cloudflarestorage host.
  const m = url.match(/\.r2\.dev\/(.+)$/) || url.match(/\.r2\.cloudflarestorage\.com\/[^/]+\/(.+)$/)
  return m ? m[1] : null
}

/**
 * List every object under a prefix, returning a Map of key → size (bytes). Used by the video purge to
 * price the reclaim (GB) accurately without a HEAD per object. Paginates 1000 at a time.
 */
export async function listSizesByPrefix(prefix: string, onProgress?: (count: number, bytes: number) => void): Promise<Map<string, number>> {
  const sizes = new Map<string, number>()
  let token: string | undefined
  let bytes = 0
  do {
    const res = await client.send(new ListObjectsV2Command({ Bucket: config.r2.bucket, Prefix: prefix, ContinuationToken: token, MaxKeys: 1000 }))
    for (const o of res.Contents || []) if (o.Key) { sizes.set(o.Key, o.Size || 0); bytes += o.Size || 0 }
    token = res.IsTruncated ? res.NextContinuationToken : undefined
    if (onProgress && sizes.size % 50000 < 1000) onProgress(sizes.size, bytes)
  } while (token)
  return sizes
}

/**
 * Delete objects by key, batched (S3 DeleteObjects caps at 1000/call) and run CONCURRENTLY with per-batch
 * retry + progress logging. Best-effort: logs and continues on a batch error so a purge always makes
 * progress and can never freeze on one stalled request (the client now has request timeouts + retries).
 * @param onProgress called after each batch with the running deleted count and the total.
 */
export async function deleteManyFromR2(keys: string[], onProgress?: (deleted: number, total: number) => void): Promise<number> {
  const CONCURRENCY = parseInt(process.env.R2_DELETE_CONCURRENCY || '12', 10)
  const batches: string[][] = []
  for (let i = 0; i < keys.length; i += 1000) batches.push(keys.slice(i, i + 1000))

  let deleted = 0
  let next = 0
  const total = keys.length

  const deleteBatch = async (batch: string[]): Promise<void> => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await client.send(new DeleteObjectsCommand({ Bucket: config.r2.bucket, Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true } }))
        deleted += batch.length - (res.Errors?.length || 0)
        if (res.Errors?.length) console.warn(`  ⚠️  ${res.Errors.length} delete errors in batch (e.g. ${res.Errors[0].Key}: ${res.Errors[0].Message})`)
        return
      } catch (err) {
        if (attempt === 3) { console.warn(`  ⚠️  R2 batch delete failed after 3 tries:`, err instanceof Error ? err.message : err); return }
        await new Promise((r) => setTimeout(r, 500 * attempt))   // small backoff, then retry
      }
    }
  }

  // Worker pool: CONCURRENCY workers each pull the next batch until none remain.
  const worker = async (): Promise<void> => {
    while (true) {
      const idx = next++
      if (idx >= batches.length) return
      await deleteBatch(batches[idx])
      if (onProgress && (idx % 20 === 0 || deleted >= total - 1000)) onProgress(deleted, total)
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, () => worker()))
  onProgress?.(deleted, total)
  return deleted
}

/**
 * B — pre-resized thumbnail. Resize an image buffer to a 480px-wide webp and upload it, keyed by
 * the creative HASH (deterministic + deduped: the same creative across many ads = one thumb).
 * Returns the thumb URL. This is the scale-proof fast-image fix: ~30KB webp vs the 300KB–1.8MB
 * full-res original, served straight from R2's edge. Best-effort — null if sharp can't decode.
 */
export async function uploadThumb(buffer: Buffer, hash: string): Promise<string | null> {
  try {
    const webp = await sharp(buffer, { failOn: 'none' })
      .resize(480, null, { withoutEnlargement: true, kernel: 'cubic' })   // cubic ~ faster than lanczos, fine at 480px
      .webp({ quality: 72, effort: 0 })                                    // effort 0 = fastest encode (CPU-bound backfill)
      .toBuffer()
    return await uploadBufferToR2(webp, `thumbs/${hash}.webp`, 'image/webp')
  } catch (err) {
    console.warn(`  ⚠️  thumb gen failed (${hash}):`, err instanceof Error ? err.message : err)
    return null
  }
}

