'use client'
/**
 * Connect your Shopify store — the one-click door (OAuth) with a paste-token fallback (BYO custom app).
 * Enter the store domain → Connect → Shopify's approve screen → back here with the catalog synced. Reads
 * live connection state from GET /api/shopify/connect and shows real catalog health.
 */
import { useEffect, useState, useCallback, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'

const INK = '#141d15', SUB = '#7a9a7a', LIME = '#ff5a2c', LINE = 'rgba(0,0,0,0.08)', PAPER = '#faf9f5'

type Health = { products: number; missingSeoTitle: number; missingSeoDesc: number; imagesMissingAlt: number; drafts: number }
type Status = {
  connected: boolean; shop_domain?: string; shop_name?: string; plan_name?: string
  currency?: string; last_sync?: string; health?: Health | null
}

const STATUS_MSG: Record<string, { tone: 'ok' | 'err' | 'info'; text: string }> = {
  connected: { tone: 'ok', text: 'Store connected — your catalog is synced below.' },
  error: { tone: 'err', text: 'Something went wrong connecting. Try again.' },
  unconfigured: { tone: 'err', text: 'Shopify OAuth isn’t configured yet (missing app keys). Use the paste-token option below, or ask an admin.' },
  badshop: { tone: 'err', text: 'That doesn’t look like a store URL. Use your-store.myshopify.com.' },
  retry: { tone: 'info', text: 'You’re logged in now — hit Connect again.' },
}
const ERR_WHY: Record<string, string> = {
  hmac: 'Shopify’s signature didn’t verify.', state: 'Session expired — start again.',
  exchange: 'Couldn’t exchange the code for a token.', validate: 'Connected, but reading the store failed.',
  badparams: 'Missing parameters from Shopify.', shopmismatch: 'The store didn’t match. Start again.',
}

function ConnectShopifyInner() {
  const params = useSearchParams()
  const status = params.get('status') || ''
  const why = params.get('why') || ''
  const [state, setState] = useState<Status | null>(null)
  const [loading, setLoading] = useState(true)
  const [shop, setShop] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ tone: 'ok' | 'err' | 'info'; text: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try { const r = await fetch('/api/shopify/connect'); const j = await r.json(); setState(j) } catch { setState({ connected: false }) }
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (status && STATUS_MSG[status]) {
      const m = STATUS_MSG[status]
      setNote({ tone: m.tone, text: status === 'error' && why && ERR_WHY[why] ? `${m.text} (${ERR_WHY[why]})` : m.text })
    }
  }, [status, why])

  const connectOAuth = () => {
    const s = shop.trim()
    if (!s) { setNote({ tone: 'err', text: 'Enter your store URL first.' }); return }
    window.location.href = `/api/shopify/oauth/init?shop=${encodeURIComponent(s)}`
  }

  const connectToken = async () => {
    if (!shop.trim() || !token.trim()) { setNote({ tone: 'err', text: 'Enter both the store URL and the Admin API token.' }); return }
    setBusy(true); setNote(null)
    try {
      const r = await fetch('/api/shopify/connect', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ shop: shop.trim(), token: token.trim() }),
      })
      const j = await r.json()
      if (r.ok && j.ok) { setNote({ tone: 'ok', text: `Connected ${j.shop_name || j.shop_domain}.` }); setToken(''); await load() }
      else setNote({ tone: 'err', text: j.error || 'Could not connect.' })
    } catch { setNote({ tone: 'err', text: 'Network error — try again.' }) }
    setBusy(false)
  }

  const s = state
  const h = s?.health

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '40px 20px 80px', fontFamily: 'Inter, system-ui, sans-serif', color: INK }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
        <ShopifyMark />
        <h1 style={{ fontSize: 27, fontWeight: 800, letterSpacing: '-.02em', margin: 0 }}>Connect your Shopify store</h1>
      </div>
      <p style={{ color: SUB, fontSize: 15, margin: '0 0 24px', lineHeight: 1.5 }}>
        This is what your Shopify agents run on — product rewrites, inventory, revenue, publish-to-blog. One click, read-only until you approve any change.
      </p>

      {note && (
        <div style={{
          borderRadius: 12, padding: '12px 16px', marginBottom: 20, fontSize: 14, fontWeight: 600,
          background: note.tone === 'ok' ? '#eaf6e6' : note.tone === 'err' ? '#fdecea' : '#eef4fb',
          color: note.tone === 'ok' ? '#256029' : note.tone === 'err' ? '#a3271b' : '#28527a',
          border: `1px solid ${note.tone === 'ok' ? '#bfe3b6' : note.tone === 'err' ? '#f3c6bf' : '#cddcf0'}`,
        }}>{note.text}</div>
      )}

      {loading ? (
        <div style={{ color: SUB, fontSize: 14 }}>Checking connection…</div>
      ) : s?.connected ? (
        <div style={{ border: `1px solid ${LINE}`, borderRadius: 16, background: '#fff', padding: 22 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div style={{ fontSize: 17, fontWeight: 800 }}>{s.shop_name || s.shop_domain} <span style={{ fontSize: 12, fontWeight: 800, color: '#256029', background: '#eaf6e6', borderRadius: 20, padding: '3px 10px', marginLeft: 6 }}>Connected ✓</span></div>
              <div style={{ fontSize: 13, color: SUB, marginTop: 3 }}>{s.shop_domain}{s.plan_name ? ` · ${s.plan_name}` : ''}{s.currency ? ` · ${s.currency}` : ''}</div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12, marginTop: 20 }}>
            <Stat label="Products" value={h?.products ?? '—'} />
            <Stat label="Missing SEO title" value={h?.missingSeoTitle ?? '—'} warn={!!h && h.missingSeoTitle > 0} />
            <Stat label="Missing SEO desc" value={h?.missingSeoDesc ?? '—'} warn={!!h && h.missingSeoDesc > 0} />
            <Stat label="Images w/o alt" value={h?.imagesMissingAlt ?? '—'} warn={!!h && h.imagesMissingAlt > 0} />
            <Stat label="Draft products" value={h?.drafts ?? '—'} />
          </div>
          <div style={{ marginTop: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 12.5, color: SUB }}>
              {s.last_sync ? `Last synced ${new Date(s.last_sync).toLocaleString()}` : 'Not yet synced'}
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <a href="/mission/blog" style={{ background: '#fff', color: INK, border: `1.5px solid ${LINE}`, padding: '9px 16px', borderRadius: 100, fontSize: 13.5, fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap' }}>Write a blog →</a>
              <a href="/mission/catalog" style={{ background: LIME, color: '#fff', padding: '9px 18px', borderRadius: 100, fontSize: 13.5, fontWeight: 800, textDecoration: 'none', whiteSpace: 'nowrap' }}>Fix these gaps →</a>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ border: `1px solid ${LINE}`, borderRadius: 16, background: PAPER, padding: 22 }}>
          <label style={{ fontSize: 13, fontWeight: 700, color: INK }}>Your store URL</label>
          <input
            value={shop} onChange={(e) => setShop(e.target.value)} placeholder="your-store.myshopify.com"
            style={{ width: '100%', marginTop: 8, padding: '12px 14px', fontSize: 15, borderRadius: 10, border: `1.5px solid ${LINE}`, background: '#fff', fontFamily: 'inherit', boxSizing: 'border-box' }}
          />
          <button onClick={connectOAuth} style={{
            marginTop: 14, width: '100%', background: LIME, color: '#fff', border: 'none', borderRadius: 100,
            padding: '13px 20px', fontSize: 15, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit',
          }}>Connect Shopify →</button>
          <div style={{ fontSize: 12.5, color: SUB, marginTop: 10, textAlign: 'center' }}>
            You’ll approve the permissions on Shopify’s own screen. We never see your password.
          </div>

          <div style={{ borderTop: `1px solid ${LINE}`, margin: '20px 0 0', paddingTop: 16 }}>
            <button onClick={() => setShowToken((v) => !v)} style={{ background: 'none', border: 'none', color: SUB, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
              {showToken ? '− Hide' : '+ Advanced'}: paste an Admin API token instead
            </button>
            {showToken && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 12.5, color: SUB, marginBottom: 8, lineHeight: 1.5 }}>
                  For a custom app: in your store, Settings → Apps → Develop apps → your app → API credentials → reveal the Admin API access token (<code>shpat_…</code>).
                </div>
                <input
                  value={token} onChange={(e) => setToken(e.target.value)} placeholder="shpat_…" type="password"
                  style={{ width: '100%', padding: '11px 14px', fontSize: 14, borderRadius: 10, border: `1.5px solid ${LINE}`, background: '#fff', fontFamily: 'inherit', boxSizing: 'border-box' }}
                />
                <button onClick={connectToken} disabled={busy} style={{
                  marginTop: 10, background: INK, color: '#fff', border: 'none', borderRadius: 100,
                  padding: '10px 20px', fontSize: 14, fontWeight: 800, cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit', opacity: busy ? 0.6 : 1,
                }}>{busy ? 'Connecting…' : 'Connect with token'}</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, warn }: { label: string; value: number | string; warn?: boolean }) {
  return (
    <div style={{ border: `1px solid ${LINE}`, borderRadius: 12, padding: '12px 14px', background: '#fff' }}>
      <div style={{ fontSize: 22, fontWeight: 800, color: warn ? LIME : INK, letterSpacing: '-.02em' }}>{value}</div>
      <div style={{ fontSize: 11.5, color: SUB, marginTop: 2, fontWeight: 600 }}>{label}</div>
    </div>
  )
}

function ShopifyMark() {
  return (
    <svg width="30" height="34" viewBox="0 0 448 512" aria-hidden="true">
      <path fill="#95BF47" d="M388 92c-.3-2-2-3.2-3.5-3.3-1.5-.1-31.6-2.4-31.6-2.4s-21-20.8-23.3-23.1c-2.3-2.3-6.8-1.6-8.6-1.1-.3.1-4.7 1.4-11.9 3.7-7.1-20.5-19.6-39.3-41.6-39.3h-1.9C258 12.4 250.4 8 243.8 8c-51.6 0-76.3 64.5-84 97.3-20.1 6.2-34.4 10.6-36.2 11.2-11.2 3.5-11.5 3.9-13 14.5C109.5 139 80 366.3 80 366.3L307.9 409l123.4-26.7S388.3 94 388 92zM280.5 65.6c-5.6 1.7-12 3.7-18.9 5.8 0-1.3.1-2.7.1-4.1 0-12.4-1.7-22.4-4.5-30.3 11.2 1.4 18.7 14.2 23.2 28.6zm-37.1-26.2c3.1 7.8 5.1 19 5.1 34.2 0 .8 0 1.5-.1 2.2-12.3 3.8-25.6 7.9-39 12.1 7.5-29 21.6-43 34-48.5zm-15-14.2c2.2 0 4.4.8 6.5 2.2-16.3 7.7-33.8 27-41.2 65.6l-30.8 9.5C176 76.6 197 25.2 228.4 25.2z"/>
      <path fill="#5E8E3E" d="M384.5 88.7c-1.5-.1-31.6-2.4-31.6-2.4s-21-20.8-23.3-23.1c-.9-.9-2-1.3-3.2-1.5L308 409l123.4-26.7S388.3 94 388 92c-.4-2-2-3.2-3.5-3.3z"/>
      <path fill="#FFF" d="M275.9 168.8l-15.2 45.3s-13.3-7.1-29.7-7.1c-24 0-25.2 15.1-25.2 18.9 0 20.8 54.1 28.7 54.1 77.3 0 38.3-24.3 62.9-57 62.9-39.3 0-59.3-24.4-59.3-24.4l10.5-34.8s20.6 17.7 38 17.7c11.4 0 16-8.9 16-15.5 0-27.1-44.4-28.3-44.4-72.8 0-37.5 26.9-73.8 81.2-73.8 20.9 0 31.2 6 31.2 6z"/>
    </svg>
  )
}

export default function ConnectShopifyPage() {
  return (
    <Suspense fallback={<div style={{ padding: 40, color: SUB }}>Loading…</div>}>
      <ConnectShopifyInner />
    </Suspense>
  )
}
