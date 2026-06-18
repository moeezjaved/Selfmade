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
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

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
