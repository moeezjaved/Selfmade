/**
 * Cloudflare R2 media storage — S3-compatible upload helper.
 *
 * Required env vars:
 *   R2_ACCOUNT_ID       — Cloudflare account ID
 *   R2_ACCESS_KEY_ID    — R2 Access Key ID
 *   R2_SECRET_ACCESS_KEY— R2 Secret Access Key
 *   R2_BUCKET_NAME      — bucket name (e.g. "selfmade-ads")
 *   R2_PUBLIC_URL       — public URL prefix (e.g. "https://cdn.tryselfmade.ai")
 *
 * If env vars are missing, uploads are skipped and the function returns null.
 */
import { S3Client, PutObjectCommand, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

let _client: S3Client | null = null

function getClient(): S3Client | null {
  if (_client) return _client
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) return null
  _client = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  })
  return _client
}

export function isR2Configured(): boolean {
  return !!(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET_NAME &&
    process.env.R2_PUBLIC_URL
  )
}

/**
 * Download a URL and upload it to R2. Returns the public R2 URL on success, null on failure.
 * @param sourceUrl  URL to download (fbcdn.net image/video)
 * @param key        R2 object key, e.g. "thumbnails/12345.jpg"
 * @param contentType MIME type, e.g. "image/jpeg" or "video/mp4"
 */
export async function uploadToR2(
  sourceUrl: string,
  key: string,
  contentType: string,
): Promise<string | null> {
  const client = getClient()
  const bucket = process.env.R2_BUCKET_NAME
  const publicUrl = process.env.R2_PUBLIC_URL?.replace(/\/$/, '')
  if (!client || !bucket || !publicUrl) return null

  try {
    // Download source media
    const res = await fetch(sourceUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Referer': 'https://www.facebook.com/',
      },
      signal: AbortSignal.timeout(20000),
    })
    if (!res.ok) return null

    const buffer = await res.arrayBuffer()
    if (buffer.byteLength < 1000) return null // skip tiny/broken files

    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: Buffer.from(buffer),
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    }))

    return `${publicUrl}/${key}`
  } catch {
    return null
  }
}

/** Public URL for a key. */
export function r2PublicUrl(key: string): string | null {
  const p = process.env.R2_PUBLIC_URL?.replace(/\/$/, '')
  return p ? `${p}/${key}` : null
}

/**
 * Presign a PUT so the client can upload the file straight to R2 (never proxied through the app —
 * keeps functions fast for 500 MB videos). Content-type + length are pinned into the signature so the
 * client can't swap the file for a different one. Returns null if R2 isn't configured.
 */
export async function presignPut(key: string, contentType: string, contentLength: number, expiresIn = 300): Promise<string | null> {
  const client = getClient(); const bucket = process.env.R2_BUCKET_NAME
  if (!client || !bucket) return null
  const cmd = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType, ContentLength: contentLength })
  // Cast around @smithy type skew between client-s3 and s3-request-presigner (runtime is identical).
  return getSignedUrl(client as any, cmd as any, { expiresIn })
}

/** Real object size (bytes) from R2, or null if it doesn't exist. Used to verify the client didn't lie. */
export async function headObjectSize(key: string): Promise<number | null> {
  const client = getClient(); const bucket = process.env.R2_BUCKET_NAME
  if (!client || !bucket) return null
  try { const r = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key })); return r.ContentLength ?? null }
  catch { return null }
}

/** Delete an object from R2 (best-effort). */
export async function deleteFromR2(key: string): Promise<void> {
  const client = getClient(); const bucket = process.env.R2_BUCKET_NAME
  if (!client || !bucket) return
  try { await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })) } catch { /* best-effort */ }
}

/**
 * Upload an in-memory buffer (e.g. a base64 image decoded from Gemini) to R2.
 * Returns the public R2 URL on success, null on failure or if R2 isn't configured.
 */
export async function uploadBufferToR2(
  body: Buffer,
  key: string,
  contentType: string,
): Promise<string | null> {
  const client = getClient()
  const bucket = process.env.R2_BUCKET_NAME
  const publicUrl = process.env.R2_PUBLIC_URL?.replace(/\/$/, '')
  if (!client || !bucket || !publicUrl) return null
  try {
    await client.send(new PutObjectCommand({
      Bucket: bucket, Key: key, Body: body, ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    }))
    return `${publicUrl}/${key}`
  } catch {
    return null
  }
}
