'use client'
/**
 * Your team — the company org chart. You (CEO) → Mello (Chief of Staff) → Marketing + Operations
 * departments, each with a live status dot. This is the "you own a company" home; it reads
 * /api/company/overview (status computed from real tasks + learnings). Non-live departments show as
 * "hiring" and light up when their integration lands.
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'

const DOT: Record<string, string> = { working: '#2f7a3d', finished: '#5a9a5a', waiting: '#c58a1e', warning: '#b4530a', idle: '#c5cdc5', hiring: 'transparent' }
const LABEL: Record<string, string> = { working: 'Working', finished: 'Finished', waiting: 'Needs you', warning: 'Warning', idle: 'Idle', hiring: 'Hiring' }

export default function CompanyPage() {
  const [ov, setOv] = useState<any>(null); const [loading, setLoading] = useState(true)
  useEffect(() => { fetch('/api/company/overview').then(r => r.json()).then(j => { if (!j.error) setOv(j) }).catch(() => {}).finally(() => setLoading(false)) }, [])

  const node = (role: string, name: string, accent?: boolean): React.ReactNode => (
    <div style={{ background: accent ? '#eef8d6' : '#fff', border: `1px solid ${accent ? '#cbe88a' : 'rgba(0,0,0,0.08)'}`, borderRadius: 12, padding: '10px 22px', textAlign: 'center', minWidth: 190 }}>
      <div style={{ fontFamily: 'ui-monospace,monospace', fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: '#3e5c43' }}>{role}</div>
      <div style={{ fontSize: 19, color: '#141d15', marginTop: 1, fontWeight: 600 }}>{name}</div>
    </div>
  )
  const conn = <div style={{ width: 2, height: 20, background: '#e2e8e0', margin: '0 auto' }} />

  const DeptCard = ({ d }: { d: any }) => (
    <div style={{ background: '#fff', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 14, padding: '14px 16px', opacity: d.live ? 1 : 0.72 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span style={{ width: 9, height: 9, borderRadius: '50%', flex: 'none', background: DOT[d.status], border: d.status === 'hiring' ? '1.5px solid #c5cdc5' : 'none', boxShadow: d.status === 'waiting' ? '0 0 0 3px rgba(197,138,30,0.2)' : 'none' }} />
        <div style={{ fontSize: 15, fontWeight: 700, color: '#141d15', flex: 1 }}>{d.name}</div>
        <div style={{ fontSize: 10.5, fontFamily: 'ui-monospace,monospace', letterSpacing: '.05em', textTransform: 'uppercase', color: d.status === 'waiting' ? '#c58a1e' : d.status === 'warning' ? '#b4530a' : '#8b958c' }}>{LABEL[d.status]}</div>
      </div>
      <div style={{ fontSize: 12.5, color: '#7a9a7a', marginTop: 6, lineHeight: 1.5 }}>{d.status === 'hiring' ? d.detail : (d.detail || d.role)}</div>
      {/* leveling-up bar: how many of this department's responsibilities are built */}
      {d.progress && (
        <div style={{ marginTop: 10 }}>
          <div style={{ height: 4, background: '#eef3ea', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${Math.round((d.progress.built / d.progress.total) * 100)}%`, background: d.live ? '#b9e63c' : '#d5ddd0' }} />
          </div>
          <div style={{ fontSize: 10.5, color: '#9ca3af', marginTop: 3 }}>{d.progress.built}/{d.progress.total} skills{d.unlockedBy ? ` · unlocks with ${d.unlockedBy}` : ''}</div>
        </div>
      )}
    </div>
  )

  const division = (name: string) => (ov?.departments || []).filter((d: any) => d.division === name)

  return (
    <div style={{ padding: 28, maxWidth: 820 }}>
      <h1 style={{ fontSize: 24, fontWeight: 800, color: '#141d15', marginBottom: 4 }}>Your team</h1>
      <p style={{ fontSize: 13, color: '#7a9a7a', marginBottom: 22 }}>
        {ov?.needsYou ? `${ov.needsYou} thing${ov.needsYou === 1 ? '' : 's'} need you.` : 'Everything’s handled.'} You run it; Mello runs everyone else.
        {' '}<Link href="/brain" style={{ color: '#3e5c43' }}>Company Brain →</Link>
      </p>

      {loading ? <p style={{ color: '#9ca3af', fontSize: 14 }}>Gathering the team…</p> : !ov ? <p style={{ color: '#9ca3af' }}>Couldn’t load.</p> : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 8 }}>
            {node('CEO', ov.ceo?.name || 'You', true)}
            {conn}
            {node('Chief of Staff', ov.chief?.name || 'Mello')}
            {conn}
          </div>

          {(['Marketing', 'Operations'] as const).map(div => (
            <div key={div} style={{ marginBottom: 22 }}>
              <div style={{ fontFamily: 'ui-monospace,monospace', fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: '#8b958c', margin: '10px 0 10px' }}>{div}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: 12 }}>
                {division(div).map((d: any) => <DeptCard key={d.key} d={d} />)}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  )
}
