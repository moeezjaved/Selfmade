/**
 * GEO engines — ask a real AI answer engine a buyer question and return its answer text, so we can check
 * whether the brand is cited. Each engine self-reports availability by its API key, so a sweep only ever
 * runs the engines that are actually configured (honest — we never fake an engine we can't call).
 *
 *   chatgpt    → OpenAI. Tries the web-search tool (live citations); falls back to model knowledge.
 *   gemini     → Google Gemini with google_search grounding; falls back to plain.
 *   perplexity → Perplexity Sonar (always web-grounded). Only if PERPLEXITY_API_KEY is set.
 *
 * `grounded` tells the UI whether the answer was live-web (a real citation) or the model's baseline
 * knowledge — we surface that difference rather than overclaim.
 */
import OpenAI from 'openai'

export type GeoEngine = 'chatgpt' | 'gemini' | 'perplexity'
export type EngineAnswer = { engine: GeoEngine; text: string; grounded: boolean }

export const ENGINE_LABEL: Record<GeoEngine, string> = { chatgpt: 'ChatGPT', gemini: 'Gemini', perplexity: 'Perplexity' }

export function availableEngines(): GeoEngine[] {
  const out: GeoEngine[] = []
  if (process.env.OPENAI_API_KEY) out.push('chatgpt')
  if (process.env.GEMINI_API_KEY) out.push('gemini')
  if (process.env.PERPLEXITY_API_KEY) out.push('perplexity')
  return out
}

let _oai: OpenAI | null = null
const oai = () => (_oai ||= new OpenAI({ apiKey: process.env.OPENAI_API_KEY }))

export async function askEngine(engine: GeoEngine, prompt: string): Promise<EngineAnswer | null> {
  try {
    if (engine === 'chatgpt') return await askOpenAI(prompt)
    if (engine === 'gemini') return await askGemini(prompt)
    if (engine === 'perplexity') return await askPerplexity(prompt)
  } catch { /* engine hiccup → skip this one, sweep continues */ }
  return null
}

async function askOpenAI(prompt: string): Promise<EngineAnswer> {
  // Prefer the Responses API with the web-search tool → REAL live citations (like ChatGPT-with-search).
  // The tool type was renamed across SDK versions, so try both names before falling back to model knowledge.
  for (const toolType of ['web_search', 'web_search_preview']) {
    try {
      const res: any = await (oai() as any).responses.create({ model: 'gpt-4o', tools: [{ type: toolType }], input: prompt })
      const text = res?.output_text || textFromResponses(res)
      if (text) return { engine: 'chatgpt', text, grounded: true }
    } catch { /* try next tool name / fall through */ }
  }
  const c = await oai().chat.completions.create({ model: 'gpt-4o', temperature: 0, messages: [{ role: 'user', content: prompt }] })
  return { engine: 'chatgpt', text: c.choices[0]?.message?.content || '', grounded: false }
}

function textFromResponses(res: any): string {
  try {
    const out = res?.output || []
    const parts: string[] = []
    for (const item of out) for (const c of (item?.content || [])) if (typeof c?.text === 'string') parts.push(c.text)
    return parts.join(' ')
  } catch { return '' }
}

async function askGemini(prompt: string): Promise<EngineAnswer> {
  const KEY = process.env.GEMINI_API_KEY
  const MODEL = process.env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash'
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`
  const run = async (withSearch: boolean) => {
    const body: any = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0 } }
    if (withSearch) body.tools = [{ google_search: {} }]
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const j: any = await r.json()
    const text = (j?.candidates?.[0]?.content?.parts || []).map((p: any) => p?.text).filter(Boolean).join(' ')
    return text || ''
  }
  try { const t = await run(true); if (t) return { engine: 'gemini', text: t, grounded: true } } catch { /* grounding unsupported → plain */ }
  return { engine: 'gemini', text: await run(false), grounded: false }
}

async function askPerplexity(prompt: string): Promise<EngineAnswer> {
  const r = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: process.env.PERPLEXITY_MODEL || 'sonar', messages: [{ role: 'user', content: prompt }] }),
  })
  const j: any = await r.json()
  return { engine: 'perplexity', text: j?.choices?.[0]?.message?.content || '', grounded: true }
}
