'use client'
/**
 * /admin/mcp — mint & manage MCP access keys, and copy the config to paste into Claude/Cursor.
 */
import { useEffect, useState, useCallback } from 'react'

type Key = { id: string; label: string; token: string; created_at: string; last_used_at: string | null; revoked: boolean }
const INK = '#0e1b12', LIME = '#ff5a2c'

export default function AdminMcp() {
  const [keys, setKeys] = useState<Key[]>([])
  const [label, setLabel] = useState('')
  const [copied, setCopied] = useState('')
  const url = typeof window !== 'undefined' ? `${window.location.origin}/api/mcp` : '/api/mcp'

  const load = useCallback(async () => {
    const j = await fetch('/api/admin/mcp-keys').then(r => r.json()).catch(() => ({ keys: [] }))
    setKeys(j.keys || [])
  }, [])
  useEffect(() => { load() }, [load])

  const mint = async () => {
    await fetch('/api/admin/mcp-keys', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ label }) })
    setLabel(''); load()
  }
  const revoke = async (id: string) => { if (confirm('Revoke this key? Clients using it stop working.')) { await fetch(`/api/admin/mcp-keys?id=${id}`, { method: 'DELETE' }); load() } }
  const copy = (t: string, tag: string) => { navigator.clipboard.writeText(t); setCopied(tag); setTimeout(() => setCopied(''), 1500) }

  const active = keys.filter(k => !k.revoked)
  const latest = active[0]
  const config = latest ? JSON.stringify({ mcpServers: { selfmade: { url, headers: { Authorization: `Bearer ${latest.token}` } } } }, null, 2) : ''

  return (
    <div style={{ fontFamily: "'Inter',sans-serif", maxWidth: 900, margin: '0 auto', padding: 24, color: INK }}>
      <h1 style={{ fontSize: 26, fontWeight: 800, margin: '0 0 4px' }}>MCP Server</h1>
      <p style={{ color: '#6b7280', fontSize: 15, margin: '0 0 20px' }}>Let Claude, Cursor & ChatGPT query the Selfmade ad library. Mint a key, paste the config into your AI client.</p>

      <div style={{ background: '#fbfdfa', border: '1px solid #eef0ee', borderRadius: 14, padding: 18, marginBottom: 20 }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>Server URL</div>
        <code style={{ fontSize: 14 }}>{url}</code>
        <span onClick={() => copy(url, 'url')} style={{ marginLeft: 10, fontSize: 12, fontWeight: 700, color: '#16a34a', cursor: 'pointer' }}>{copied === 'url' ? 'copied ✓' : 'copy'}</span>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 18 }}>
        <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Key label (e.g. My Claude Desktop)" style={{ flex: 1, padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14 }} />
        <button onClick={mint} style={{ background: INK, color: '#fff', border: 'none', padding: '10px 20px', borderRadius: 100, fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>+ Generate key</button>
      </div>

      {latest && (
        <div style={{ background: INK, color: '#e8ece7', borderRadius: 14, padding: 18, marginBottom: 22 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 800, color: LIME, textTransform: 'uppercase', letterSpacing: '.05em' }}>Client config (paste into Claude / Cursor)</span>
            <span onClick={() => copy(config, 'cfg')} style={{ fontSize: 12, fontWeight: 700, color: LIME, cursor: 'pointer' }}>{copied === 'cfg' ? 'copied ✓' : 'copy config'}</span>
          </div>
          <pre style={{ fontSize: 12.5, lineHeight: 1.5, overflowX: 'auto', margin: 0 }}>{config}</pre>
        </div>
      )}

      <div style={{ fontSize: 12, fontWeight: 800, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 }}>Keys</div>
      {active.length === 0 && <div style={{ color: '#9ca3af', fontSize: 14 }}>No keys yet — generate one above.</div>}
      {active.map(k => (
        <div key={k.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', border: '1px solid #eef0ee', borderRadius: 10, marginBottom: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{k.label}</div>
            <code style={{ fontSize: 12, color: '#6b7280' }}>{k.token.slice(0, 14)}…{k.token.slice(-4)}</code>
            <span onClick={() => copy(k.token, k.id)} style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: '#16a34a', cursor: 'pointer' }}>{copied === k.id ? 'copied ✓' : 'copy token'}</span>
          </div>
          <div style={{ fontSize: 12, color: '#9ca3af' }}>{k.last_used_at ? 'used' : 'never used'}</div>
          <button onClick={() => revoke(k.id)} style={{ background: 'none', border: '1px solid #fecaca', color: '#dc2626', padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Revoke</button>
        </div>
      ))}
    </div>
  )
}
