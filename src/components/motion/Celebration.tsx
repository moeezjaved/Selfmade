'use client'
/**
 * Celebration — the app's "you just did something that makes money" moment. Any surface fires a big-win
 * celebration with one line: celebrate({ title, sub }) (see src/lib/celebrate.ts). This host listens and
 * plays a confetti/donut burst + a message card with personality. A subtle Simpsons NOD (donuts, sunny
 * yellow, a cheerful "woo-hoo" energy) — an homage to the landing video, not the trademarked characters.
 */
import { useEffect, useRef, useState } from 'react'

type Payload = { title: string; sub?: string; emoji?: string }

const COLORS = ['#ff5a2c', '#ffc21a', '#ff6fae', '#ffffff', '#7ec8ff']

function runConfetti(canvas: HTMLCanvasElement): () => void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return () => {}
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const W = canvas.clientWidth, H = canvas.clientHeight
  canvas.width = W * dpr; canvas.height = H * dpr; ctx.scale(dpr, dpr)
  type P = { x: number; y: number; vx: number; vy: number; c: string; s: number; rot: number; vr: number; donut: boolean }
  const parts: P[] = []
  const burst = (cx: number, cy: number, n: number, power: number) => {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2
      const sp = power * (0.3 + Math.random())
      const donut = Math.random() < 0.09
      parts.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - power * 0.45, c: COLORS[(Math.random() * COLORS.length) | 0], s: donut ? 20 : 5 + Math.random() * 6, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, donut })
    }
  }
  burst(W * 0.5, H * 0.4, 100, 9)
  const t1 = setTimeout(() => burst(W * 0.25, H * 0.5, 55, 8), 220)
  const t2 = setTimeout(() => burst(W * 0.75, H * 0.5, 55, 8), 440)
  const start = performance.now()
  let raf = 0, stopped = false
  const tick = () => {
    if (stopped) return
    const life = (performance.now() - start) / 5200
    ctx.clearRect(0, 0, W, H)
    for (const p of parts) {
      p.vy += 0.18; p.x += p.vx; p.y += p.vy; p.vx *= 0.99; p.rot += p.vr
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.globalAlpha = Math.max(0, 1 - life)
      if (p.donut) { ctx.font = `${p.s}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('🍩', 0, 0) }
      else { ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.62) }
      ctx.restore()
    }
    raf = requestAnimationFrame(tick)
  }
  tick()
  return () => { stopped = true; cancelAnimationFrame(raf); clearTimeout(t1); clearTimeout(t2) }
}

export default function Celebration() {
  const [show, setShow] = useState<Payload | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const on = (e: Event) => setShow((e as CustomEvent).detail as Payload)
    window.addEventListener('sf-celebrate', on as EventListener)
    return () => window.removeEventListener('sf-celebrate', on as EventListener)
  }, [])
  useEffect(() => {
    if (!show || !canvasRef.current) return
    const stop = runConfetti(canvasRef.current)
    const t = setTimeout(() => setShow(null), 5200)
    return () => { stop(); clearTimeout(t) }
  }, [show])
  if (!show) return null
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Helvetica Neue', Helvetica, Arial, system-ui, sans-serif" }}>
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
      <div style={{ position: 'relative', maxWidth: 420, margin: 20, background: '#fff', borderRadius: 22, padding: '26px 28px', textAlign: 'center', boxShadow: '0 30px 80px -24px rgba(0,0,0,.4)', border: '1px solid rgba(0,0,0,.06)', animation: 'sfPop .5s cubic-bezier(.2,1.3,.4,1) both' }}>
        <div style={{ fontSize: 46, lineHeight: 1, marginBottom: 10, animation: 'sfBob 1.4s ease-in-out infinite' }}>{show.emoji || '🍩'}</div>
        <div style={{ fontSize: 21, fontWeight: 800, color: '#141d15', letterSpacing: '-.01em', marginBottom: show.sub ? 8 : 0 }}>{show.title}</div>
        {show.sub && <div style={{ fontSize: 14.5, lineHeight: 1.5, color: '#5f6b60' }}>{show.sub}</div>}
      </div>
      <style>{`@keyframes sfPop{0%{opacity:0;transform:scale(.8) translateY(10px)}100%{opacity:1;transform:none}}@keyframes sfBob{0%,100%{transform:translateY(0) rotate(-4deg)}50%{transform:translateY(-6px) rotate(4deg)}}`}</style>
    </div>
  )
}
