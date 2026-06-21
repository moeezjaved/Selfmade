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
 * Compute a 256-bit average-hash (pHash variant) of an image.
 * Resize to 16x16 grayscale, then 1 bit per pixel based on whether
 * the pixel is above or below the mean.
 *
 * 64-char lowercase hex. 256 bits = ~10^77 possible values, so distinct
 * creatives are extremely unlikely to accidentally collide. Two visually
 * identical re-encodes still produce the same/similar hash.
 */
export async function imageHash(buffer: Buffer): Promise<string | null> {
  try {
    const SIZE = 16
    const PX = SIZE * SIZE  // 256
    const { data } = await sharp(buffer, { failOn: 'none' })
      .resize(SIZE, SIZE, { fit: 'fill' })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true })

    if (data.length < PX) return null

    let total = 0
    for (let i = 0; i < PX; i++) total += data[i]
    const avg = total / PX

    let bits = ''
    for (let i = 0; i < PX; i++) bits += data[i] >= avg ? '1' : '0'

    // Convert binary to 64-char hex (256 bits / 4 bits per hex char)
    let hex = ''
    for (let i = 0; i < PX; i += 4) {
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
 * Original pixel dimensions of an image, for the no-reflow grid. Cheap — sharp
 * reads only the header, not the full decode. Returns null on any failure so a
 * bad image never blocks a creative save (the client falls back to a default
 * aspect when dims are missing).
 */
export async function imageDimensions(
  buffer: Buffer,
): Promise<{ width: number; height: number } | null> {
  try {
    const { width, height } = await sharp(buffer, { failOn: 'none' }).metadata()
    if (!width || !height) return null
    return { width, height }
  } catch {
    return null
  }
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
