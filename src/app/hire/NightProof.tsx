'use client'
/**
 * NightProof — the "show the receipts" beat, right after the hero mockup. A dark night-coloured band
 * that makes the core thesis concrete: you slept, the company worked, and here's what it did. Numbers
 * count up once on reveal; visible-by-default (opacity:1) so extensions can't blank it; reduced-motion
 * safe. This is proof of work, not a feature list.
 */
import React, { useEffect, useRef, useState } from 'react'

const FOREST = '#12211a', LIME = '#dffe95'

const STATS: [number, string, string][] = [
  [14, '', 'competitors researched'],
  [860, '', 'ads analysed'],
  [12, '', 'opportunities found'],
  [7, '', 'creatives made'],
  [3, '', 'campaigns prepared'],
  [42, '', 'customers answered'],
]

function Stat({ end, suffix, label, on }: { end: number; suffix: string; label: string; on: boolean }) {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!on) return
    let raf = 0, start = 0
    const dur = 900
    const tick = (t: number) => {
      if (!start) start = t
      const p = Math.min(1, (t - start) / dur)
      const eased = 1 - Math.pow(1 - p, 3)
      setN(Math.round(end * eased))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [on, end])
  return (
    <div className="np-stat">
      <div className="np-n">{n.toLocaleString()}{suffix}</div>
      <div className="np-l">{label}</div>
    </div>
  )
}

export default function NightProof() {
  const ref = useRef<HTMLDivElement>(null)
  const [on, setOn] = useState(false)
  useEffect(() => {
    const el = ref.current; if (!el) return
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { setOn(true); io.disconnect() } }), { rootMargin: '0px 0px -12% 0px' })
    io.observe(el)
    // Safety net: if the observer never fires (some browser extensions block it), still count up so the
    // receipts never sit at 0. Idempotent with the observer.
    const t = setTimeout(() => setOn(true), 1600)
    return () => { io.disconnect(); clearTimeout(t) }
  }, [])
  return (
    <section className="np-wrap" ref={ref}>
      <div className="np">
        <div className="np-head">
          <span className="np-moon">🌙</span>
          <span className="np-eye">Last night · while you slept</span>
        </div>
        <div className="np-grid">
          {STATS.map(([end, suffix, label]) => (
            <Stat key={label} end={end} suffix={suffix} label={label} on={on} />
          ))}
        </div>
        <div className="np-foot">…and it was all waiting in your brief this morning.</div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        .np-wrap{max-width:1040px;margin:56px auto 0;padding:0 20px}
        .np{background:${FOREST};border-radius:22px;padding:34px 30px 30px;box-shadow:0 40px 90px -50px rgba(17,37,28,.6);opacity:1}
        .np-head{display:flex;align-items:center;justify-content:center;gap:9px;margin-bottom:26px}
        .np-moon{font-size:15px}
        .np-eye{font:800 11px/1 ui-monospace,Menlo,monospace;letter-spacing:.18em;text-transform:uppercase;color:#8ea08c}
        .np-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:14px}
        .np-stat{text-align:center;padding:6px 4px}
        .np-n{font:800 clamp(30px,4vw,46px)/1 'Instrument Serif',Georgia,serif;color:${LIME};letter-spacing:-.01em;font-variant-numeric:tabular-nums}
        .np-l{margin-top:8px;font-size:12px;line-height:1.35;color:#cdd8cd;font-weight:600}
        .np-foot{text-align:center;margin-top:26px;font-size:14px;color:#a9b6a7;font-weight:550}
        @media (max-width:760px){
          .np-grid{grid-template-columns:repeat(3,1fr);gap:18px 10px}
          .np{padding:28px 20px 24px}
        }
        @media (max-width:380px){ .np-grid{grid-template-columns:repeat(2,1fr)} }
      ` }} />
    </section>
  )
}
