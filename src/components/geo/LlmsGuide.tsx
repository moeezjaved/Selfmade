'use client'
/**
 * LlmsGuide — a short, auto-advancing "video-style" walkthrough for placing an llms.txt file at the site
 * root, because Shopify has no native way to serve a root file via the API (so we can't auto-apply it).
 * Motion-first (Remotion-style slides: fade/slide + a scrubber that auto-advances, play/pause, dots),
 * but it's a self-contained CSS player — no MP4 render, no fabricated Shopify screenshots. Honest: it
 * teaches the reliable paths (Cloudflare rule / a root-file app / your developer) and hands over the file.
 */
import { useEffect, useMemo, useRef, useState } from 'react'

const ORANGE = '#ef4a1e', INK = '#141d15', SUB = '#7a9a7a', LINE = 'rgba(0,0,0,0.08)'

type Slide = { key: string; kicker: string; title: string; body: React.ReactNode; secs: number }

export default function LlmsGuide({ content, domain, onClose }: { content: string; domain?: string | null; onClose: () => void }) {
  const host = (domain || 'yourstore.com').replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  const [copied, setCopied] = useState(false)
  const copy = async () => { try { await navigator.clipboard.writeText(content); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch { /* ignore */ } }
  const download = () => {
    try {
      const blob = new Blob([content], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = 'llms.txt'; document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 2000)
    } catch { /* ignore */ }
  }

  const slides: Slide[] = useMemo(() => [
    {
      key: 'what', kicker: 'Step 0 — why', title: 'This is how AI engines learn your brand',
      secs: 6,
      body: <>An <b>llms.txt</b> file is a plain-text brief that ChatGPT, Perplexity &amp; Gemini read to understand who you are and what you sell — so they cite <b>you</b>. It has to live at your site <b>root</b>: <code>{host}/llms.txt</code>.</>,
    },
    {
      key: 'copy', kicker: 'Step 1 — get the file', title: 'Copy or download your llms.txt',
      secs: 7,
      body: <>We already wrote it from your real brand + products. Grab it now — you&rsquo;ll place this exact text at your root.
        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          <button onClick={copy} style={btn(true)}>{copied ? 'Copied ✓' : 'Copy llms.txt'}</button>
          <button onClick={download} style={btn(false)}>Download file</button>
        </div>
      </>,
    },
    {
      key: 'why-shopify', kicker: 'Step 2 — the catch', title: 'Shopify can’t host a root file for you',
      secs: 7,
      body: <>Shopify serves your theme, not arbitrary files at the domain root — so there&rsquo;s no &ldquo;upload to <code>/llms.txt</code>&rdquo; button, and a <code>/pages/…</code> page won&rsquo;t be found. You place it one level up, at the domain. Two reliable ways next →</>,
    },
    {
      key: 'cloudflare', kicker: 'Step 3 — easiest', title: 'If your domain is on Cloudflare',
      secs: 9,
      body: <>Cloudflare sits in front of your store and can serve the file directly:
        <ol style={{ margin: '10px 0 0', paddingLeft: 18, lineHeight: 1.7 }}>
          <li>Cloudflare dashboard → your domain → <b>Rules → Snippets</b> (or a Worker).</li>
          <li>Serve the copied text at path <code>/llms.txt</code> with content-type <code>text/plain</code>.</li>
          <li>Deploy. Done — no theme edits, nothing to break.</li>
        </ol>
      </>,
    },
    {
      key: 'alt', kicker: 'Step 3 — alternatives', title: 'No Cloudflare? Two other ways',
      secs: 8,
      body: <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.8 }}>
        <li>Install a Shopify app that adds <b>custom root files</b> (search the App Store for &ldquo;root file&rdquo; / &ldquo;robots &amp; llms&rdquo;).</li>
        <li>Send the file to your developer — it&rsquo;s a 2-minute drop at the domain root or edge.</li>
      </ul>,
    },
    {
      key: 'verify', kicker: 'Step 4 — verify', title: 'Check it’s live',
      secs: 7,
      body: <>Open <code>https://{host}/llms.txt</code> in your browser. If you see your text (not a 404 or your storefront), you&rsquo;re done — AI crawlers can now read it.
        <div style={{ marginTop: 14 }}><a href={`https://${host}/llms.txt`} target="_blank" rel="noopener noreferrer" style={btn(true)}>Open {host}/llms.txt →</a></div>
      </>,
    },
  ], [host, copied, content])

  // ── the "video" transport: auto-advance with a smooth progress scrubber, play/pause, click-to-seek ──
  const [i, setI] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [prog, setProg] = useState(0)  // 0..1 within the current slide
  const raf = useRef<number | null>(null)
  const startedAt = useRef<number>(0)
  const cur = slides[i]

  useEffect(() => {
    if (!playing) return
    startedAt.current = performance.now() - prog * cur.secs * 1000
    const tick = (now: number) => {
      const p = Math.min(1, (now - startedAt.current) / (cur.secs * 1000))
      setProg(p)
      if (p >= 1) { if (i < slides.length - 1) { setI(i + 1); setProg(0) } else { setPlaying(false) } return }
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => { if (raf.current) cancelAnimationFrame(raf.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, playing])

  const goto = (n: number) => { setI(Math.max(0, Math.min(slides.length - 1, n))); setProg(0); setPlaying(true) }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); if (e.key === 'ArrowRight') goto(i + 1); if (e.key === 'ArrowLeft') goto(i - 1); if (e.key === ' ') { e.preventDefault(); setPlaying(p => !p) } }
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i])

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(20,29,21,0.55)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 'min(680px, 96vw)', background: '#fff', borderRadius: 22, overflow: 'hidden', boxShadow: '0 30px 80px rgba(20,29,21,0.35)', fontFamily: 'inherit' }}>
        {/* stage */}
        <div style={{ position: 'relative', background: 'linear-gradient(160deg,#fff 0%,#fbf7f2 100%)', padding: '30px 34px 26px', minHeight: 320 }}>
          <button onClick={onClose} aria-label="Close" style={{ position: 'absolute', top: 16, right: 16, border: 'none', background: 'rgba(0,0,0,0.05)', width: 30, height: 30, borderRadius: 100, cursor: 'pointer', fontSize: 15, color: INK }}>✕</button>
          <div key={cur.key} style={{ animation: 'llmSlideIn .5s cubic-bezier(.16,.84,.44,1)' }}>
            <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: ORANGE, marginBottom: 10 }}>{cur.kicker}</div>
            <div style={{ fontSize: 25, fontWeight: 800, color: INK, lineHeight: 1.15, marginBottom: 12, letterSpacing: '-0.01em' }}>{cur.title}</div>
            <div style={{ fontSize: 15, color: '#3c473c', lineHeight: 1.6 }}>{cur.body}</div>
          </div>
        </div>

        {/* transport */}
        <div style={{ borderTop: `1px solid ${LINE}`, padding: '12px 18px 14px', background: '#fff' }}>
          {/* segmented progress (one bar per slide, current one fills) */}
          <div style={{ display: 'flex', gap: 5, marginBottom: 11 }}>
            {slides.map((s, n) => (
              <button key={s.key} onClick={() => goto(n)} style={{ flex: 1, height: 4, borderRadius: 4, border: 'none', padding: 0, cursor: 'pointer', background: 'rgba(0,0,0,0.08)', overflow: 'hidden' }} title={s.title}>
                <div style={{ height: '100%', width: `${n < i ? 100 : n === i ? prog * 100 : 0}%`, background: ORANGE, transition: n === i ? 'none' : 'width .3s' }} />
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={() => setPlaying(p => !p)} style={ctrl()}>{playing ? '❚❚' : '▶'}</button>
            <button onClick={() => goto(i - 1)} disabled={i === 0} style={{ ...ctrl(), opacity: i === 0 ? 0.4 : 1 }}>‹</button>
            <button onClick={() => goto(i + 1)} disabled={i === slides.length - 1} style={{ ...ctrl(), opacity: i === slides.length - 1 ? 0.4 : 1 }}>›</button>
            <div style={{ fontSize: 12.5, color: SUB, marginLeft: 4 }}>{i + 1} / {slides.length}</div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <button onClick={copy} style={btn(false, true)}>{copied ? 'Copied ✓' : 'Copy'}</button>
              <button onClick={download} style={btn(true, true)}>Download llms.txt</button>
            </div>
          </div>
        </div>
      </div>
      <style>{`@keyframes llmSlideIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}`}</style>
    </div>
  )
}

function btn(primary: boolean, small = false): React.CSSProperties {
  return {
    display: 'inline-block', border: primary ? 'none' : `1px solid ${LINE}`, background: primary ? ORANGE : '#fff',
    color: primary ? '#fff' : INK, padding: small ? '7px 13px' : '9px 18px', borderRadius: 100,
    fontSize: small ? 12.5 : 13.5, fontWeight: 750, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'none',
  }
}
function ctrl(): React.CSSProperties {
  return { width: 30, height: 30, borderRadius: 100, border: `1px solid ${LINE}`, background: '#fff', cursor: 'pointer', fontSize: 12, color: INK, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }
}
