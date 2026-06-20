'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Plus, Sparkles, MessageSquare, Trash2, Zap } from 'lucide-react'
import { useChatStream, type MelloMessage } from '@/components/mello/useChatStream'
import { ChatMessage } from '@/components/mello/ChatMessage'
import { ChatInput } from '@/components/mello/ChatInput'
import { PromptLibrary } from '@/components/mello/PromptLibrary'
import { PROMPT_LIBRARY, PROMPT_CATEGORIES, type PromptCategory } from '@/lib/mello/prompts'

interface ConvRow { id: string; title: string | null; updated_at: string }

export default function MelloPage() {
  const [conversations, setConversations] = useState<ConvRow[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [showLibrary, setShowLibrary] = useState(false)
  const [cat, setCat] = useState<PromptCategory>('diagnostics')
  const scrollRef = useRef<HTMLDivElement>(null)

  const onTitle = useCallback((title: string) => {
    setActiveId(curr => {
      if (curr) setConversations(prev => prev.map(c => c.id === curr ? { ...c, title } : c))
      return curr
    })
  }, [])

  const { messages, streaming, sendMessage, setHistory, reset } = useChatStream({ onTitle })

  const loadConversations = useCallback(async () => {
    try {
      const r = await fetch('/api/mello/conversations')
      const d = await r.json()
      setConversations(d.conversations || [])
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { loadConversations() }, [loadConversations])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const newTask = () => { setActiveId(null); reset(); setInput('') }

  const selectConversation = async (id: string) => {
    setActiveId(id)
    reset()
    try {
      const r = await fetch(`/api/mello/conversations/${id}`)
      const d = await r.json()
      const mapped: MelloMessage[] = (d.messages || []).map((m: any) => ({
        id: m.id,
        role: m.role,
        content: m.content || '',
        tool_calls: m.tool_calls || [],
        thinking_steps: m.thinking_steps || [],
        interactive_widget: m.interactive_widget || null,
        widget_answered: true,
        is_helpful: m.is_helpful,
        show_feedback: m.role === 'assistant' && !!m.id,
      }))
      setHistory(mapped)
    } catch { /* ignore */ }
  }

  const ensureConversation = async (): Promise<string | null> => {
    if (activeId) return activeId
    try {
      const r = await fetch('/api/mello/conversations', { method: 'POST' })
      const d = await r.json()
      if (d.conversation?.id) {
        setActiveId(d.conversation.id)
        setConversations(prev => [{ id: d.conversation.id, title: null, updated_at: new Date().toISOString() }, ...prev])
        return d.conversation.id
      }
    } catch { /* ignore */ }
    return null
  }

  const submit = async (text: string) => {
    const t = text.trim()
    if (!t || streaming) return
    setInput('')
    const id = await ensureConversation()
    if (!id) return
    await sendMessage(id, t)
  }

  const deleteConversation = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setConversations(prev => prev.filter(c => c.id !== id))
    if (activeId === id) newTask()
    try { await fetch(`/api/mello/conversations/${id}`, { method: 'DELETE' }) } catch { /* ignore */ }
  }

  const onFeedback = async (messageId: string, helpful: boolean) => {
    setHistory(messages.map(m => m.id === messageId ? { ...m, is_helpful: helpful } : m))
    try {
      await fetch(`/api/mello/messages/${messageId}/feedback`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_helpful: helpful }),
      })
    } catch { /* ignore */ }
  }

  const lastIndex = messages.length - 1
  const isEmpty = messages.length === 0
  const catPrompts = PROMPT_LIBRARY.filter(p => p.category === cat).slice(0, 5)

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#eef5eb' }}>
      {/* ── Inner rail ── */}
      <div style={{ width: 250, borderRight: '1px solid #dde6d8', background: '#f6faf3', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        <div style={{ padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: '#dffe95', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Sparkles size={16} color="#2d5a27" />
            </div>
            <span style={{ fontWeight: 800, fontSize: 17, color: '#26331f' }}>Mello</span>
          </div>
          <button onClick={newTask} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '9px 12px', borderRadius: 9, border: '1px solid #d3e0cb', background: '#fff', color: '#2d5a27', fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>
            <Plus size={16} /> New task
          </button>
          <Link href="/mello/automations" style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '9px 12px', borderRadius: 9, color: '#566550', fontWeight: 600, fontSize: 13.5, marginTop: 6, textDecoration: 'none' }}>
            <Zap size={15} /> Automations
          </Link>
        </div>
        <div style={{ padding: '4px 14px', fontSize: 10.5, fontWeight: 800, letterSpacing: '.08em', color: '#9aa593', textTransform: 'uppercase' }}>My tasks</div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 8px' }}>
          {conversations.length === 0 && <div style={{ padding: 12, color: '#9aa593', fontSize: 12.5 }}>No conversations yet.</div>}
          {conversations.map(c => (
            <div key={c.id} onClick={() => selectConversation(c.id)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, cursor: 'pointer', background: activeId === c.id ? '#e7f1de' : 'transparent', marginBottom: 2 }}>
              <MessageSquare size={14} color="#7d8a77" style={{ flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: 13, color: '#3a4733', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title || 'New conversation'}</span>
              <button onClick={e => deleteConversation(c.id, e)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#b7c0b0', display: 'flex' }}><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
      </div>

      {/* ── Chat column ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '0 24px' }}>
          <div style={{ maxWidth: 760, margin: '0 auto', paddingBottom: 20 }}>
            {isEmpty ? (
              <div style={{ paddingTop: 64, textAlign: 'center' }}>
                <div style={{ width: 56, height: 56, borderRadius: 16, background: '#dffe95', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
                  <Sparkles size={28} color="#2d5a27" />
                </div>
                <h1 style={{ fontSize: 26, fontWeight: 800, color: '#26331f', margin: 0 }}>Ask Mello</h1>
                <p style={{ color: '#6c7a66', fontSize: 14, marginTop: 6 }}>Trained on insights from billions in ad spend</p>

                {/* Category tabs */}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', margin: '26px 0 14px' }}>
                  {PROMPT_CATEGORIES.map(c => (
                    <button key={c.key} onClick={() => setCat(c.key)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 10, border: `1px solid ${cat === c.key ? '#7aa856' : '#dde6d8'}`, background: cat === c.key ? '#eef6e6' : '#fff', color: cat === c.key ? '#2d5a27' : '#566550', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                      <span>{c.icon}</span>{c.label}
                    </button>
                  ))}
                </div>

                {/* Category prompts */}
                <div style={{ background: '#fff', border: '1px solid #e6ece2', borderRadius: 14, overflow: 'hidden', textAlign: 'left' }}>
                  {catPrompts.map((p, i) => (
                    <button key={i} onClick={() => submit(p.prompt)} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '13px 16px', border: 'none', borderTop: i ? '1px solid #f0f4ed' : 'none', background: 'transparent', cursor: 'pointer' }}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#f7faf4'}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
                      <Sparkles size={15} color="#7aa856" style={{ flexShrink: 0 }} />
                      <span style={{ fontWeight: 700, fontSize: 13.5, color: '#2c3a26' }}>{p.title}</span>
                      <span style={{ color: '#8a9583', fontSize: 13 }}>— {p.description}</span>
                    </button>
                  ))}
                </div>
                <button onClick={() => setShowLibrary(true)} style={{ marginTop: 14, background: 'none', border: 'none', color: '#5b8a3c', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                  Browse all prompts →
                </button>
              </div>
            ) : (
              <div style={{ paddingTop: 18 }}>
                {messages.map((m, i) => (
                  <ChatMessage
                    key={m.id || i}
                    msg={m}
                    onWidgetAnswer={(label) => submit(label)}
                    onFeedback={onFeedback}
                    widgetLocked={i !== lastIndex || streaming}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Composer */}
        <div style={{ padding: '12px 24px 20px', borderTop: '1px solid #e2eadd', background: '#eef5eb' }}>
          <div style={{ maxWidth: 760, margin: '0 auto' }}>
            <ChatInput
              value={input}
              onChange={setInput}
              onSend={() => submit(input)}
              disabled={streaming}
              onOpenLibrary={() => setShowLibrary(true)}
            />
          </div>
        </div>
      </div>

      {showLibrary && (
        <PromptLibrary onClose={() => setShowLibrary(false)} onPick={(prompt) => { setShowLibrary(false); submit(prompt) }} />
      )}
    </div>
  )
}
