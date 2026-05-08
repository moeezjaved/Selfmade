/**
 * R2 storage helpers — download from FB CDN, upload to R2.
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

export async function downloadAndUploadToR2(
  cdnUrl: string,
  key: string,
  contentType: string,
): Promise<string | null> {
  try {
    // Download from Facebook CDN
    const res = await fetch(cdnUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Referer': 'https://www.facebook.com/',
        'Accept': contentType.startsWith('video') ? 'video/*,*/*;q=0.8' : 'image/*,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) {
      console.warn(`  ⚠️  CDN download failed: HTTP ${res.status} for ${key}`)
      return null
    }

    const buffer = Buffer.from(await res.arrayBuffer())
    if (buffer.byteLength < 2000) {
      console.warn(`  ⚠️  File too small (${buffer.byteLength} bytes), skipping ${key}`)
      return null
    }

    // Upload to R2
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
