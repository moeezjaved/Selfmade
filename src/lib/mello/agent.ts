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
// Planner can be a reasoning-tier model (o-series / gpt-5) — it's a single non-streaming call, so it
// gets deeper reasoning without the streaming/tool-calling fragility of running the main loop on one.
const PLANNER_MODEL = process.env.MELLO_PLANNER_MODEL || 'gpt-4o-mini'
const isReasoning = (m: string) => /^(o\d|gpt-5)/i.test(m)
// Deeper multi-step reasoning: allow longer tool chains (resolve → pull → compare → reflect → answer).
const MAX_ROUNDS = parseInt(process.env.MELLO_MAX_ROUNDS || '12', 10)

/**
 * Stage-3 planner: for non-trivial requests, draft a short numbered plan the executor follows and the
 * UI shows. Skips trivial turns (greetings / one-shot lookups). Best-effort — null on failure/trivial.
 */
async function makePlan(userMessage: string, history: HistoryMsg[]): Promise<string[] | null> {
  if (userMessage.trim().length < 24) return null
  try {
    const params: any = {
      model: PLANNER_MODEL,
      messages: [
        { role: 'system', content: 'You are the planner for Mello, an ad-analytics agent whose tools cover: live Meta performance, ad-library search, competitor/niche analysis, trending winners, boards, and the user\'s uploaded assets. For the user request, output a SHORT numbered plan (2-4 steps), one terse line each, of what to do — which tools, in what order. No preamble, no explanation. If the request is trivial (a greeting or a single obvious lookup), output exactly: NONE' },
        ...history.slice(-4).map(h => ({ role: h.role, content: h.content })),
        { role: 'user', content: userMessage },
      ],
    }
    if (isReasoning(PLANNER_MODEL)) params.max_completion_tokens = 500
    else { params.max_tokens = 220; params.temperature = 0.2 }
    const res: any = await openai().chat.completions.create(params)
    const text = (res.choices?.[0]?.message?.content || '').trim()
    if (!text || /^none\b/i.test(text)) return null
    const steps = String(text).split('\n').map((l: string) => l.replace(/^\s*\d+[.)]\s*/, '').replace(/^[-*]\s*/, '').trim()).filter(Boolean).slice(0, 5)
    return steps.length ? steps : null
  } catch { return null }
}

export async function runAgent(opts: {
  userId: string
  history: HistoryMsg[]
  userMessage: string
  send: Emit
  surface?: string        // e.g. 'studio' — unlocks the canvas-generation tool
  context?: string        // live surface state (e.g. the studio canvas: loaded source ad, brand)
  intent?: string         // routed intent — gates whether competitor context is injected
  brandId?: string | null // active brand — scopes the business/competitor context
}): Promise<AgentResult> {
  const { userId, history, userMessage, send, surface, context, intent, brandId } = opts
  const system = await buildSystemPrompt(userId, userMessage, surface, { intent, brandId })
  // create_ad drives the studio canvas — only expose it there, so Mello never claims to
  // generate on a surface that can't render it.
  const activeTools = surface === 'studio' ? TOOLS : TOOLS.filter(t => t.function.name !== 'create_ad')

  const messages: any[] = [
    { role: 'system', content: system },
    // Live canvas state so Mello knows what's already loaded (the source ad, brand, current result)
    // and can act on "remake this" / "tweak this" without asking which ad.
    ...(context ? [{ role: 'system' as const, content: `CURRENT STUDIO CANVAS STATE:\n${context}` }] : []),
    ...history.map(h => ({ role: h.role, content: h.content })),
    { role: 'user', content: userMessage },
  ]

  // ── Stage 3: plan → execute → reflect. Draft a visible plan for non-trivial turns, then execute it. ──
  const plan = await makePlan(userMessage, history)
  if (plan) {
    send({ type: 'plan', steps: plan })
    messages.push({ role: 'system', content: `Plan for this turn:\n${plan.map((s, i) => `${i + 1}. ${s}`).join('\n')}\nExecute it step by step with tools. After the tools return, REFLECT: did you get what each step needed? If a step's data is thin/empty, adjust before answering. Then give the final answer.` })
  }

  const recordedToolCalls: RecordedToolCall[] = []
  const thinkingSteps: { duration_ms: number }[] = []
  let finalText = ''
  let widget: any | null = null

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const t0 = Date.now()
    let firstTokenSent = false
    let assistantContent = ''
    const toolCalls: Record<number, { id: string; name: string; args: string }> = {}

    const createParams: any = { model: MODEL, stream: true, messages, tools: activeTools, tool_choice: 'auto' }
    // Reasoning-tier executors reject temperature and use max_completion_tokens.
    if (isReasoning(MODEL)) createParams.max_completion_tokens = 2200
    else { createParams.temperature = 0.4; createParams.max_tokens = 1800 }
    const stream: any = await openai().chat.completions.create(createParams)

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

      // ── Create on the canvas: emit a creation event the studio executes, end the turn ──
      // Mirrors request_clarification — the heavy lifting (credits, generate, poll, render)
      // happens client-side in the studio, which already owns the brand + product photos.
      if (c.name === 'create_ad') {
        send({
          type: 'creation',
          kind: args.kind || 'fresh',
          brand_name: args.brand_name || null,
          angle: args.angle || null,
          headline: args.headline || null,
          niche: args.niche || null,
          instruction: args.instruction || null,
          source_ad_id: args.source_ad_id || null,
          note: args.note || null,
        })
        recordedToolCalls.push({ tool: 'create_ad', label: 'Creating on the canvas', status: 'complete', sub_item: { label: args.note || 'Generating on the canvas…' } })
        messages.push({ role: 'tool', tool_call_id: c.id, content: 'Generation started on the canvas.' })
        if (!finalText) finalText = args.note || 'On it — generating on the canvas now.'
        stop = true
        break
      }

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
export async function runAgentToText(userId: string, prompt: string, opts?: { intent?: string; brandId?: string | null }): Promise<AgentResult> {
  const noop: Emit = () => {}
  return runAgent({ userId, history: [], userMessage: prompt, send: noop, intent: opts?.intent, brandId: opts?.brandId })
}

function hashStr(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return h
}
