'use client'
import MetaGate from '@/components/MetaGate'
import AdsTabs from '@/components/ads/AdsTabs'
/**
 * /snapshots — the archive of "Share once" snapshots: frozen, point-in-time, shareable copies of a
 * report's data. Created via Share report → Share once (NOT Save, which updates the live report).
 * Empty state is a 3-step explainer; populated state lists each snapshot with View / Reshare / Delete.
 */
import { useState, useEffect } from 'react'
import { confirmAction } from '@/components/ConfirmDialog'

const FONT = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
const G11 = '#6f6f6f', G12 = '#171717', G9 = '#8f8f8f', G2 = '#f8f8f8'

type Snap = { token: string; name: string; emoji: string; templateKey: string; note: string; createdAt: string; sharedBy: string; mode: string }

function SnapshotsPage() {
  const [snaps, setSnaps] = useState<Snap[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState('')

  const load = () => { setLoading(true); fetch('/api/reports/snapshots').then(r => r.json()).then(j => setSnaps(j.snapshots || [])).catch(() => {}).finally(() => setLoading(false)) }
  useEffect(() => { load() }, [])

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2000) }
  const reshare = (t: string) => { try { navigator.clipboard.writeText(`${window.location.origin}/r/${t}`); flash('Snapshot link copied') } catch { flash('Copy failed') } }
  const del = async (t: string) => {
    if (!(await confirmAction({ title: 'Delete this snapshot?', body: 'The shared link will stop working.' }))) return
    setSnaps(s => s.filter(x => x.token !== t))
    await fetch(`/api/reports/snapshots?token=${t}`, { method: 'DELETE' }).catch(() => {})
  }
  const when = (iso: string) => { try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) } catch { return '' } }

  return (
    <div style={{ padding: 28, maxWidth: 900, margin: '0 auto', fontFamily: FONT, color: G12 }}>
      <AdsTabs />
      <div style={{ fontSize: 12.5, color: G11, marginBottom: 4 }}>Snapshots</div>
      <h1 style={{ fontSize: 24, lineHeight: '29px', fontWeight: 600, letterSpacing: '-0.019em', margin: 0 }}>Snapshots</h1>
      <div style={{ fontSize: 14, color: G11, marginTop: 4, marginBottom: 28 }}>Saved, sharable, static versions of your reports.</div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{[0, 1, 2].map(i => <div key={i} className="mds-skel" style={{ height: 72, borderRadius: 16 }} />)}</div>
      ) : snaps.length === 0 ? (
        <EmptyState />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {snaps.map(s => (
            <div key={s.token} className="lb-row" style={{ display: 'flex', alignItems: 'center', gap: 14, rowGap: 10, flexWrap: 'wrap', background: G2, borderRadius: 16, padding: '16px 18px', transition: 'background-color .075s ease-in-out' }}>
              <span style={{ fontSize: 24, flexShrink: 0 }}>{s.emoji || '📊'}</span>
              {/* flex-basis 200 + wrap: on a phone the View/Reshare/Delete buttons drop to their own row
                  instead of crushing this text block to one-word-per-line. */}
              <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</div>
                <div style={{ fontSize: 12.5, color: G11, marginTop: 2 }}>
                  Shared by {s.sharedBy} · {when(s.createdAt)}{s.mode === 'partner' ? ' · emailed to partner' : ''}
                </div>
                {s.note ? <div style={{ fontSize: 12.5, color: G9, marginTop: 3, fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>“{s.note}”</div> : null}
              </div>
              <a href={`/r/${s.token}`} target="_blank" rel="noopener noreferrer" style={btnLight}>View</a>
              <button onClick={() => reshare(s.token)} style={btnLight}>Reshare</button>
              <button onClick={() => del(s.token)} style={{ ...btnLight, color: '#cd2b31', borderColor: 'rgba(205,43,49,.24)' }}>Delete</button>
            </div>
          ))}
        </div>
      )}

      {toast && <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: G12, color: '#fff', fontSize: 13, fontWeight: 600, padding: '10px 18px', borderRadius: 10, zIndex: 6000 }}>{toast}</div>}
    </div>
  )
}

function EmptyState() {
  const steps = [
    { n: 1, icon: '🔗', text: 'Hit the Share button on any report to create a Snapshot.' },
    { n: 2, icon: '📸', text: 'The report is saved as a Snapshot for you to share or review later.' },
    { n: 3, icon: '🗂️', text: 'Revisit Snapshots to view, delete, and reshare any you have taken.' },
  ]
  return (
    <div style={{ border: '1px dashed rgba(0,0,0,.14)', borderRadius: 16, padding: '36px 28px', background: '#fcfcfc' }}>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>No snapshots yet</div>
      <div style={{ fontSize: 14, color: G11, marginBottom: 26 }}>Snapshots are frozen, point-in-time copies of a report — created from <b>Share report → Share once</b>. (The <b>Save</b> button just updates the live report in your sidebar.)</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
        {steps.map(s => (
          <div key={s.n} style={{ background: '#fff', border: '1px solid rgba(0,0,0,.08)', borderRadius: 12, padding: '18px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span style={{ width: 22, height: 22, borderRadius: 6, background: '#ff5a2c', color: '#0e1b12', fontSize: 12, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{s.n}</span>
              <span style={{ fontSize: 20 }}>{s.icon}</span>
            </div>
            <div style={{ fontSize: 13.5, color: '#3a4636', lineHeight: 1.5 }}>{s.text}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

const btnLight: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', height: 32, padding: '0 14px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.12)', background: '#fff', color: G12, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: FONT, textDecoration: 'none', flexShrink: 0 }

// ── Gate: needs a connected Meta ad account. MetaGate keys off the connection (BYO or OAuth),
// not the old META_LIVE flag — connected users get the surface, everyone else a connect prompt. ──
export default function SnapshotsPageGate() {
  return <MetaGate feature="Snapshots"><SnapshotsPage /></MetaGate>
}
