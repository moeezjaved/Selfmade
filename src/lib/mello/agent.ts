/**
 * Mello agent loop — a ReAct (reason → act → observe → respond) loop on OpenAI
 * GPT-4o with streaming + tool calling. Emits SSE events as it goes:
 *   thinking | tool_start | tool_result | tool_error | text_delta | widget | text_done
 *
 * request_clarification ends the turn with a widget event; the user's choice arrives
 * as the next message (no cross-request blocking — serverless-safe).
 */
import OpenAI from 'openai'
import { TOOLS, TOOL_LABELS, executeTool, formatToolResult } from './tools'
import { buildSystemPrompt } from './system-prompt'

let _openai: OpenAI | null = null
const openai = () => (_openai ||= new OpenAI({ apiKey: process.env.OPENAI_API_KEY }))

export type Emit = (e: any) => void

export interface HistoryMsg { role: 'user' | 'assistant'; content: string }

export interface RecordedToolCall {
  tool: string
  label: string
  status: 'running' | 'complete' | 'error'
  sub_item?: any
}

export interface AgentResult {
  text: string
  toolCalls: RecordedToolCall[]
  thinkingSteps: { duration_ms: number }[]
  widget: any | null
}

const MODEL = process.env.MELLO_MODEL || 'gpt-4o'
const MAX_ROUNDS = 8

export async function runAgent(opts: {
  userId: string
  history: HistoryMsg[]
  userMessage: string
  send: Emit
}): Promise<AgentResult> {
  const { userId, history, userMessage, send } = opts
  const system = await buildSystemPrompt(userId)

  const messages: any[] = [
    { role: 'system', content: system },
    ...history.map(h => ({ role: h.role, content: h.content })),
    { role: 'user', content: userMessage },
  ]

  const recordedToolCalls: RecordedToolCall[] = []
  const thinkingSteps: { duration_ms: number }[] = []
  let finalText = ''
  let widget: any | null = null

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const t0 = Date.now()
    let firstTokenSent = false
    let assistantContent = ''
    const toolCalls: Record<number, { id: string; name: string; args: string }> = {}

    const stream = await openai().chat.completions.create({
      model: MODEL,
      stream: true,
      temperature: 0.4,
      max_tokens: 1800,
      messages,
      tools: TOOLS,
      tool_choice: 'auto',
    })

    for await (const chunk of stream) {
      const choice = chunk.choices?.[0]
      const delta = choice?.delta
      if (!delta) continue

      if (delta.content) {
        if (!firstTokenSent) {
          const dur = Date.now() - t0
          send({ type: 'thinking', duration_ms: dur })
          thinkingSteps.push({ duration_ms: dur })
          firstTokenSent = true
        }
        assistantContent += delta.content
        send({ type: 'text_delta', delta: delta.content })
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const i = tc.index ?? 0
          if (!toolCalls[i]) toolCalls[i] = { id: tc.id || '', name: '', args: '' }
          if (tc.id) toolCalls[i].id = tc.id
          if (tc.function?.name) toolCalls[i].name += tc.function.name
          if (tc.function?.arguments) toolCalls[i].args += tc.function.arguments
        }
      }
    }

    const calls = Object.values(toolCalls).filter(c => c.name)

    // Pure text answer → done.
    if (calls.length === 0) {
      finalText = assistantContent
      break
    }

    // Record the assistant turn (with its tool calls) for the model's own context.
    messages.push({
      role: 'assistant',
      content: assistantContent || null,
      tool_calls: calls.map(c => ({
        id: c.id,
        type: 'function',
        function: { name: c.name, arguments: c.args || '{}' },
      })),
    })
    if (assistantContent) finalText = assistantContent

    let stop = false
    for (const c of calls) {
      let args: any = {}
      try { args = JSON.parse(c.args || '{}') } catch { /* tolerate */ }

      // ── Clarification: emit widget, end the turn ──
      if (c.name === 'request_clarification') {
        widget = {
          widget_id: 'wgt_' + (c.id || Math.abs(hashStr(c.args)).toString(36)),
          widget_type: args.widget_type || 'radio_select',
          question: args.question || 'Which option?',
          options: Array.isArray(args.options) ? args.options : [],
          allow_skip: args.allow_skip !== false,
        }
        send({ type: 'widget', ...widget })
        recordedToolCalls.push({ tool: 'request_clarification', label: 'Waiting for your choice', status: 'complete' })
        messages.push({ role: 'tool', tool_call_id: c.id, content: 'Awaiting user selection.' })
        stop = true
        break
      }

      const label = TOOL_LABELS[c.name] || c.name
      send({ type: 'tool_start', tool: c.name, label })
      const rec: RecordedToolCall = { tool: c.name, label, status: 'running' }
      recordedToolCalls.push(rec)

      try {
        const result = await executeTool(c.name, args, { userId })
        const formatted = formatToolResult(c.name, result)
        send({ type: 'tool_result', tool: c.name, ...formatted })
        rec.status = 'complete'
        rec.sub_item = formatted.sub_item
        messages.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(result).slice(0, 14000) })
      } catch (err: any) {
        send({ type: 'tool_error', tool: c.name, message: err.message })
        rec.status = 'error'
        messages.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify({ error: err.message }) })
      }
    }

    if (stop) break
  }

  send({ type: 'text_done', content: finalText })
  return { text: finalText, toolCalls: recordedToolCalls, thinkingSteps, widget }
}

/** Cheap auto-title from the first user message. */
export async function generateTitle(userMessage: string): Promise<string> {
  try {
    const res = await openai().chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 20,
      temperature: 0.3,
      messages: [
        { role: 'system', content: 'Generate a short 3-6 word title (no quotes, no trailing punctuation) for a chat that starts with the user message.' },
        { role: 'user', content: userMessage.slice(0, 400) },
      ],
    })
    const t = (res.choices[0]?.message?.content || '').trim().replace(/^["']|["']$/g, '').slice(0, 80)
    return t || userMessage.slice(0, 60)
  } catch {
    return userMessage.slice(0, 60)
  }
}

/** Non-streaming run for automations — collects the full text. */
export async function runAgentToText(userId: string, prompt: string): Promise<AgentResult> {
  const noop: Emit = () => {}
  return runAgent({ userId, history: [], userMessage: prompt, send: noop })
}

function hashStr(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return h
}
