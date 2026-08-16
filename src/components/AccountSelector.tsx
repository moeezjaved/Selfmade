'use client'
import { useEffect, useState } from 'react'

interface MetaAccount {
  id: string
  account_id: string
  account_name: string
  currency: string
  is_primary: boolean
}

interface Props {
  onAccountChange: (accountId: string) => void
  // When the page arrives scoped to a specific account (e.g. /reports?account=…
  // from the brief card), show THAT account — not the org primary — so the
  // header currency matches the figures on screen.
  initialAccountId?: string | null
}

export default function AccountSelector({ onAccountChange, initialAccountId }: Props) {
  const [accounts, setAccounts] = useState<MetaAccount[]>([])
  const [selected, setSelected] = useState<string>('')
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetch('/api/meta/accounts')
      .then(r => r.json())
      .then(d => {
        const accs = d.accounts || []
        setAccounts(accs)
        const want = initialAccountId ? String(initialAccountId).replace(/^act_/, '') : ''
        const wanted = want && accs.find((a: MetaAccount) => a.account_id === want)
        const primary = wanted || accs.find((a: MetaAccount) => a.is_primary) || accs[0]
        if (primary) {
          setSelected(primary.account_id)
          // Broadcast the RESOLVED account on mount so the page fetches for exactly the account shown
          // here (a healthy connected one) — never the server's ambiguous org-primary.
          onAccountChange(primary.account_id)
        }
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialAccountId])

  const handleSelect = async (accountId: string) => {
    if (accountId === selected) { setOpen(false); return }
    setLoading(true)
    setOpen(false)
    // Set as primary
    await fetch('/api/meta/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account_id: accountId }),
    })
    setSelected(accountId)
    setLoading(false)
    onAccountChange(accountId)
  }

  const selectedAccount = accounts.find(a => a.account_id === selected)
  if (!accounts.length) return null

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(!open)}
        disabled={loading}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: '#1c3533', border: '1px solid rgba(255,90,44,0.15)',
          borderRadius: 10, padding: '8px 14px', cursor: 'pointer',
          color: 'white', fontSize: 13, fontFamily: 'inherit', fontWeight: 600,
          opacity: loading ? 0.6 : 1, minWidth: 200,
        }}
      >
        <span style={{ fontSize: 16 }}>📊</span>
        <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {loading ? 'Switching…' : (selectedAccount?.account_name || 'Select Account')}
        </span>
        <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, marginTop: 4,
          background: '#152928', border: '1px solid rgba(255,90,44,0.15)',
          borderRadius: 12, minWidth: 280, maxHeight: 300, overflowY: 'auto',
          zIndex: 100, boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        }}>
          <div style={{ padding: '8px 12px 6px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: 'rgba(255,255,255,0.3)' }}>
            {accounts.length} connected account{accounts.length !== 1 ? 's' : ''}
          </div>
          {accounts.map(acc => (
            <button
              key={acc.account_id}
              onClick={() => handleSelect(acc.account_id)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 14px', background: acc.account_id === selected ? 'rgba(255,90,44,0.07)' : 'none',
                border: 'none', cursor: 'pointer', textAlign: 'left',
                borderBottom: '1px solid rgba(255,255,255,0.04)',
              }}
            >
              <div style={{
                width: 32, height: 32, borderRadius: 8,
                background: acc.account_id === selected ? '#ff5a2c' : 'rgba(255,255,255,0.06)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 800,
                color: acc.account_id === selected ? '#10211f' : 'rgba(255,255,255,0.5)',
                flexShrink: 0,
              }}>
                {acc.account_name.slice(0, 2).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'white', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {acc.account_name}
                </div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 1 }}>
                  act_{acc.account_id} · {acc.currency}
                </div>
              </div>
              {acc.account_id === selected && (
                <span style={{ color: '#ff5a2c', fontSize: 14, flexShrink: 0 }}>✓</span>
              )}
            </button>
          ))}

          {/* Other ad platforms — coming soon */}
          <div style={{ padding: '10px 12px 6px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: 'rgba(255,255,255,0.3)', borderTop: '1px solid rgba(255,255,255,0.05)', marginTop: 2 }}>
            Available to connect
          </div>
          {[
            { label: 'TikTok', bg: '#000', glyph: '♪', fg: '#25F4EE' },
            { label: 'YouTube', bg: '#FF0000', glyph: '▶', fg: '#fff' },
            { label: 'LinkedIn', bg: '#0A66C2', glyph: 'in', fg: '#fff' },
            { label: 'Northbeam', bg: '#6d28d9', glyph: 'N', fg: '#fff' },
            { label: 'Google Analytics', bg: '#E8710A', glyph: 'GA', fg: '#fff' },
          ].map(p => (
            <div key={p.label} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', cursor: 'not-allowed' }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: p.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: p.glyph.length > 1 ? 12 : 16, fontWeight: 800, color: p.fg, flexShrink: 0 }}>{p.glyph}</div>
              <div style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.7)' }}>{p.label}</div>
              <span style={{ fontSize: 9.5, fontWeight: 800, color: '#ff5a2c', background: 'rgba(255,90,44,0.1)', padding: '2px 7px', borderRadius: 100, flexShrink: 0 }}>SOON</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
