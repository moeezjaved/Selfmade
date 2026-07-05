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

/** Caption + embed one asset; returns the fields to persist. Best-effort (nulls on failure). */
export async function enrichAsset(a: { file_url: string; mime: string | null; file_type: string | null; file_name: string | null })
  : Promise<{ ai_caption: string | null; embedding: number[] | null }> {
  const caption = a.file_type === 'image' && a.file_url && a.mime ? await captionImage(a.file_url, a.mime) : null
  // Embed caption + filename so even un-captioned video/audio is findable by name.
  const text = [caption, a.file_name].filter(Boolean).join(' — ')
  const embedding = text ? await embedText(text) : null
  return { ai_caption: caption, embedding }
}
