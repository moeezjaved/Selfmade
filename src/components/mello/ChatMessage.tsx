'use client'

import { useState } from 'react'
import {
  ChevronRight, CheckCircle2, AlertCircle, BarChart2, Search, Loader2,
  ThumbsUp, ThumbsDown,
} from 'lucide-react'
import { Markdown } from './Markdown'
import MelloFace from '@/components/MelloFace'
import type { MelloMessage } from './useChatStream'

function ThinkingBlock({ durationMs }: { durationMs: number }) {
  const [open, setOpen] = useState(false)
  return (
    <button
      onClick={() => setOpen(o => !o)}
      style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', color: '#8a958380', fontSize: 12, padding: '2px 0' }}
    >
      <ChevronRight size={13} style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }} />
      <span>Thought for {(durationMs / 1000).toFixed(1)}s</span>
    </button>
  )
}

function ToolIcon({ tool }: { tool: string }) {
  if (tool === 'search_ad_library') return <Search size={13} />
  return <BarChart2 size={13} />
}

function ToolStep({ call }: { call: NonNullable<MelloMessage['tool_calls']>[number] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, margin: '2px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#56655080' }}>
        {call.status === 'running'
          ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
          : call.status === 'error'
            ? <AlertCircle size={14} color="#d9534f" />
            : <CheckCircle2 size={14} color="#5b8a3c" />}
        <span style={{ color: '#566550' }}>{call.label}</span>
      </div>
      {call.sub_item?.label && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 22, fontSize: 12.5, color: '#41513c' }}>
          <ToolIcon tool={call.tool} />
          <span>{call.sub_item.label}</span>
        </div>
      )}
      {call.status === 'error' && call.message && (
        <div style={{ marginLeft: 22, fontSize: 12, color: '#d9534f' }}>{call.message}</div>
      )}
    </div>
  )
}

function InlineWidget({ widget, onAnswer, disabled }: { widget: any; onAnswer: (label: string) => void; disabled: boolean }) {
  const [selected, setSelected] = useState<string>(
    widget.options?.find((o: any) => o.recommended)?.value || widget.options?.[0]?.value || ''
  )
  const chosen = widget.options?.find((o: any) => o.value === selected)
  return (
    <div style={{ border: '1px solid #dbe6d5', background: '#fff', borderRadius: 12, padding: 14, margin: '8px 0', maxWidth: 520 }}>
      <div style={{ fontWeight: 700, fontSize: 14, color: '#26331f', marginBottom: 10 }}>{widget.question}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {(widget.options || []).map((opt: any) => (
          <label key={opt.value} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: 10, borderRadius: 9, border: `1.5px solid ${selected === opt.value ? '#7aa856' : '#e6ece2'}`, background: selected === opt.value ? '#f3f8ee' : '#fff', cursor: disabled ? 'default' : 'pointer' }}>
            <input type="radio" name={widget.widget_id} value={opt.value} checked={selected === opt.value} onChange={() => setSelected(opt.value)} disabled={disabled} style={{ marginTop: 3 }} />
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontWeight: 600, fontSize: 13.5, color: '#2c3a26' }}>{opt.label}</span>
                {opt.recommended && <span style={{ fontSize: 10, fontWeight: 800, color: '#3d5a25', background: '#ff5a2c', padding: '1px 7px', borderRadius: 99 }}>RECOMMENDED</span>}
              </div>
              {opt.description && <div style={{ fontSize: 12, color: '#6c7a66', marginTop: 2 }}>{opt.description}</div>}
            </div>
          </label>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
        {widget.allow_skip && (
          <button onClick={() => onAnswer('Skip — use your best judgment.')} disabled={disabled} style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #d9e2d3', background: '#fff', color: '#566550', fontSize: 13, fontWeight: 600, cursor: disabled ? 'default' : 'pointer' }}>Skip</button>
        )}
        <button onClick={() => onAnswer(chosen?.label ? `${chosen.label}` : selected)} disabled={disabled || !selected} style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: disabled ? '#9bb37e' : '#141d15', color: '#fff', fontSize: 13, fontWeight: 700, cursor: disabled ? 'default' : 'pointer' }}>Confirm</button>
      </div>
    </div>
  )
}

export function ChatMessage({ msg, onWidgetAnswer, onFeedback, widgetLocked }: {
  msg: MelloMessage
  onWidgetAnswer: (label: string) => void
  onFeedback: (messageId: string, helpful: boolean) => void
  widgetLocked: boolean
}) {
  if (msg.role === 'user') {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '14px 0' }}>
        <div style={{ background: '#141d15', color: '#fff', padding: '10px 14px', borderRadius: '14px 14px 4px 14px', maxWidth: '78%', fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
          {msg.content}
        </div>
      </div>
    )
  }

  const showThinking = (msg.thinking_steps?.length || 0) > 0
  const hasTools = (msg.tool_calls?.length || 0) > 0
  const empty = !msg.content && !hasTools && !msg.interactive_widget && !msg.error && !(msg.plan?.length)
  return (
    <div style={{ display: 'flex', gap: 10, margin: '14px 0' }}>
      <div style={{ flexShrink: 0, marginTop: 2 }}><MelloFace size={28} /></div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {showThinking && msg.thinking_steps!.map((t, i) => <ThinkingBlock key={i} durationMs={t.duration_ms} />)}
        {(msg.plan?.length || 0) > 0 && (
          <div style={{ margin: '4px 0 8px', padding: '8px 11px', background: 'rgba(45,90,39,0.06)', border: '1px solid rgba(45,90,39,0.15)', borderRadius: 10 }}>
            <div style={{ fontSize: 10.5, fontWeight: 800, color: '#141d15', letterSpacing: '.05em', marginBottom: 4 }}>PLAN</div>
            <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: '#3f5140', lineHeight: 1.55 }}>
              {msg.plan!.map((s, i) => <li key={i}>{s}</li>)}
            </ol>
          </div>
        )}
        {hasTools && (
          <div style={{ margin: '4px 0 6px' }}>
            {msg.tool_calls!.map((c, i) => <ToolStep key={i} call={c} />)}
          </div>
        )}
        {empty && msg.streaming && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#7d8a77', fontSize: 13 }}>
            <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Thinking…
          </div>
        )}
        {msg.content && <Markdown content={msg.content} />}
        {msg.interactive_widget && (
          <InlineWidget widget={msg.interactive_widget} onAnswer={onWidgetAnswer} disabled={widgetLocked || !!msg.widget_answered} />
        )}
        {msg.error && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#d9534f', fontSize: 13, marginTop: 6 }}>
            <AlertCircle size={15} /> {msg.error}
          </div>
        )}
        {msg.show_feedback && msg.id && !msg.streaming && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, color: '#8a9583', fontSize: 12.5 }}>
            <span>Is this helpful?</span>
            <button onClick={() => onFeedback(msg.id!, true)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: msg.is_helpful === true ? '#5b8a3c' : '#9aa593' }}><ThumbsUp size={15} /></button>
            <button onClick={() => onFeedback(msg.id!, false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: msg.is_helpful === false ? '#d9534f' : '#9aa593' }}><ThumbsDown size={15} /></button>
          </div>
        )}
      </div>
    </div>
  )
}
