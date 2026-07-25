'use client'
/**
 * WORKING — narrated loading. (Section 3: Polsia scored 9 on loading states by replacing spinners
 * with narration — "Searching the web (2/2)…". We scored 6. This closes that gap and, because the
 * lines say what MELLO is doing, it reinforces the whole thesis: an employee is at work, not a spinner.)
 *
 * Register = machine (mono). Steps through the given lines, marks each done, keeps a live "elapsed"
 * stamp. Reduced-motion: shows all lines at once, no caret blink. Never a spinner.
 */
import { useEffect, useState } from 'react'
import { T, machine } from '@/lib/design/voice'

export default function Working({ lines, tone = 'paper', minStep = 900 }: {
  lines: string[]            // what Mello is doing, in order — the last one stays "in progress"
  tone?: 'paper' | 'forest'  // paper = inline on a surface; forest = the night's-log strip
  minStep?: number           // ms between advancing a step
}) {
  const [step, setStep] = useState(0)
  const [secs, setSecs] = useState(0)
  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  useEffect(() => {
    if (reduce) { setStep(lines.length - 1); return }
    const a = setInterval(() => setStep(s => Math.min(s + 1, lines.length - 1)), minStep)
    return () => clearInterval(a)
  }, [lines.length, minStep, reduce])

  useEffect(() => {
    const b = setInterval(() => setSecs(s => s + 1), 1000)
    return () => clearInterval(b)
  }, [])

  const dark = tone === 'forest'
  const bg = dark ? T.forest : 'transparent'
  const done = dark ? '#8fa48c' : T.faint
  const live = dark ? T.lime : T.green
  const shown = reduce ? lines : lines.slice(0, step + 1)

  return (
    <div style={{ ...machine, background: bg, color: done, borderRadius: dark ? 12 : 0, padding: dark ? '12px 16px' : 0, fontSize: 12.5, lineHeight: 1.9 }}>
      {shown.map((l, i) => {
        const isLast = i === shown.length - 1 && step < lines.length - 1 && !reduce
        return (
          <div key={i} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            <span style={{ color: isLast ? live : done, marginRight: 8 }}>{isLast ? '›' : '✓'}</span>
            <span style={{ color: isLast ? (dark ? '#dfe6da' : T.ink) : done }}>{l}{isLast ? '…' : ''}</span>
            {isLast && <span className="wk-caret" style={{ color: live }}> ▍</span>}
          </div>
        )
      })}
      <div style={{ color: done, opacity: .7, marginTop: 4, fontSize: 11 }}>{secs}s elapsed</div>
      <style>{`@keyframes wkb{50%{opacity:0}} .wk-caret{animation:wkb 1s step-end infinite}
        @media(prefers-reduced-motion:reduce){.wk-caret{animation:none;opacity:0}}`}</style>
    </div>
  )
}
