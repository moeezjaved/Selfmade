/**
 * Veo image-to-video (Animate). Long-running: start() kicks off the job and returns an operation
 * handle; poll() checks it and, when done, downloads the MP4 bytes. Uses the same GEMINI_API_KEY.
 * Model is env-configurable (default Veo 3.1 fast — cheapest good tier).
 *
 * Env: GEMINI_API_KEY, GEMINI_VIDEO_MODEL (default 'veo-3.1-fast-generate-preview'), GEMINI_VIDEO_RES ('720p').
 */
const KEY = process.env.GEMINI_API_KEY
const MODEL = process.env.GEMINI_VIDEO_MODEL || 'veo-3.1-fast-generate-preview'
const RES = process.env.GEMINI_VIDEO_RES || '720p'
const BASE = 'https://generativelanguage.googleapis.com/v1beta'

export const veoEnabled = !!KEY

export type StartResult = { ok: true; operation: string } | { ok: false; error: string }
export type PollResult = { done: false } | { done: true; error?: string; videoB64?: string; mimeType?: string }

/** Kick off a video generation from a still image + motion prompt. Returns the operation name. */
export async function startVideo(prompt: string, image: { mimeType: string; dataB64: string }, opts?: { aspectRatio?: string; resolution?: string }): Promise<StartResult> {
  if (!KEY) return { ok: false, error: 'GEMINI_API_KEY not set' }
  const ar = opts?.aspectRatio && opts.aspectRatio !== 'original' ? opts.aspectRatio : '9:16'
  const body = {
    instances: [{ prompt, image: { bytesBase64Encoded: image.dataB64, mimeType: image.mimeType || 'image/png' } }],
    parameters: { aspectRatio: ar, resolution: opts?.resolution || RES, sampleCount: 1 },
  }
  try {
    const r = await fetch(`${BASE}/models/${MODEL}:predictLongRunning?key=${KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const text = await r.text()
    if (!r.ok) return { ok: false, error: `veo ${r.status} [${MODEL}]: ${text.slice(0, 240)}` }
    const j = JSON.parse(text)
    if (!j.name) return { ok: false, error: `veo: no operation name — ${text.slice(0, 200)}` }
    return { ok: true, operation: j.name }
  } catch (e: any) { return { ok: false, error: String(e?.message || e) } }
}

/** Poll a running operation. When done, downloads the MP4 and returns base64. */
export async function pollVideo(operation: string): Promise<PollResult> {
  if (!KEY) return { done: true, error: 'GEMINI_API_KEY not set' }
  try {
    const r = await fetch(`${BASE}/${operation}?key=${KEY}`)
    const j = await r.json()
    if (!j.done) return { done: false }
    if (j.error) return { done: true, error: JSON.stringify(j.error).slice(0, 240) }

    const resp = j.response || {}
    const sample = resp.generateVideoResponse?.generatedSamples?.[0]
      || resp.generatedSamples?.[0] || resp.videos?.[0] || resp.predictions?.[0]
    const uri: string | undefined = sample?.video?.uri || sample?.uri || sample?.videoUri
    const inline: string | undefined = sample?.video?.bytesBase64Encoded || sample?.bytesBase64Encoded

    if (inline) return { done: true, videoB64: inline, mimeType: 'video/mp4' }
    if (uri) {
      const dl = uri.includes('key=') ? uri : `${uri}${uri.includes('?') ? '&' : '?'}key=${KEY}`
      const vr = await fetch(dl)
      if (!vr.ok) return { done: true, error: `video download ${vr.status}` }
      const buf = Buffer.from(await vr.arrayBuffer())
      return { done: true, videoB64: buf.toString('base64'), mimeType: vr.headers.get('content-type') || 'video/mp4' }
    }
    return { done: true, error: `no video in response: ${JSON.stringify(j).slice(0, 300)}` }
  } catch (e: any) { return { done: true, error: String(e?.message || e) } }
}

/** Motion prompt for animating a static ad — subtle, ad-appropriate, keeps the product legible. */
export function buildAnimatePrompt(style: string): string {
  const styles: Record<string, string> = {
    subtle: 'Add subtle, premium motion to this ad image: a slow gentle camera push-in and soft ambient movement. Keep all text crisp and readable, keep the product still and in focus. No new elements, no text changes.',
    hero: 'Animate this ad as a product hero shot: slow rotate/parallax around the product with soft studio lighting shifts. Keep text legible and the product the clear focus. No new elements.',
    lifestyle: 'Bring this ad to life with natural lifestyle motion in the background (gentle environment movement) while the product and text stay sharp and still. Realistic, on-brand, no text changes.',
  }
  return styles[style] || styles.subtle
}
