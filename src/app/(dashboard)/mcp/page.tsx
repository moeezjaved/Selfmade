'use client'
/**
 * /mcp (dashboard) — subscribers generate their own MCP keys to query the Selfmade ad library from
 * Claude / Cursor / ChatGPT / CLI. Gated by the 'api' entitlement (resolved on the org billing owner).
 *
 * Loading is handled explicitly (skeleton) so the page never flashes the unlocked UI and then flips
 * to the upsell — the "shows Generate key, then 2s later shows See plan" bug.
 */
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { confirmAction } from '@/components/ConfirmDialog'

type Key = { id: string; label: string; token: string; last_used_at: string | null }
type Agent = 'claude' | 'chatgpt' | 'cursor' | 'cli'
const INK = '#0e1b12', LIME = '#dffe95'

export default function McpPage() {
  const [keys, setKeys] = useState<Key[]>([])
  const [locked, setLocked] = useState(false)
  const [label, setLabel] = useState('')
  const [copied, setCopied] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [minting, setMinting] = useState(false)
  const [agent, setAgent] = useState<Agent>('claude')
  const url = typeof window !== 'undefined' ? `${window.location.origin}/api/mcp` : 'https://www.tryselfmade.ai/api/mcp'

  const load = useCallback(async () => {
    const j = await fetch('/api/account/mcp-keys').then(r => r.json()).catch(() => ({ keys: [] }))
    setKeys(j.keys || []); setLocked(!!j.locked); setLoaded(true)
  }, [])
  useEffect(() => { load() }, [load])

  const mint = async () => {
    setMinting(true)
    try {
      const res = await fetch('/api/account/mcp-keys', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ label }) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j?.error || 'Could not generate key')
      setLabel('')
      await load()
      // Auto-copy the fresh key + confirm — the new key lands at the top of "Your keys" and fills the
      // config snippets, but without this there was zero feedback ("clicked Generate, nothing happened").
      if (j?.key?.token) { try { navigator.clipboard.writeText(j.key.token) } catch {} }
      toast.success('API key created — copied to clipboard')
    } catch (e: any) {
      toast.error(e?.message || 'Failed to generate key')
    } finally {
      setMinting(false)
    }
  }
  const revoke = async (id: string) => { if (await confirmAction({ title: 'Revoke this key?', body: 'Any tool using it stops working immediately.' })) { await fetch(`/api/account/mcp-keys?id=${id}`, { method: 'DELETE' }); load() } }
  const copy = (t: string, tag: string) => { navigator.clipboard.writeText(t); setCopied(tag); setTimeout(() => setCopied(''), 1500) }

  const latest = keys[0]
  const token = latest?.token || 'YOUR_KEY'
  const jsonConfig = JSON.stringify({ mcpServers: { selfmade: { url, headers: { Authorization: `Bearer ${token}` } } } }, null, 2)

  const AGENTS: { id: Agent; label: string; icon: string }[] = [
    { id: 'claude', label: 'Claude', icon: '✳️' },
    { id: 'chatgpt', label: 'ChatGPT', icon: '◍' },
    { id: 'cursor', label: 'Cursor', icon: '⌘' },
    { id: 'cli', label: 'Command Line', icon: '▸' },
  ]

  // Per-agent connect instructions. Steps are plain strings; `code` (if present) renders as a copy block.
  const guide = (a: Agent): { steps: React.ReactNode[]; code?: string; codeTag?: string } => {
    switch (a) {
      case 'claude': return {
        steps: [
          <>Generate a key above (or below) and copy it.</>,
          <>In Claude, open <b>Settings → Connectors → Add custom connector</b>.</>,
          <>Paste the config on the right (or the Server URL + <code>Authorization: Bearer &lt;key&gt;</code> header).</>,
          <>Ask Claude: <i>“find winning skincare ads from the Selfmade library.”</i></>,
        ],
        code: jsonConfig, codeTag: 'claude',
      }
      case 'cursor': return {
        steps: [
          <>Generate a key and copy it.</>,
          <>Open <b>Cursor → Settings → MCP → Add new MCP server</b> (or edit <code>~/.cursor/mcp.json</code>).</>,
          <>Paste the config on the right.</>,
        ],
        code: jsonConfig, codeTag: 'cursor',
      }
      case 'chatgpt': return {
        steps: [
          <>Generate a key and copy it.</>,
          <>In ChatGPT, enable <b>Developer mode / Connectors</b> and choose <b>Add custom connector</b>.</>,
          <>Set the URL to the Server URL below and add header <code>Authorization: Bearer &lt;key&gt;</code>.</>,
        ],
      }
      case 'cli': return {
        steps: [
          <>Generate a key, then call the server directly with your token:</>,
        ],
        code: `curl -s "${url}" \\\n  -H "Authorization: Bearer ${token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"method":"tools/list"}'`,
        codeTag: 'cli',
      }
    }
  }

  return (
    <div style={{ fontFamily: "'Inter',system-ui,sans-serif", maxWidth: 900, margin: '0 auto', padding: '28px 24px', color: INK }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, margin: '0 0 6px' }}>Connect your AI tools</h1>
      <p style={{ color: '#6b7280', fontSize: 15, margin: '0 0 24px', maxWidth: 640 }}>Query the Selfmade library of 3M+ Meta ads directly from Claude, ChatGPT, Cursor, or the command line. Generate a key, connect your agent, and ask it to find winning ads for you.</p>

      {!loaded ? (
        // Loading skeleton — prevents the unlocked-then-"See plan" flicker.
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ height: 74, borderRadius: 14, background: '#f1f5f1' }} className="mcp-pulse" />
          <div style={{ height: 46, borderRadius: 10, background: '#f1f5f1', width: '70%' }} className="mcp-pulse" />
          <div style={{ height: 160, borderRadius: 14, background: '#f1f5f1' }} className="mcp-pulse" />
        </div>
      ) : locked ? (
        <div style={{ background: `linear-gradient(135deg,${LIME},#a8e63d)`, borderRadius: 18, padding: '30px 28px', textAlign: 'center' }}>
          <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>API & MCP access is a paid feature</div>
          <p style={{ color: 'rgba(14,27,18,.72)', margin: '0 0 18px', fontSize: 15 }}>Upgrade to connect Selfmade to your AI tools and query 3M+ ads programmatically.</p>
          <Link href="/billing" style={{ background: INK, color: '#fff', padding: '12px 26px', borderRadius: 100, fontSize: 15, fontWeight: 800, textDecoration: 'none' }}>See plans →</Link>
        </div>
      ) : (
        <>
          {/* Server URL */}
          <div style={{ background: '#fbfdfa', border: '1px solid #eef0ee', borderRadius: 14, padding: 16, marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>Server URL</div>
            <code style={{ fontSize: 14 }}>{url}</code>
            <span onClick={() => copy(url, 'url')} style={{ marginLeft: 10, fontSize: 12, fontWeight: 700, color: '#16a34a', cursor: 'pointer' }}>{copied === 'url' ? 'copied ✓' : 'copy'}</span>
          </div>

          {/* Generate key */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 24, flexWrap: 'wrap' }}>
            <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Key name (e.g. My Claude)" style={{ flex: 1, minWidth: 200, padding: '11px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14 }} />
            <button onClick={mint} disabled={minting} style={{ background: INK, color: '#fff', border: 'none', padding: '11px 22px', borderRadius: 100, fontSize: 14, fontWeight: 800, cursor: minting ? 'default' : 'pointer', opacity: minting ? 0.7 : 1 }}>{minting ? 'Generating…' : '+ Generate key'}</button>
          </div>

          {/* Agent tabs + instructions (Motion-style) */}
          <div style={{ border: '1px solid #eef0ee', borderRadius: 16, overflow: 'hidden', marginBottom: 24 }}>
            <div style={{ display: 'flex', gap: 4, padding: 6, background: '#f7faf6', borderBottom: '1px solid #eef0ee', overflowX: 'auto' }}>
              {AGENTS.map(a => (
                <button key={a.id} onClick={() => setAgent(a.id)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 10, border: 'none', cursor: 'pointer', fontSize: 13.5, fontWeight: 700, whiteSpace: 'nowrap', fontFamily: 'inherit',
                    background: agent === a.id ? '#fff' : 'transparent', color: agent === a.id ? INK : '#6b7280', boxShadow: agent === a.id ? '0 1px 4px rgba(0,0,0,0.08)' : 'none' }}>
                  <span>{a.icon}</span> {a.label}
                </button>
              ))}
            </div>
            <div style={{ padding: '20px 22px', display: 'grid', gridTemplateColumns: guide(agent).code ? 'minmax(0,1fr) minmax(0,1.1fr)' : '1fr', gap: 20 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 800, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 12 }}>Instructions</div>
                <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {guide(agent).steps.map((s, i) => <li key={i} style={{ fontSize: 14, lineHeight: 1.5, color: '#374151' }}>{s}</li>)}
                </ol>
                {!latest && <div style={{ marginTop: 14, fontSize: 12.5, color: '#9a6b1a', background: '#fdf6e3', border: '1px solid #f2e2b8', borderRadius: 8, padding: '8px 12px' }}>Generate a key above — it fills in automatically here.</div>}
              </div>
              {guide(agent).code && (
                <div style={{ background: INK, color: '#e8ece7', borderRadius: 12, padding: 16, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ fontSize: 11.5, fontWeight: 800, color: LIME, textTransform: 'uppercase', letterSpacing: '.05em' }}>{agent === 'cli' ? 'Terminal' : 'Config'}</span>
                    <span onClick={() => copy(guide(agent).code!, 'code:' + agent)} style={{ fontSize: 12, fontWeight: 700, color: LIME, cursor: 'pointer' }}>{copied === 'code:' + agent ? 'copied ✓' : 'copy'}</span>
                  </div>
                  <pre style={{ fontSize: 12, lineHeight: 1.55, overflowX: 'auto', margin: 0, whiteSpace: 'pre' }}>{guide(agent).code}</pre>
                </div>
              )}
            </div>
          </div>

          {/* Existing keys */}
          {keys.length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 800, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 }}>Your keys</div>
              {keys.map(k => (
                <div key={k.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', border: '1px solid #eef0ee', borderRadius: 10, marginBottom: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{k.label}</div>
                    <code style={{ fontSize: 12, color: '#6b7280' }}>{k.token.slice(0, 14)}…{k.token.slice(-4)}</code>
                    <span onClick={() => copy(k.token, k.id)} style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: '#16a34a', cursor: 'pointer' }}>{copied === k.id ? 'copied ✓' : 'copy'}</span>
                  </div>
                  <button onClick={() => revoke(k.id)} style={{ background: 'none', border: '1px solid #fecaca', color: '#dc2626', padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Revoke</button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      <style>{`.mcp-pulse{animation:mcpPulse 1.2s ease-in-out infinite}@keyframes mcpPulse{0%,100%{opacity:1}50%{opacity:.55}}`}</style>
    </div>
  )
}
