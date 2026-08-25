'use client'
/**
 * ConnectGuide — an in-app ANIMATED walkthrough (a mini "video") that plays through the exact clicks a
 * merchant makes in their Shopify admin to create a custom app, grant scopes, install it, reveal the
 * Admin API token, and paste it into Selfmade. Pure CSS/React (no video file): a mock browser window,
 * an animated cursor, ticking checkboxes and a typing effect, with auto-advance + replay. Opened as a
 * modal from the Connect Shopify screen so users never have to read a wall of steps.
 */
import { useEffect, useRef, useState } from 'react'

const INK = '#141d15', SUB = '#7a9a7a', LIME = '#ff5a2c', LINE = 'rgba(0,0,0,0.10)'
const SHOP_BG = '#1a1a1a', SHOP_PANEL = '#f6f6f7'

const SCOPES = ['read_products', 'write_products', 'read_orders', 'read_inventory', 'read_content', 'write_content']

type Step = { tag: string; title: string; caption: string }
const STEPS: Step[] = [
  { tag: 'Step 1', title: 'Open Develop apps', caption: 'In your store: Settings → Apps and sales channels → Develop apps.' },
  { tag: 'Step 2', title: 'Create an app', caption: 'Click “Create an app” and name it “Selfmade”.' },
  { tag: 'Step 3', title: 'Add the permissions', caption: 'Configuration → Admin API scopes → tick these six, then Save.' },
  { tag: 'Step 4', title: 'Install the app', caption: 'Hit Install to activate it on your store.' },
  { tag: 'Step 5', title: 'Reveal the token', caption: 'API credentials → reveal your Admin API access token (shpat_…). Copy it.' },
  { tag: 'Step 6', title: 'Paste into Selfmade', caption: 'Paste the token + your store URL here — connected!' },
]

const DURATION = 3200

export default function ConnectGuide({ onClose }: { onClose: () => void }) {
  const [i, setI] = useState(0)
  const [playing, setPlaying] = useState(true)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!playing) return
    timer.current = setTimeout(() => setI((x) => (x + 1) % STEPS.length), DURATION)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [i, playing])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const go = (n: number) => { setPlaying(false); setI(n) }
  const step = STEPS[i]

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(10,14,10,0.55)', backdropFilter: 'blur(4px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
    >
      <style>{KEYFRAMES}</style>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 560, background: '#fff', borderRadius: 20, overflow: 'hidden', boxShadow: '0 30px 80px rgba(0,0,0,0.35)', fontFamily: 'Inter, system-ui, sans-serif' }}
      >
        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: `1px solid ${LINE}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 15, fontWeight: 800, color: INK }}>How to connect your store</span>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: SUB }}>~30 seconds</span>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', fontSize: 20, lineHeight: 1, color: SUB, cursor: 'pointer' }}>×</button>
        </div>

        {/* stage — a mock Shopify browser window */}
        <div style={{ background: '#eef0ee', padding: 20 }}>
          <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', border: `1px solid ${LINE}`, boxShadow: '0 8px 24px rgba(0,0,0,0.08)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 12px', background: SHOP_BG }}>
              <Dot c="#ff5f57" /><Dot c="#febc2e" /><Dot c="#28c840" />
              <div style={{ flex: 1, marginLeft: 8, background: '#2e2e2e', borderRadius: 6, height: 18, display: 'flex', alignItems: 'center', padding: '0 10px' }}>
                <span style={{ fontSize: 10.5, color: '#9aa', fontFamily: 'ui-monospace, monospace' }}>
                  {i >= 5 ? 'app.tryselfmade.ai/connect/shopify' : 'admin.shopify.com'}
                </span>
              </div>
            </div>
            <div style={{ position: 'relative', height: 260, background: i >= 5 ? '#faf9f5' : SHOP_PANEL }}>
              <Scene i={i} />
            </div>
          </div>
        </div>

        {/* caption */}
        <div style={{ padding: '16px 20px 8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: LIME }}>{step.tag}</span>
            <span style={{ fontSize: 15, fontWeight: 800, color: INK }}>{step.title}</span>
          </div>
          <div style={{ fontSize: 13.5, color: SUB, lineHeight: 1.5, minHeight: 40 }}>{step.caption}</div>
        </div>

        {/* controls */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 20px 18px' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {STEPS.map((_, n) => (
              <button key={n} onClick={() => go(n)} aria-label={`Step ${n + 1}`} style={{
                width: n === i ? 22 : 8, height: 8, borderRadius: 100, border: 'none', cursor: 'pointer',
                background: n === i ? LIME : n < i ? '#c9d6c9' : LINE, transition: 'width .3s, background .3s', padding: 0,
              }} />
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setPlaying((p) => !p)} style={ghostBtn}>{playing ? 'Pause' : 'Play'}</button>
            {i === STEPS.length - 1
              ? <button onClick={onClose} style={primeBtn}>Got it →</button>
              : <button onClick={() => go(Math.min(i + 1, STEPS.length - 1))} style={primeBtn}>Next</button>}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── Scenes ─────────────────────────────────────────────────────────────── */
function Scene({ i }: { i: number }) {
  return (
    <div key={i} style={{ position: 'absolute', inset: 0, padding: 16, animation: 'sfg-fade .45s ease both' }}>
      {i === 0 && <SceneDevelop />}
      {i === 1 && <SceneCreate />}
      {i === 2 && <SceneScopes />}
      {i === 3 && <SceneInstall />}
      {i === 4 && <SceneToken />}
      {i === 5 && <ScenePaste />}
    </div>
  )
}

function SidebarRow({ label, active }: { label: string; active?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 8px', borderRadius: 7, background: active ? '#e3f1dd' : 'transparent' }}>
      <span style={{ width: 12, height: 12, borderRadius: 3, background: active ? LIME : '#c7ccc7' }} />
      <span style={{ fontSize: 11.5, fontWeight: active ? 800 : 600, color: active ? INK : '#6b736b' }}>{label}</span>
    </div>
  )
}

function SceneDevelop() {
  return (
    <div style={{ display: 'flex', gap: 12, height: '100%' }}>
      <div style={{ width: 150, background: '#fff', borderRadius: 10, border: `1px solid ${LINE}`, padding: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <SidebarRow label="Apps and sales channels" active />
        <SidebarRow label="Domains" />
        <SidebarRow label="Checkout" />
        <SidebarRow label="Notifications" />
      </div>
      <div style={{ flex: 1, background: '#fff', borderRadius: 10, border: `1px solid ${LINE}`, padding: 14, position: 'relative' }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: INK }}>Apps and sales channels</div>
        <div style={{ fontSize: 11, color: SUB, marginTop: 6, lineHeight: 1.5 }}>Manage what’s installed on your store.</div>
        <div style={{ marginTop: 18, display: 'inline-flex', position: 'relative' }}>
          <Pill label="Develop apps" hot />
          <Cursor x={70} y={16} />
        </div>
      </div>
    </div>
  )
}

function SceneCreate() {
  return (
    <div style={{ background: '#fff', borderRadius: 10, border: `1px solid ${LINE}`, padding: 16, height: '100%', position: 'relative' }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: INK }}>Create an app</div>
      <div style={{ marginTop: 14, fontSize: 11, fontWeight: 700, color: SUB }}>App name</div>
      <div style={{ marginTop: 6, border: `1.5px solid ${LIME}`, borderRadius: 8, padding: '9px 12px', fontSize: 13, fontWeight: 700, color: INK, background: '#fff', width: 220 }}>
        <span>Selfmade</span><span style={{ animation: 'sfg-blink 1s steps(1) infinite', color: LIME }}>|</span>
      </div>
      <div style={{ marginTop: 22, display: 'inline-flex', position: 'relative' }}>
        <Pill label="Create app" hot />
        <Cursor x={62} y={16} />
      </div>
    </div>
  )
}

function SceneScopes() {
  return (
    <div style={{ background: '#fff', borderRadius: 10, border: `1px solid ${LINE}`, padding: '14px 16px', height: '100%' }}>
      <div style={{ fontSize: 12.5, fontWeight: 800, color: INK }}>Admin API access scopes</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '7px 14px', marginTop: 12 }}>
        {SCOPES.map((s, n) => (
          <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              width: 15, height: 15, borderRadius: 4, background: LIME, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              animation: `sfg-tick .3s ease both`, animationDelay: `${0.15 + n * 0.28}s`, transform: 'scale(0)',
            }}>
              <svg width="9" height="9" viewBox="0 0 12 12"><path d="M2 6.5l2.5 2.5 5.5-6" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </span>
            <span style={{ fontSize: 11, fontFamily: 'ui-monospace, monospace', color: INK }}>{s}</span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 16, display: 'inline-flex', position: 'relative' }}>
        <Pill label="Save" hot />
      </div>
    </div>
  )
}

function SceneInstall() {
  return (
    <div style={{ background: '#fff', borderRadius: 10, border: `1px solid ${LINE}`, padding: 16, height: '100%', position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: INK }}>Selfmade</div>
      <div style={{ fontSize: 11, color: SUB }}>Install this app on your store</div>
      <div style={{ position: 'relative', display: 'inline-flex' }}>
        <Pill label="Install app" hot big />
        <Cursor x={78} y={20} />
      </div>
    </div>
  )
}

function SceneToken() {
  return (
    <div style={{ background: '#fff', borderRadius: 10, border: `1px solid ${LINE}`, padding: 16, height: '100%' }}>
      <div style={{ fontSize: 12.5, fontWeight: 800, color: INK }}>API credentials</div>
      <div style={{ fontSize: 11, fontWeight: 700, color: SUB, marginTop: 14 }}>Admin API access token</div>
      <div style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'center' }}>
        <div style={{ flex: 1, border: `1.5px solid ${LINE}`, borderRadius: 8, padding: '9px 12px', fontSize: 12, fontFamily: 'ui-monospace, monospace', color: INK, background: '#f8faf8', overflow: 'hidden', whiteSpace: 'nowrap' }}>
          shpat_a1b2c3d4e5f6g7h8i9j0
        </div>
        <div style={{ position: 'relative' }}>
          <Pill label="Copy" hot />
          <span style={{ position: 'absolute', top: -22, left: '50%', transform: 'translateX(-50%)', fontSize: 10, fontWeight: 800, color: '#256029', background: '#eaf6e6', borderRadius: 6, padding: '2px 7px', whiteSpace: 'nowrap', animation: 'sfg-fade .4s ease both', animationDelay: '.8s', opacity: 0 }}>Copied ✓</span>
        </div>
      </div>
      <div style={{ fontSize: 10.5, color: SUB, marginTop: 10, lineHeight: 1.5 }}>Starts with <b>shpat_</b> — this is the only key you paste into Selfmade.</div>
    </div>
  )
}

function ScenePaste() {
  return (
    <div style={{ padding: 6, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 10 }}>
      <div style={{ fontSize: 12.5, fontWeight: 800, color: INK }}>Connect your Shopify store</div>
      <div>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: SUB }}>Store URL</div>
        <div style={{ marginTop: 4, border: `1.5px solid ${LINE}`, borderRadius: 8, padding: '8px 11px', fontSize: 12, color: INK, background: '#fff' }}>your-store.myshopify.com</div>
      </div>
      <div>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: SUB }}>Admin API token</div>
        <div style={{ marginTop: 4, border: `1.5px solid ${LIME}`, borderRadius: 8, padding: '8px 11px', fontSize: 12, fontFamily: 'ui-monospace, monospace', color: INK, background: '#fff' }}>
          shpat_a1b2c3d4e5f6g7h8i9j0<span style={{ animation: 'sfg-blink 1s steps(1) infinite', color: LIME }}>|</span>
        </div>
      </div>
      <div style={{ position: 'relative', display: 'inline-flex', marginTop: 2 }}>
        <Pill label="Connect with token" hot big />
        <span style={{ marginLeft: 10, alignSelf: 'center', fontSize: 11, fontWeight: 800, color: '#256029', background: '#eaf6e6', borderRadius: 20, padding: '3px 10px', animation: 'sfg-fade .5s ease both', animationDelay: '1s', opacity: 0 }}>Connected ✓</span>
      </div>
    </div>
  )
}

/* ── atoms ──────────────────────────────────────────────────────────────── */
function Dot({ c }: { c: string }) { return <span style={{ width: 10, height: 10, borderRadius: 100, background: c, display: 'inline-block' }} /> }
function Pill({ label, hot, big }: { label: string; hot?: boolean; big?: boolean }) {
  return (
    <span style={{
      display: 'inline-block', background: hot ? LIME : '#fff', color: hot ? '#fff' : INK, border: hot ? 'none' : `1.5px solid ${LINE}`,
      borderRadius: 8, padding: big ? '10px 18px' : '7px 13px', fontSize: big ? 13 : 12, fontWeight: 800,
      animation: hot ? 'sfg-pulse 1.4s ease-in-out infinite' : undefined,
    }}>{label}</span>
  )
}
function Cursor({ x, y }: { x: number; y: number }) {
  return (
    <span style={{ position: 'absolute', left: x, top: y, animation: 'sfg-tap 1.4s ease-in-out infinite', pointerEvents: 'none' }}>
      <svg width="18" height="18" viewBox="0 0 24 24"><path d="M4 2l6 16 2.5-6.5L19 9z" fill="#141d15" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" /></svg>
    </span>
  )
}

const ghostBtn: React.CSSProperties = { background: '#fff', border: `1.5px solid ${LINE}`, color: INK, borderRadius: 100, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }
const primeBtn: React.CSSProperties = { background: LIME, border: 'none', color: '#fff', borderRadius: 100, padding: '8px 18px', fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }

const KEYFRAMES = `
@keyframes sfg-fade { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }
@keyframes sfg-pulse { 0%,100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(255,90,44,0.4) } 50% { transform: scale(1.04); box-shadow: 0 0 0 8px rgba(255,90,44,0) } }
@keyframes sfg-tap { 0%,100% { transform: translate(0,0) } 45% { transform: translate(-4px,-4px) } 55% { transform: translate(-4px,-4px) } }
@keyframes sfg-tick { to { transform: scale(1) } }
@keyframes sfg-blink { 50% { opacity: 0 } }
`
