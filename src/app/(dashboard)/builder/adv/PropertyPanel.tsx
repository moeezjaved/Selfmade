'use client'
/**
 * Advanced Page Builder — property panel (Phase 3). The full control system: typography, layout & size,
 * spacing, background & border — each control mapped 1:1 to a StyleProps key and written for the device
 * currently shown on the canvas (base|mobile), via styleField.writeField. A control whose value is
 * overridden on mobile shows a dot; "Reset" clears that device's override back to inherit.
 *
 * Controls are gated by node kind (typography only for text-bearing elements; container layout only for
 * blocks/sections) so the panel shows what's relevant to the selection.
 */
import { useState } from 'react'
import type { PageDoc, Section, Block, Element, Device, StyleProps, DesignTokens } from '@/lib/builder/schema'
import { type NodeRef, levelOf, findNode } from '@/lib/builder/docOps'
import { readField, hasOverride, type StyleKey } from '@/lib/builder/styleField'

const INK = '#1b1a17', SUB = '#6e6a63', FAINT = '#a6a29a'
const LINE = 'rgba(20,18,15,.10)', ORANGE = '#e02f06', WASH = '#fdeee9', INSET = '#f7f6f4'
const SERIF = '"Hedvig Letters Serif", Georgia, serif'

const TEXTY = new Set<Element['type']>(['text', 'heading', 'price', 'button', 'badge', 'icon', 'countdown', 'bind'])
const WEIGHTS: [number, string][] = [[300, 'Light'], [400, 'Regular'], [500, 'Medium'], [600, 'Semibold'], [700, 'Bold'], [800, 'Extrabold'], [900, 'Black']]

export interface PanelProps {
  doc: PageDoc
  sel: NodeRef
  device: Device
  onStyle: (key: StyleKey, value: unknown) => void
  onHidden: () => void
  onContent: (patch: Partial<Element['content']>) => void
}

export default function PropertyPanel({ doc, sel, device, onStyle, onHidden, onContent }: PanelProps) {
  const node = findNode(doc, sel)
  if (!node) return <div style={{ color: FAINT, fontSize: 13 }}>Selection no longer exists.</div>
  const lvl = levelOf(sel)
  const el = lvl === 'element' ? (node as Element) : null
  const isContainer = lvl === 'section' || lvl === 'block'
  const tokens = doc.theme?.tokens || {}
  const style = (node as Section | Block | Element).style || {}
  const g = (k: StyleKey) => ({ style, device, tokens, val: readField(style, k, device), over: device === 'mobile' && hasOverride(style, k, device), onReset: () => onStyle(k, undefined) })

  const showTypography = !!el && TEXTY.has(el.type)
  const showText = !!el && !el.content.bind && 'text' in el.content
  const showImage = !!el && (el.type === 'image' || el.type === 'video')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* header */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: ORANGE }}>{lvl}</div>
        <div style={{ fontFamily: SERIF, fontSize: 20, lineHeight: 1.1 }}>{el ? label(el) : String((node as Section | Block).type)}</div>
      </div>
      <DeviceHint device={device} />

      {/* content: inline text / link / image src */}
      {showText && (
        <Group title="Content">
          <label style={{ display: 'block' }}>
            <span style={rowLabel}>Text</span>
            <textarea defaultValue={el!.content.text || ''} key={el!.id + 'txt'} onBlur={(e) => onContent({ text: e.target.value })}
              style={{ ...input, resize: 'vertical', minHeight: 56 }} />
          </label>
          {el!.type === 'button' && (
            <label style={{ display: 'block', marginTop: 8 }}>
              <span style={rowLabel}>Link (href)</span>
              <input defaultValue={el!.content.href || ''} key={el!.id + 'href'} onBlur={(e) => onContent({ href: e.target.value })} style={input} />
            </label>
          )}
        </Group>
      )}
      {showImage && (
        <Group title={el!.type === 'video' ? 'Video' : 'Image'}>
          <label style={{ display: 'block' }}>
            <span style={rowLabel}>Source URL</span>
            <input defaultValue={el!.content.src || ''} key={el!.id + 'src'} onBlur={(e) => onContent({ src: e.target.value })} placeholder="https://…" style={input} />
          </label>
          {el!.type === 'image' && (
            <label style={{ display: 'block', marginTop: 8 }}>
              <span style={rowLabel}>Alt text</span>
              <input defaultValue={el!.content.alt || ''} key={el!.id + 'alt'} onBlur={(e) => onContent({ alt: e.target.value })} style={input} />
            </label>
          )}
          <div style={hintNote}>Upload / AI-generate / pick a product photo land in a later phase — paste a URL for now.</div>
        </Group>
      )}
      {el?.content.bind && <div style={{ ...hintNote, marginTop: 8 }}>Bound to <b>{el.content.bind.replace('product.', '')}</b> — value comes from the product.</div>}

      {/* Typography */}
      {showTypography && (
        <Group title="Typography">
          <ColorRow label="Text color" {...g('color')} tokens={tokens} onChange={(v) => onStyle('color', v)} allowNone />
          <SliderRow label="Size" {...g('fontSize')} min={10} max={80} unit="px" onChange={(v) => onStyle('fontSize', v)} />
          <SelectRow label="Weight" {...g('fontWeight')} options={WEIGHTS.map(([v, l]) => [String(v), l])} onChange={(v) => onStyle('fontWeight', v ? Number(v) : undefined)} />
          <SegRow label="Letter spacing" {...g('letterSpacing')} options={[['tight', 'Tight'], ['normal', 'Normal'], ['loose', 'Loose']]} onChange={(v) => onStyle('letterSpacing', v)} />
          <SelectRow label="Case" {...g('textCase')} options={[['default', 'Default'], ['upper', 'UPPERCASE'], ['lower', 'lowercase'], ['capitalize', 'Capitalize']]} onChange={(v) => onStyle('textCase', v)} />
          <SegRow label="Align" {...g('textAlign')} options={[['left', '⬅'], ['center', '⬌'], ['right', '➡']]} onChange={(v) => onStyle('textAlign', v)} />
          <SliderRow label="Line height" {...g('lineHeight')} min={1} max={2.4} step={0.05} unit="" onChange={(v) => onStyle('lineHeight', v)} />
        </Group>
      )}

      {/* Layout & size */}
      <Group title="Layout & size">
        {isContainer && <SegRow label="Direction" {...g('direction')} options={[['row', 'Row'], ['column', 'Column']]} onChange={(v) => onStyle('direction', v)} />}
        {isContainer && <SegRow label="Align" {...g('align')} options={[['start', 'Start'], ['center', 'Center'], ['end', 'End'], ['stretch', 'Stretch']]} onChange={(v) => onStyle('align', v)} />}
        {isContainer && <SliderRow label="Gap" {...g('gap')} min={0} max={64} unit="px" onChange={(v) => onStyle('gap', v)} />}
        <TextRow label="Width" {...g('width')} placeholder="48% · 320px · 100%" onChange={(v) => onStyle('width', v)} />
        <TextRow label="Max width" {...g('maxWidth')} placeholder="e.g. 1080px" onChange={(v) => onStyle('maxWidth', v)} />
      </Group>

      {/* Spacing */}
      <Group title="Spacing">
        <SliderRow label="Padding Y" {...g('paddingY')} min={0} max={96} unit="px" onChange={(v) => onStyle('paddingY', v)} />
        <SliderRow label="Padding X" {...g('paddingX')} min={0} max={96} unit="px" onChange={(v) => onStyle('paddingX', v)} />
        <SliderRow label="Margin Y" {...g('marginY')} min={0} max={96} unit="px" onChange={(v) => onStyle('marginY', v)} />
        <SliderRow label="Rounded corners" {...g('radius')} min={0} max={60} unit="px" pill onChange={(v) => onStyle('radius', v)} />
      </Group>

      {/* Background & border */}
      <Group title="Background & border">
        <ColorRow label="Background" {...g('background')} tokens={tokens} onChange={(v) => onStyle('background', v)} allowNone />
        <SliderRow label="Border width" {...g('borderWidth')} min={0} max={10} unit="px" onChange={(v) => onStyle('borderWidth', v)} />
        <ColorRow label="Border color" {...g('borderColor')} tokens={tokens} onChange={(v) => onStyle('borderColor', v)} allowNone />
        <SelectRow label="Shadow" {...g('shadow')} options={[['none', 'None'], ['sm', 'Small'], ['md', 'Medium'], ['lg', 'Large'], ['xl', 'Extra large']]} onChange={(v) => onStyle('shadow', v)} />
      </Group>

      {/* Visibility */}
      <Group title="Visibility">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: SUB }}>
          <input type="checkbox" checked={!!(node as { hidden?: boolean }).hidden} onChange={onHidden} />
          Hidden on the page
        </label>
      </Group>
    </div>
  )
}

/* ── control primitives ── */
type RowBase = { label: string; val: unknown; over?: boolean; onReset?: () => void }

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ borderTop: `1px solid ${LINE}`, paddingTop: 12, marginTop: 12 }}>
      <div style={{ fontSize: 12.5, fontWeight: 800, color: INK, marginBottom: 8 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{children}</div>
    </div>
  )
}
function DeviceHint({ device }: { device: Device }) {
  return (
    <div style={{ fontSize: 11.5, color: SUB, background: INSET, borderRadius: 9, padding: '7px 10px' }}>
      Editing <b style={{ color: device === 'mobile' ? ORANGE : INK }}>{device === 'mobile' ? '📱 Mobile' : '🖥 Desktop'}</b>
      {device === 'mobile' ? ' — values inherit desktop until you set them here.' : ' — the base for every device.'}
    </div>
  )
}
function RowShell({ label, over, onReset, children }: RowBase & { children: React.ReactNode }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span style={rowLabel}>{label}</span>
        {over && <span title="Overridden on mobile" style={{ width: 6, height: 6, borderRadius: 9, background: ORANGE, display: 'inline-block' }} />}
        <span style={{ flex: 1 }} />
        {over && onReset && <button onClick={onReset} style={resetBtn}>reset</button>}
      </div>
      {children}
    </div>
  )
}

const num = (v: unknown): number | '' => { const n = parseFloat(String(v ?? '')); return isFinite(n) ? n : '' }
function SliderRow({ label, val, over, onReset, min, max, step = 1, unit, pill, onChange }: RowBase & { min: number; max: number; step?: number; unit: string; pill?: boolean; onChange: (v: string | undefined) => void }) {
  const n = num(val)
  const emit = (raw: string) => onChange(raw === '' ? undefined : unit ? `${raw}${unit}` : String(raw))
  return (
    <RowShell label={label} over={over} onReset={onReset} val={val}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input type="range" min={min} max={max} step={step} value={n === '' ? min : Math.min(max, Math.max(min, n as number))} onChange={(e) => emit(e.target.value)} style={{ flex: 1, accentColor: ORANGE }} />
        <input type="number" value={n} min={min} step={step} onChange={(e) => emit(e.target.value)} style={{ ...input, width: 62, padding: '6px 8px' }} />
        {pill && <button onClick={() => onChange('999px')} title="Full pill" style={miniBtn}>pill</button>}
      </div>
    </RowShell>
  )
}
function TextRow({ label, val, over, onReset, placeholder, onChange }: RowBase & { placeholder?: string; onChange: (v: string | undefined) => void }) {
  return (
    <RowShell label={label} over={over} onReset={onReset} val={val}>
      <input defaultValue={String(val ?? '')} key={String(val ?? '')} placeholder={placeholder} onBlur={(e) => onChange(e.target.value || undefined)} style={input} />
    </RowShell>
  )
}
function SelectRow({ label, val, over, onReset, options, onChange }: RowBase & { options: [string, string][]; onChange: (v: string | undefined) => void }) {
  return (
    <RowShell label={label} over={over} onReset={onReset} val={val}>
      <select value={String(val ?? '')} onChange={(e) => onChange(e.target.value || undefined)} style={{ ...input, cursor: 'pointer' }}>
        <option value="">Default</option>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </RowShell>
  )
}
function SegRow({ label, val, over, onReset, options, onChange }: RowBase & { options: [string, string][]; onChange: (v: string | undefined) => void }) {
  const cur = String(val ?? '')
  return (
    <RowShell label={label} over={over} onReset={onReset} val={val}>
      <div style={{ display: 'inline-flex', border: `1px solid ${LINE}`, borderRadius: 9, overflow: 'hidden', width: '100%' }}>
        {options.map(([v, l]) => {
          const on = cur === v
          return <button key={v} onClick={() => onChange(on ? undefined : v)} style={{ flex: 1, border: 0, borderLeft: `1px solid ${LINE}`, background: on ? INK : '#fff', color: on ? '#fff' : SUB, padding: '7px 4px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>{l}</button>
        })}
      </div>
    </RowShell>
  )
}
function ColorRow({ label, val, over, onReset, tokens, onChange, allowNone }: RowBase & { tokens: DesignTokens; onChange: (v: string | undefined) => void; allowNone?: boolean }) {
  const cur = val == null ? '' : String(val)
  const resolved = tokens[cur] ?? (cur.startsWith('#') || cur.startsWith('rgb') ? cur : '')
  const [open, setOpen] = useState(false)
  return (
    <RowShell label={label} over={over} onReset={onReset} val={val}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={() => setOpen((o) => !o)} style={{ width: 30, height: 30, borderRadius: 8, border: `1px solid ${LINE}`, background: resolved || 'transparent', backgroundImage: resolved ? 'none' : 'repeating-conic-gradient(#eee 0 25%, #fff 0 50%) 50%/10px 10px', cursor: 'pointer' }} title={cur || 'No color'} />
        <span style={{ fontSize: 12.5, color: cur ? INK : FAINT, flex: 1 }}>{cur || 'No color chosen'}</span>
        <input type="color" value={resolved || '#000000'} onChange={(e) => onChange(e.target.value)} style={{ width: 28, height: 28, border: 0, background: 'none', cursor: 'pointer' }} title="Custom color" />
      </div>
      {open && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {Object.entries(tokens).map(([name, hex]) => (
            <button key={name} onClick={() => { onChange(name); setOpen(false) }} title={name} style={{ display: 'flex', alignItems: 'center', gap: 6, border: `1px solid ${cur === name ? ORANGE : LINE}`, background: cur === name ? WASH : '#fff', borderRadius: 999, padding: '4px 9px 4px 4px', cursor: 'pointer' }}>
              <span style={{ width: 16, height: 16, borderRadius: 999, background: hex, border: `1px solid ${LINE}` }} />
              <span style={{ fontSize: 11.5, color: INK, fontWeight: 600 }}>{name}</span>
            </button>
          ))}
          {allowNone && <button onClick={() => { onChange(undefined); setOpen(false) }} style={{ border: `1px solid ${LINE}`, background: '#fff', borderRadius: 999, padding: '4px 10px', fontSize: 11.5, color: SUB, cursor: 'pointer' }}>None</button>}
        </div>
      )}
    </RowShell>
  )
}

/* ── shared styles + helpers ── */
const rowLabel: React.CSSProperties = { fontSize: 12, color: SUB, fontWeight: 600 }
const input: React.CSSProperties = { width: '100%', border: `1px solid ${LINE}`, borderRadius: 9, padding: '8px 10px', fontSize: 13, color: INK, fontFamily: 'inherit', outline: 'none', background: '#fff', boxSizing: 'border-box' }
const hintNote: React.CSSProperties = { fontSize: 11.5, color: SUB, background: INSET, borderRadius: 9, padding: '8px 10px', lineHeight: 1.5 }
const resetBtn: React.CSSProperties = { border: 0, background: 'transparent', color: ORANGE, fontSize: 11, fontWeight: 700, cursor: 'pointer', padding: 0 }
const miniBtn: React.CSSProperties = { border: `1px solid ${LINE}`, background: '#fff', color: SUB, borderRadius: 8, padding: '6px 8px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }

function label(el: Element): string {
  if (el.content.bind) return el.content.bind.replace('product.', '') + ' (product)'
  const t = el.content.text
  return t ? `${el.type}: ${t.slice(0, 16)}${t.length > 16 ? '…' : ''}` : el.type
}
