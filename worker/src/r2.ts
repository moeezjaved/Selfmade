/**
 * R2 storage helpers — download from FB CDN, upload to R2.
 * Split into separate steps so we can hash + dedupe between them.
 */
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { config } from './config.js'

const client = new S3Client({
  region: 'auto',
  endpoint: `https://${config.r2.accountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: config.r2.accessKeyId,
    secretAccessKey: config.r2.secretAccessKey,
  },
})

/**
 * Download a file from Facebook's CDN. Returns Buffer or null on failure.
 */
export async function downloadFromCDN(
  cdnUrl: string,
  contentType: string,
): Promise<Buffer | null> {
  try {
    const res = await fetch(cdnUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Referer': 'https://www.facebook.com/',
        'Accept': contentType.startsWith('video') ? 'video/*,*/*;q=0.8' : 'image/*,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) {
      console.warn(`  ⚠️  CDN download failed: HTTP ${res.status}`)
      return null
    }
    const buffer = Buffer.from(await res.arrayBuffer())
    if (buffer.byteLength < 2000) {
      console.warn(`  ⚠️  File too small (${buffer.byteLength} bytes), skipping`)
      return null
    }
    return buffer
  } catch (err) {
    console.warn(`  ⚠️  CDN download error:`, err instanceof Error ? err.message : err)
    return null
  }
}

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

/**
 * Convenience: download → upload in one call (no dedup, used as fallback).
 */
export async function downloadAndUploadToR2(
  cdnUrl: string,
  key: string,
  contentType: string,
): Promise<string | null> {
  const buf = await downloadFromCDN(cdnUrl, contentType)
  if (!buf) return null
  return uploadBufferToR2(buf, key, contentType)
}
