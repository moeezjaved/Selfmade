/**
 * Assets AI enrichment (spec §10.3): caption an uploaded asset + embed it for semantic/visual search.
 * Images → Gemini vision caption. Video/audio → filename-based text (frame-level captioning is a later
 * upgrade). The caption + filename is embedded with OpenAI text-embedding-3-small (1536-d), matching
 * the rest of the app's vectors.
 */
const GEMINI_KEY = process.env.GEMINI_API_KEY
const GEMINI_MODEL = process.env.GEMINI_VISION_MODEL || 'gemini-2.5-flash'
const OPENAI_KEY = process.env.OPENAI_API_KEY

/** One-line-plus-elements caption for an image, for search. Null if unavailable. */
export async function captionImage(fileUrl: string, mime: string): Promise<string | null> {
  if (!GEMINI_KEY) return null
  try {
    const res = await fetch(fileUrl, { signal: AbortSignal.timeout(20000) })
    if (!res.ok) return null
    const b64 = Buffer.from(await res.arrayBuffer()).toString('base64')
    const prompt = 'Describe this marketing creative for a searchable media library. In 1–2 sentences cover: the product/subject, the visual style, any people/creators, and any on-screen text or captions. Be concrete and use the words a marketer would search for. Plain text only.'
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: b64 } }] }] }),
      signal: AbortSignal.timeout(30000),
    })
    if (!r.ok) return null
    const j = await r.json()
    const text = j?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join(' ').trim()
    return text || null
  } catch { return null }
}

/** Embed text with text-embedding-3-small (1536-d). Null if unavailable. */
export async function embedText(text: string): Promise<number[] | null> {
  if (!OPENAI_KEY || !text.trim()) return null
  try {
    const r = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST', headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'text-embedding-3-small', input: text.slice(0, 8000) }),
      signal: AbortSignal.timeout(20000),
    })
    if (!r.ok) return null
    const j = await r.json()
    return j?.data?.[0]?.embedding ?? null
  } catch { return null }
}

export interface VideoClip { caption: string | null; has_captions: boolean | null; audio_kind: string | null; scene: string | null; roll: string | null }

/**
 * Analyze a short video with Gemini video understanding → structured clip attributes that power the
 * Scene / Caption / Audio / A-B-roll filters. Inline (base64) is capped ~18MB per Gemini's request
 * limit; larger videos are skipped (still searchable by filename). Best-effort — nulls on failure.
 */
export async function analyzeVideo(fileUrl: string, mime: string, sizeBytes: number): Promise<VideoClip> {
  const empty: VideoClip = { caption: null, has_captions: null, audio_kind: null, scene: null, roll: null }
  if (!GEMINI_KEY || sizeBytes > 18_000_000) return empty
  try {
    const res = await fetch(fileUrl, { signal: AbortSignal.timeout(30000) })
    if (!res.ok) return empty
    const b64 = Buffer.from(await res.arrayBuffer()).toString('base64')
    const prompt = `Analyze this short marketing video clip for a media library. Return ONLY minified JSON, no prose:
{"caption":"1-2 sentence description for search: product, visual style, people/creator, and any on-screen text","has_captions":true or false (are there burned-in captions / on-screen text?),"audio_kind":"voiceover" or "music" or "silent" (dominant audio),"scene":"unboxing" or "talking_head" or "lifestyle" or "product_demo" or "other","roll":"a_roll" (a person talking to camera) or "b_roll" (supplementary/product footage, no direct address)}`
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: b64 } }] }] }),
      signal: AbortSignal.timeout(120000),
    })
    if (!r.ok) return empty
    const j = await r.json()
    const text = (j?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') || '').trim()
    const m = text.match(/\{[\s\S]*\}/); if (!m) return empty
    const o = JSON.parse(m[0])
    const oneOf = (v: any, allow: string[]) => (typeof v === 'string' && allow.includes(v)) ? v : null
    return {
      caption: typeof o.caption === 'string' ? o.caption.slice(0, 600) : null,
      has_captions: typeof o.has_captions === 'boolean' ? o.has_captions : null,
      audio_kind: oneOf(o.audio_kind, ['voiceover', 'music', 'silent']),
      scene: oneOf(o.scene, ['unboxing', 'talking_head', 'lifestyle', 'product_demo', 'other']),
      roll: oneOf(o.roll, ['a_roll', 'b_roll']),
    }
  } catch { return empty }
}

/** Caption + embed + (for video) clip attributes. Returns the fields to persist. Best-effort. */
export async function enrichAsset(a: { file_url: string; mime: string | null; file_type: string | null; file_name: string | null; size_bytes?: number })
  : Promise<{ ai_caption: string | null; embedding: number[] | null } & Partial<VideoClip>> {
  let caption: string | null = null
  let clip: VideoClip = { caption: null, has_captions: null, audio_kind: null, scene: null, roll: null }
  if (a.file_type === 'image' && a.file_url && a.mime) {
    caption = await captionImage(a.file_url, a.mime)
  } else if (a.file_type === 'video' && a.file_url && a.mime) {
    clip = await analyzeVideo(a.file_url, a.mime, a.size_bytes || 0)
    caption = clip.caption
  }
  // Embed caption + filename so even un-captioned/large video/audio is findable by name.
  const text = [caption, a.file_name].filter(Boolean).join(' — ')
  const embedding = text ? await embedText(text) : null
  return { ai_caption: caption, embedding, has_captions: clip.has_captions, audio_kind: clip.audio_kind, scene: clip.scene, roll: clip.roll }
}
