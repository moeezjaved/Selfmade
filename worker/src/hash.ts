/**
 * Perceptual hashing for creative deduplication.
 *
 * - pHash for images: 16-char hex. Same value for visually identical
 *   images even when re-encoded/resized (Hamming distance < 6 = likely same).
 * - MD5 for videos: 32-char hex. Exact byte match (videos rarely re-encoded
 *   between ad variants — different ads using the same video upload have
 *   the same MD5).
 */
import { createHash } from 'node:crypto'
import sharp from 'sharp'

/**
 * Compute a 64-bit average-hash (a pHash variant) of an image.
 * Resize to 8x8 grayscale, then 1 bit per pixel based on whether
 * the pixel is above or below the mean.
 *
 * Returns 16-char lowercase hex (e.g. "ff00ee2a994c1ed3").
 */
export async function imageHash(buffer: Buffer): Promise<string | null> {
  try {
    const { data } = await sharp(buffer, { failOn: 'none' })
      .resize(8, 8, { fit: 'fill' })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true })

    if (data.length < 64) return null

    let total = 0
    for (let i = 0; i < 64; i++) total += data[i]
    const avg = total / 64

    let bits = ''
    for (let i = 0; i < 64; i++) bits += data[i] >= avg ? '1' : '0'

    // Convert binary to 16-char hex
    let hex = ''
    for (let i = 0; i < 64; i += 4) {
      hex += parseInt(bits.slice(i, i + 4), 2).toString(16)
    }
    return hex
  } catch {
    return null
  }
}

export function videoHash(buffer: Buffer): string {
  return createHash('md5').update(buffer).digest('hex')
}

/**
 * Hamming distance between two equal-length hex hashes.
 * Useful for fuzzy matching (e.g. distance < 6 = visually identical).
 */
export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) return Infinity
  let dist = 0
  for (let i = 0; i < a.length; i++) {
    let xor = parseInt(a[i], 16) ^ parseInt(b[i], 16)
    while (xor) {
      dist += xor & 1
      xor >>= 1
    }
  }
  return dist
}
