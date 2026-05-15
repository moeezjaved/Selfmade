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

