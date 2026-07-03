/**
 * Persist brand product photos into R2 so they're permanent and editable inside the brand.
 * Input can be data: URLs (manual uploads) or http(s) URLs (auto-detected from the user's website).
 * Detected website images are hotlinks that can rot or be blocked — copying them into our own R2
 * bucket means the brand's photos keep working forever. Best-effort per image; on R2 failure an
 * http source is kept as-is so the user still sees something.
 */
import { randomUUID } from 'node:crypto'
import { uploadToR2, uploadBufferToR2 } from '@/lib/r2'

export async function persistImagesToR2(userId: string, images: string[]): Promise<string[]> {
  const out: string[] = []
  const list = (images || []).filter((s) => typeof s === 'string' && s.trim()).slice(0, 24)
  for (let i = 0; i < list.length; i++) {
    const src = list[i]
    const base = `brand-products/${userId}/${randomUUID()}`
    try {
      const m = /^data:([^;]+);base64,([\s\S]*)$/i.exec(src)
      if (m) {
        const mime = m[1] || 'image/jpeg'
        const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg'
        const url = await uploadBufferToR2(Buffer.from(m[2], 'base64'), `${base}.${ext}`, mime)
        if (url) out.push(url)
      } else if (/^https?:\/\//i.test(src)) {
        const url = await uploadToR2(src, `${base}.jpg`, 'image/jpeg')
        out.push(url || src) // fall back to the original link if the copy fails
      }
    } catch {
      if (/^https?:\/\//i.test(src)) out.push(src)
    }
  }
  return out
}
