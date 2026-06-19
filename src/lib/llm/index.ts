/**
 * Drop-in replacement for the Anthropic SDK's `client.messages.create(...)`, backed
 * by OpenAI. Lets us migrate every product feature off Claude (which was hitting the
 * Haiku rate limit + a second, low balance) with a minimal diff: routes just change
 * `const claude = new Anthropic()` → `const claude = llm`. The returned shape matches
 * Anthropic's ({ content: [{ type:'text', text }] }), so `res.content[0].text` and the
 * `res.content[0].type === 'text'` guards keep working unchanged.
 *
 * Model mapping: claude haiku → gpt-4o-mini, claude sonnet/opus → gpt-4o.
 */
import OpenAI from 'openai'

let _openai: OpenAI | null = null
const oai = () => (_openai ||= new OpenAI({ apiKey: process.env.OPENAI_API_KEY }))

function mapModel(m?: string): string {
  if (!m) return 'gpt-4o-mini'
  if (/^(gpt-|o[0-9])/i.test(m)) return m       // already an OpenAI model — pass through
  if (/sonnet|opus/i.test(m)) return 'gpt-4o'   // claude sonnet/opus → gpt-4o
  return 'gpt-4o-mini'                           // claude haiku / unknown → gpt-4o-mini
}

function flatten(content: any): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map((c: any) => (typeof c === 'string' ? c : c?.text || '')).join('\n')
  return content == null ? '' : String(content)
}

type AnthropicShape = { content: { type: 'text'; text: string }[] }

export const llm = {
  messages: {
    async create(p: any): Promise<AnthropicShape> {
      const messages: { role: string; content: string }[] = []
      if (p.system) messages.push({ role: 'system', content: flatten(p.system) })
      for (const m of p.messages || []) messages.push({ role: m.role, content: flatten(m.content) })

      const res = await oai().chat.completions.create({
        model: mapModel(p.model),
        max_tokens: p.max_tokens,
        temperature: p.temperature,
        messages: messages as any,
        ...(p.response_format ? { response_format: p.response_format } : {}),
      })
      return { content: [{ type: 'text', text: res.choices[0]?.message?.content || '' }] }
    },
  },
}
