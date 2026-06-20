'use client'

import { useCallback, useRef, useState } from 'react'

export interface ToolCallView {
  tool: string
  label: string
  status: 'running' | 'complete' | 'error'
  sub_item?: any
  message?: string
}

export interface MelloMessage {
  id?: string
  role: 'user' | 'assistant'
  content: string
  thinking_steps?: { duration_ms: number }[]
  tool_calls?: ToolCallView[]
  interactive_widget?: any
  widget_answered?: boolean
  show_feedback?: boolean
  is_helpful?: boolean | null
  streaming?: boolean
  error?: string
}

export function useChatStream(opts: { onTitle?: (title: string) => void } = {}) {
  const [messages, setMessages] = useState<MelloMessage[]>([])
  const [streaming, setStreaming] = useState(false)
  const onTitleRef = useRef(opts.onTitle)
  onTitleRef.current = opts.onTitle

  const setHistory = useCallback((msgs: MelloMessage[]) => setMessages(msgs), [])
  const reset = useCallback(() => setMessages([]), [])

  const patchLast = useCallback((fn: (m: MelloMessage) => MelloMessage) => {
    setMessages(prev => {
      if (!prev.length) return prev
      const out = prev.slice()
      out[out.length - 1] = fn({ ...out[out.length - 1] })
      return out
    })
  }, [])

  const handleEvent = useCallback((ev: any) => {
    switch (ev.type) {
      case 'thinking':
        patchLast(m => ({ ...m, thinking_steps: [...(m.thinking_steps || []), { duration_ms: ev.duration_ms }] }))
        break
      case 'tool_start':
        patchLast(m => ({ ...m, tool_calls: [...(m.tool_calls || []), { tool: ev.tool, label: ev.label, status: 'running' }] }))
        break
      case 'tool_result':
        patchLast(m => {
          const calls = (m.tool_calls || []).slice()
          for (let i = calls.length - 1; i >= 0; i--) {
            if (calls[i].tool === ev.tool && calls[i].status === 'running') {
              calls[i] = { ...calls[i], status: 'complete', sub_item: ev.sub_item }
              break
            }
          }
          return { ...m, tool_calls: calls }
        })
        break
      case 'tool_error':
        patchLast(m => {
          const calls = (m.tool_calls || []).slice()
          for (let i = calls.length - 1; i >= 0; i--) {
            if (calls[i].tool === ev.tool && calls[i].status === 'running') {
              calls[i] = { ...calls[i], status: 'error', message: ev.message }
              break
            }
          }
          return { ...m, tool_calls: calls }
        })
        break
      case 'text_delta':
        patchLast(m => ({ ...m, content: (m.content || '') + ev.delta }))
        break
      case 'text_done':
        patchLast(m => ({ ...m, content: ev.content ?? m.content }))
        break
      case 'widget':
        patchLast(m => ({ ...m, interactive_widget: ev, widget_answered: false }))
        break
      case 'feedback_prompt':
        patchLast(m => ({ ...m, id: ev.message_id, show_feedback: true }))
        break
      case 'title_update':
        onTitleRef.current?.(ev.title)
        break
      case 'error':
        patchLast(m => ({ ...m, error: ev.message }))
        break
    }
  }, [patchLast])

  const sendMessage = useCallback(async (conversationId: string, text: string) => {
    setMessages(prev => [
      ...prev,
      { role: 'user', content: text },
      { role: 'assistant', content: '', streaming: true, thinking_steps: [], tool_calls: [] },
    ])
    setStreaming(true)
    try {
      const res = await fetch(`/api/mello/conversations/${conversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      })
      if (!res.body) throw new Error('No response stream')
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const parts = buf.split('\n\n')
        buf = parts.pop() || ''
        for (const part of parts) {
          const line = part.split('\n').find(l => l.startsWith('data: '))
          if (!line) continue
          try { handleEvent(JSON.parse(line.slice(6))) } catch { /* skip */ }
        }
      }
    } catch (err: any) {
      patchLast(m => ({ ...m, error: err?.message || 'Connection failed' }))
    } finally {
      patchLast(m => ({ ...m, streaming: false }))
      setStreaming(false)
    }
  }, [handleEvent, patchLast])

  return { messages, streaming, sendMessage, setHistory, reset }
}
