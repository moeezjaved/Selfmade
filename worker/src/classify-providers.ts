/**
 * Batch classification providers — swap the model/vendor behind one interface so
 * the copy_sig pipeline (prompt, parse, fan-out) never changes. Select via env:
 *
 *   CLASSIFY_PROVIDER=openai   (default model gpt-4o-mini — ~8× cheaper output than Haiku)
 *   CLASSIFY_PROVIDER=anthropic (model claude-haiku-4-5)
 *
 * Both expose: submit (async batch) → isDone (poll) → results (parsed) → list (adopt).
 * OpenAI additionally uses Structured Outputs (json_schema) so the JSON is guaranteed
 * valid against our enums — no malformed-output parse failures.
 */
import { parseClassification, HOOKS, ANGLES, TONES, EMOTIONS } from './classify-core.js'

export interface SubmitRequest { customId: string; prompt: string }
export interface BatchResult { items: any[]; inTok: number; outTok: number }
export interface BatchListing { id: string; done: boolean }

export interface ClassifyProvider {
  name: string
  model: string
  priceIn: number    // $/1M input tokens (standard; Batch API halves it)
  priceOut: number   // $/1M output tokens
  submit(requests: SubmitRequest[]): Promise<string>
  isDone(batchId: string): Promise<{ done: boolean; status: string; counts?: any }>
  results(batchId: string): Promise<BatchResult[]>
  list(limit?: number): Promise<BatchListing[]>
}

// ── Anthropic (Message Batches API) ──────────────────────────────────────────
class AnthropicProvider implements ClassifyProvider {
  name = 'anthropic'
  model = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5'
  priceIn = 1; priceOut = 5
  private key = process.env.ANTHROPIC_API_KEY!
  private base = 'https://api.anthropic.com/v1/messages/batches'
  private h() { return { 'x-api-key': this.key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' } }

  async submit(requests: SubmitRequest[]): Promise<string> {
    const body = {
      requests: requests.map(r => ({
        custom_id: r.customId,
        params: { model: this.model, max_tokens: 6000, messages: [{ role: 'user', content: r.prompt }] },
      })),
    }
    const res = await fetch(this.base, { method: 'POST', headers: this.h(), body: JSON.stringify(body) })
    const data = await res.json()
    if (!data.id) throw new Error(`anthropic batch submit failed: ${JSON.stringify(data).slice(0, 300)}`)
    return data.id
  }
  async isDone(id: string) {
    const b = await (await fetch(`${this.base}/${id}`, { headers: this.h() })).json()
    return { done: b.processing_status === 'ended', status: b.processing_status || '?', counts: b.request_counts }
  }
  async results(id: string): Promise<BatchResult[]> {
    const b = await (await fetch(`${this.base}/${id}`, { headers: this.h() })).json()
    if (!b.results_url) return []
    const jsonl = await (await fetch(b.results_url, { headers: this.h() })).text()
    const out: BatchResult[] = []
    for (const line of jsonl.split('\n')) {
      if (!line.trim()) continue
      let row: any; try { row = JSON.parse(line) } catch { continue }
      const r = row.result
      if (r?.type !== 'succeeded' || !r.message) continue
      const u = r.message.usage || {}
      out.push({ items: parseClassification(r.message.content?.[0]?.text || ''), inTok: u.input_tokens || 0, outTok: u.output_tokens || 0 })
    }
    return out
  }
  async list(limit = 20): Promise<BatchListing[]> {
    const d = await (await fetch(`${this.base}?limit=${limit}`, { headers: this.h() })).json()
    return (d.data || []).map((b: any) => ({ id: b.id, done: b.processing_status === 'ended' }))
  }
}

// ── OpenAI (Batch API + Structured Outputs) ──────────────────────────────────
const OPENAI_SCHEMA = {
  name: 'ad_classifications',
  strict: true,
  schema: {
    type: 'object', additionalProperties: false, required: ['results'],
    properties: {
      results: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['id', 'hook_type', 'emotion', 'angle', 'cta', 'tone', 'persona', 'desire', 'usp', 'topics'],
          properties: {
            id: { type: 'string' },
            hook_type: { type: 'string', enum: [...HOOKS] },
            emotion: { type: 'array', items: { type: 'string', enum: [...EMOTIONS] } },
            angle: { type: 'string', enum: [...ANGLES] },
            cta: { type: 'string' },
            tone: { type: 'string', enum: [...TONES] },
            persona: { type: 'string' },
            desire: { type: 'string' },
            usp: { type: 'string' },
            topics: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
  },
}

class OpenAIProvider implements ClassifyProvider {
  name = 'openai'
  model = process.env.OPENAI_MODEL || 'gpt-4o-mini'
  priceIn = 0.15; priceOut = 0.60   // gpt-4o-mini; nano ≈ 0.10/0.40
  private key = process.env.OPENAI_API_KEY!
  private base = 'https://api.openai.com/v1'
  private auth() { return { Authorization: `Bearer ${this.key}` } }

  async submit(requests: SubmitRequest[]): Promise<string> {
    // 1) build JSONL of chat-completion requests with structured output
    const jsonl = requests.map(r => JSON.stringify({
      custom_id: r.customId,
      method: 'POST',
      url: '/v1/chat/completions',
      body: {
        model: this.model,
        messages: [{ role: 'user', content: r.prompt }],
        response_format: { type: 'json_schema', json_schema: OPENAI_SCHEMA },
      },
    })).join('\n')
    // 2) upload the file (multipart)
    const fd = new FormData()
    fd.append('purpose', 'batch')
    fd.append('file', new Blob([jsonl], { type: 'application/jsonl' }), 'batch.jsonl')
    const up = await (await fetch(`${this.base}/files`, { method: 'POST', headers: this.auth(), body: fd })).json()
    if (!up.id) throw new Error(`openai file upload failed: ${JSON.stringify(up).slice(0, 300)}`)
    // 3) create the batch
    const b = await (await fetch(`${this.base}/batches`, {
      method: 'POST', headers: { ...this.auth(), 'content-type': 'application/json' },
      body: JSON.stringify({ input_file_id: up.id, endpoint: '/v1/chat/completions', completion_window: '24h' }),
    })).json()
    if (!b.id) throw new Error(`openai batch create failed: ${JSON.stringify(b).slice(0, 300)}`)
    return b.id
  }
  async isDone(id: string) {
    const b = await (await fetch(`${this.base}/batches/${id}`, { headers: this.auth() })).json()
    const terminal = ['completed', 'failed', 'expired', 'cancelled']
    return { done: terminal.includes(b.status), status: b.status || '?', counts: b.request_counts }
  }
  async results(id: string): Promise<BatchResult[]> {
    const b = await (await fetch(`${this.base}/batches/${id}`, { headers: this.auth() })).json()
    if (!b.output_file_id) return []
    const jsonl = await (await fetch(`${this.base}/files/${b.output_file_id}/content`, { headers: this.auth() })).text()
    const out: BatchResult[] = []
    for (const line of jsonl.split('\n')) {
      if (!line.trim()) continue
      let row: any; try { row = JSON.parse(line) } catch { continue }
      const body = row.response?.body
      const msg = body?.choices?.[0]?.message
      if (!msg || msg.refusal) continue
      let items: any[] = []
      try { items = JSON.parse(msg.content || '{}').results || [] } catch { items = [] }
      const u = body.usage || {}
      out.push({ items, inTok: u.prompt_tokens || 0, outTok: u.completion_tokens || 0 })
    }
    return out
  }
  async list(limit = 20): Promise<BatchListing[]> {
    const d = await (await fetch(`${this.base}/batches?limit=${limit}`, { headers: this.auth() })).json()
    const terminal = ['completed', 'failed', 'expired', 'cancelled']
    return (d.data || []).map((b: any) => ({ id: b.id, done: terminal.includes(b.status) }))
  }
}

export function getProvider(): ClassifyProvider {
  const p = (process.env.CLASSIFY_PROVIDER || 'anthropic').toLowerCase()
  if (p === 'openai') {
    if (!process.env.OPENAI_API_KEY) throw new Error('CLASSIFY_PROVIDER=openai but OPENAI_API_KEY is not set')
    return new OpenAIProvider()
  }
  return new AnthropicProvider()
}
