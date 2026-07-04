'use client'
/**
 * /mcp (dashboard) — subscribers generate their own MCP keys to query the Selfmade ad library from
 * Claude / Cursor / ChatGPT. Gated by the 'api' entitlement (shows an upgrade prompt if not eligible).
 */
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'

type Key = { id: string; label: string; token: string; last_used_at: string | null }
const INK = '#0e1b12', LIME = '#dffe95'

export default function McpPage() {
  const [keys, setKeys] = useState<Key[]>([])
  const [locked, setLocked] = useState(false)
  const [label, setLabel] = useState('')
  const [copied, setCopied] = useState('')
  const [loaded, setLoaded] = useState(false)
  const url = typeof window !== 'undefined' ? `${window.location.origin}/api/mcp` : '/api/mcp'

  const load = useCallback(async () => {
    const j = await fetch('/api/account/mcp-keys').then(r => r.json()).catch(() => ({ keys: [] }))
    setKeys(j.keys || []); setLocked(!!j.locked); setLoaded(true)
  }, [])
  useEffect(() => { load() }, [load])

  const mint = async () => { await fetch('/api/account/mcp-keys', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ label }) }); setLabel(''); load() }
  const revoke = async (id: string) => { if (confirm('Revoke this key?')) { await fetch(`/api/account/mcp-keys?id=${id}`, { method: 'DELETE' }); load() } }
  const copy = (t: string, tag: string) => { navigator.clipboard.writeText(t); setCopied(tag); setTimeout(() => setCopied(''), 1500) }

  const latest = keys[0]
  const config = latest ? JSON.stringify({ mcpServers: { selfmade: { url, headers: { Authorization: `Bearer ${latest.token}` } } } }, null, 2) : ''

  return (
    <div style={{ fontFamily: "'Inter',sans-serif", maxWidth: 860, margin: '0 auto', padding: '28px 24px', color: INK }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, margin: '0 0 6px' }}>MCP / API access</h1>
      <p style={{ color: '#6b7280', fontSize: 15, margin: '0 0 24px' }}>Query the Selfmade library of 3M+ Meta ads directly from Claude, Cursor, or ChatGPT. Generate a key, paste the config into your AI client, and ask it to find winning ads for you.</p>

      {loaded && locked ? (
        <div style={{ background: `linear-gradient(135deg,${LIME},#a8e63d)`, borderRadius: 18, padding: '30px 28px', textAlign: 'center' }}>
          <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>API & MCP access is a paid feature</div>
          <p style={{ color: 'rgba(14,27,18,.72)', margin: '0 0 18px', fontSize: 15 }}>Upgrade to connect Selfmade to your AI tools and query 3M+ ads programmatically.</p>
          <Link href="/pricing" style={{ background: INK, color: '#fff', padding: '12px 26px', borderRadius: 100, fontSize: 15, fontWeight: 800, textDecoration: 'none' }}>See plans →</Link>
        </div>
      ) : (
        <>
          <div style={{ background: '#fbfdfa', border: '1px solid #eef0ee', borderRadius: 14, padding: 16, marginBottom: 18 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>Server URL</div>
            <code style={{ fontSize: 14 }}>{url}</code>
            <span onClick={() => copy(url, 'url')} style={{ marginLeft: 10, fontSize: 12, fontWeight: 700, color: '#16a34a', cursor: 'pointer' }}>{copied === 'url' ? 'copied ✓' : 'copy'}</span>
          </div>

          <div style={{ display: 'flex', gap: 10, marginBottom: 18 }}>
            <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Key name (e.g. My Claude)" style={{ flex: 1, padding: '11px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14 }} />
            <button onClick={mint} style={{ background: INK, color: '#fff', border: 'none', padding: '11px 22px', borderRadius: 100, fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>+ Generate key</button>
          </div>

          {latest && (
            <div style={{ background: INK, color: '#e8ece7', borderRadius: 14, padding: 18, marginBottom: 22 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 800, color: LIME, textTransform: 'uppercase', letterSpacing: '.05em' }}>Paste into Claude / Cursor</span>
                <span onClick={() => copy(config, 'cfg')} style={{ fontSize: 12, fontWeight: 700, color: LIME, cursor: 'pointer' }}>{copied === 'cfg' ? 'copied ✓' : 'copy config'}</span>
              </div>
              <pre style={{ fontSize: 12.5, lineHeight: 1.5, overflowX: 'auto', margin: 0 }}>{config}</pre>
            </div>
          )}

          {keys.map(k => (
            <div key={k.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', border: '1px solid #eef0ee', borderRadius: 10, marginBottom: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{k.label}</div>
                <code style={{ fontSize: 12, color: '#6b7280' }}>{k.token.slice(0, 14)}…{k.token.slice(-4)}</code>
                <span onClick={() => copy(k.token, k.id)} style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: '#16a34a', cursor: 'pointer' }}>{copied === k.id ? 'copied ✓' : 'copy'}</span>
              </div>
              <button onClick={() => revoke(k.id)} style={{ background: 'none', border: '1px solid #fecaca', color: '#dc2626', padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Revoke</button>
            </div>
          ))}
        </>
      )}
    </div>
  )
}
