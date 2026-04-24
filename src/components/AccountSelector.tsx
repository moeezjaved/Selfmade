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
}

export default function AccountSelector({ onAccountChange }: Props) {
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
        const primary = accs.find((a: MetaAccount) => a.is_primary) || accs[0]
        if (primary) setSelected(primary.account_id)
      })
  }, [])

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
          background: '#1c3533', border: '1px solid rgba(223,254,149,0.15)',
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
          background: '#152928', border: '1px solid rgba(223,254,149,0.15)',
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
                padding: '10px 14px', background: acc.account_id === selected ? 'rgba(223,254,149,0.07)' : 'none',
                border: 'none', cursor: 'pointer', textAlign: 'left',
                borderBottom: '1px solid rgba(255,255,255,0.04)',
              }}
            >
              <div style={{
                width: 32, height: 32, borderRadius: 8,
                background: acc.account_id === selected ? '#dffe95' : 'rgba(255,255,255,0.06)',
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
                <span style={{ color: '#dffe95', fontSize: 14, flexShrink: 0 }}>✓</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
