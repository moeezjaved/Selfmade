'use client'
/**
 * Admin — audit nurture drip control room. Preview every queued email (rendered, with the lead's real
 * data + ads), edit it, and approve/skip/send. Email #1 auto-sends; #2–#8 wait here for approval unless
 * the global autosend toggle is on.
 */
import { useCallback, useEffect, useState } from 'react'

const INK = '#141d15', SUB = '#6b776b', LINE = '#e6ebe3', ORANGE = '#ef4a1e', GOOD = '#256029'
type Email = { id: string; step: number; subject: string; status: string; send_after: string; sent_at: string | null }
type Lead = { id: string; email: string; domain: string | null; brand_name: string | null; status: string; created_at: string; revenueLostPerYear: number | null; currency: string; adCount: number; emails: Email[] }
type Template = { step: number; dayOffset: number; subject: string }

const STATUS_COLOR: Record<string, string> = { sent: GOOD, approved: '#1e5f9a', pending: '#9a6a12', skipped: '#9aa' }

export default function AuditEmailsAdmin() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [autosend, setAutosend] = useState(false)
  const [loading, setLoading] = useState(true)
  const [preview, setPreview] = useState<{ id: string; subject: string; html: string; editing: boolean } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try { const r = await fetch('/api/admin/audit-emails'); const j = await r.json(); if (r.ok) { setLeads(j.leads || []); setAutosend(!!j.autosend) } } catch { /* noop */ }
    try { const r = await fetch('/api/admin/audit-emails?samples=1'); const j = await r.json(); if (r.ok) setTemplates(j.samples || []) } catch { /* noop */ }
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  // Preview a template design (sample data) — read-only, no editing.
  const openSample = async (step: number) => {
    const r = await fetch(`/api/admin/audit-emails?sample=${step}`); const j = await r.json()
    if (r.ok) setPreview({ id: `sample-${step}`, subject: j.subject, html: j.html, editing: false })
  }

  const act = async (payload: any) => {
    setBusy(payload.id || payload.action)
    try { await fetch('/api/admin/audit-emails', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }) } catch { /* noop */ }
    setBusy(null); await load()
  }
  const openPreview = async (id: string) => {
    const r = await fetch(`/api/admin/audit-emails?preview=${id}`); const j = await r.json()
    if (r.ok) setPreview({ id, subject: j.subject, html: j.html, editing: false })
  }
  const saveEdit = async () => {
    if (!preview) return
    await act({ action: 'edit', id: preview.id, subject: preview.subject, html: preview.html })
    setPreview(null)
  }

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '28px 22px 80px', fontFamily: 'Inter, system-ui, sans-serif', color: INK }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>Audit emails</h1>
          <p style={{ fontSize: 13.5, color: SUB, marginTop: 5 }}>Every lead from the free store-audit + their nurture drip. Email #1 sends instantly; approve the rest before they go.</p>
        </div>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 9, fontSize: 13.5, fontWeight: 700, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 100, padding: '8px 14px', cursor: 'pointer' }}>
          <input type="checkbox" checked={autosend} onChange={(e) => act({ action: 'toggle_autosend', on: e.target.checked })} />
          Auto-send #2–#8 (skip approval)
        </label>
      </div>

      {/* Template gallery — every design in the sequence, rendered from sample data. Preview anytime. */}
      {templates.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: SUB, textTransform: 'uppercase', letterSpacing: '.04em' }}>The 8-email sequence · designs</div>
          <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
            {templates.map((t) => (
              <button key={t.step} onClick={() => openSample(t.step)} style={{ textAlign: 'left', border: `1px solid ${LINE}`, background: '#fff', borderRadius: 12, padding: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: '#fff', background: ORANGE, borderRadius: 100, padding: '2px 9px' }}>#{t.step}</span>
                  <span style={{ fontSize: 11.5, color: SUB }}>{t.dayOffset === 0 ? 'instant' : `day ${t.dayOffset}`}</span>
                </div>
                <div style={{ fontSize: 13.5, fontWeight: 650, color: INK, marginTop: 8, lineHeight: 1.35 }}>{t.subject}</div>
                <div style={{ fontSize: 12, color: ORANGE, fontWeight: 700, marginTop: 8 }}>Preview design →</div>
              </button>
            ))}
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: SUB }}>These are the templates. Below are real leads and their live queue.</div>
        </div>
      )}

      {loading ? <div style={{ marginTop: 30, color: SUB }}>Loading…</div> : !leads.length ? (
        <div style={{ marginTop: 30, border: `1px solid ${LINE}`, borderRadius: 14, padding: 40, textAlign: 'center', color: SUB }}>No audit leads yet.</div>
      ) : (
        <div style={{ marginTop: 22, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {leads.map((l) => {
            const pending = l.emails.filter((e) => e.status === 'pending').length
            return (
              <div key={l.id} style={{ border: `1px solid ${LINE}`, borderRadius: 14, background: '#fff', padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 750 }}>{l.email} {l.status !== 'active' && <span style={{ fontSize: 11, fontWeight: 800, color: '#fff', background: l.status === 'converted' ? GOOD : '#9aa', borderRadius: 100, padding: '2px 8px', marginLeft: 6 }}>{l.status}</span>}</div>
                    <div style={{ fontSize: 12.5, color: SUB, marginTop: 2 }}>{l.domain || '—'}{l.brand_name ? ` · ${l.brand_name}` : ''}{l.revenueLostPerYear ? ` · ${l.currency}${Math.round(l.revenueLostPerYear).toLocaleString()}/yr at stake` : ''}{l.adCount ? ` · ${l.adCount} ads` : ''}</div>
                  </div>
                  {pending > 0 && l.status === 'active' && <button onClick={() => act({ action: 'approve_all', leadId: l.id })} disabled={busy === l.id} style={btn(true)}>Approve all {pending}</button>}
                </div>
                <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {l.emails.map((e) => (
                    <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 9, background: '#faf9f5', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 11, fontWeight: 800, color: SUB, width: 26 }}>#{e.step}</span>
                      <span style={{ fontSize: 13, flex: 1, minWidth: 160, color: INK }}>{e.subject}</span>
                      <span style={{ fontSize: 11, fontWeight: 800, color: '#fff', background: STATUS_COLOR[e.status] || '#9aa', borderRadius: 100, padding: '2px 9px', textTransform: 'uppercase' }}>{e.status}</span>
                      <span style={{ fontSize: 11.5, color: SUB, minWidth: 92 }}>{e.sent_at ? `sent ${new Date(e.sent_at).toLocaleDateString()}` : `due ${new Date(e.send_after).toLocaleDateString()}`}</span>
                      <button onClick={() => openPreview(e.id)} style={btn(false)}>Preview</button>
                      {e.status === 'pending' && l.status === 'active' && <button onClick={() => act({ action: 'approve', id: e.id })} disabled={busy === e.id} style={btn(true)}>Approve</button>}
                      {(e.status === 'pending' || e.status === 'approved') && l.status === 'active' && <button onClick={() => act({ action: 'send', id: e.id })} disabled={busy === e.id} style={btn(false)}>Send now</button>}
                      {e.status !== 'sent' && e.status !== 'skipped' && <button onClick={() => act({ action: 'skip', id: e.id, from: e.status })} disabled={busy === e.id} style={{ ...btn(false), color: '#b91c1c' }}>Skip</button>}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {preview && (
        <div onClick={() => setPreview(null)} style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(20,29,21,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(640px,96vw)', maxHeight: '92vh', display: 'flex', flexDirection: 'column', background: '#fff', borderRadius: 16, overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', borderBottom: `1px solid ${LINE}`, display: 'flex', alignItems: 'center', gap: 10 }}>
              {preview.editing
                ? <input value={preview.subject} onChange={(e) => setPreview({ ...preview, subject: e.target.value })} style={{ flex: 1, padding: '8px 10px', border: `1px solid ${LINE}`, borderRadius: 8, fontSize: 13.5, fontFamily: 'inherit' }} />
                : <div style={{ flex: 1, fontSize: 14, fontWeight: 700, minWidth: 0 }}>{preview.subject}{preview.id.startsWith('sample-') && <span style={{ fontSize: 11, fontWeight: 700, color: SUB, marginLeft: 8 }}>· template preview (sample data)</span>}</div>}
              {!preview.id.startsWith('sample-') && <button onClick={() => setPreview({ ...preview, editing: !preview.editing })} style={btn(false)}>{preview.editing ? 'Editing' : 'Edit'}</button>}
              {preview.editing && <button onClick={saveEdit} style={btn(true)}>Save</button>}
              <button onClick={() => setPreview(null)} style={{ ...btn(false), border: 'none' }}>✕</button>
            </div>
            <div style={{ overflow: 'auto', flex: 1 }}>
              {preview.editing
                ? <textarea value={preview.html} onChange={(e) => setPreview({ ...preview, html: e.target.value })} style={{ width: '100%', height: 420, border: 'none', padding: 16, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, resize: 'vertical' }} />
                : <iframe title="preview" srcDoc={preview.html} style={{ width: '100%', height: 560, border: 'none', display: 'block' }} />}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function btn(primary: boolean): React.CSSProperties {
  return { border: primary ? 'none' : `1px solid ${LINE}`, background: primary ? ORANGE : '#fff', color: primary ? '#fff' : INK, borderRadius: 8, padding: '6px 12px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }
}
