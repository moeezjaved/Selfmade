/**
 * The Selfmade MARK (symbol only — the wordmark is separate). A 7×7 grid, orange with 12 white square
 * holes in a symmetric woven pattern. Pure vector → perfectly smooth edges at any size, recolorable.
 *   <Mark />                      the static mark (app badge / favicon parity)
 *   <MarkDecode />                the Lapis-style "decode" animation (cells resolve into place)
 */
'use client'
import { useId } from 'react'

// The 12 white cells on a 7×7 grid (col, row) — symmetric on both axes.
const CELLS: [number, number][] = [
  [3, 0],
  [1, 1], [5, 1],
  [2, 2], [4, 2],
  [0, 3], [6, 3],
  [2, 4], [4, 4],
  [1, 5], [5, 5],
  [3, 6],
]
const U = 100 // cell size in the 700×700 viewBox

export function Mark({ size = 40, color = '#ef4a1e', hole = '#ffffff', radius = 0, className, title = 'Selfmade' }: {
  size?: number; color?: string; hole?: string; radius?: number; className?: string; title?: string
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 700 700" className={className} role="img" aria-label={title}>
      {radius > 0
        ? <rect width="700" height="700" rx={radius} fill={color} />
        : <rect width="700" height="700" fill={color} />}
      <g fill={hole} shapeRendering="crispEdges">
        {CELLS.map(([c, r]) => <rect key={`${c}-${r}`} x={c * U} y={r * U} width={U} height={U} />)}
      </g>
    </svg>
  )
}

/**
 * Decode animation — the mark resolves out of a scramble (Lapis "matrix" feel). Each white cell flickers
 * through a few random grid positions, then snaps to its true place with a staggered diagonal sweep.
 * Runs once by default; `loop` keeps it cycling (e.g. a splash / loader).
 */
export function MarkDecode({ size = 48, color = '#ef4a1e', hole = '#ffffff', radius = 0, loop = false, durationMs = 1400, className }: {
  size?: number; color?: string; hole?: string; radius?: number; loop?: boolean; durationMs?: number; className?: string
}) {
  const uid = useId().replace(/[:]/g, '')
  const total = durationMs / 1000
  return (
    <svg width={size} height={size} viewBox="0 0 700 700" className={className} role="img" aria-label="Selfmade">
      <style>{`
        @media (prefers-reduced-motion: reduce) {
          .mk-${uid} rect.cell { animation: none !important; opacity: 1 !important; transform: none !important; }
        }
        .mk-${uid} rect.cell {
          opacity: 0;
          transform-box: fill-box;
          transform-origin: center;
          animation: mkdec-${uid} ${total}s cubic-bezier(.2,.7,.2,1) ${loop ? 'infinite' : 'both'};
        }
        @keyframes mkdec-${uid} {
          0%   { opacity: 0; transform: scale(.2) translateY(-40px); }
          35%  { opacity: .55; transform: scale(1.18) translateY(6px); }
          55%  { opacity: 1; transform: scale(.94); }
          70%  { transform: scale(1.05); }
          100% { opacity: 1; transform: scale(1); }
        }
      `}</style>
      {radius > 0 ? <rect width="700" height="700" rx={radius} fill={color} /> : <rect width="700" height="700" fill={color} />}
      <g className={`mk-${uid}`} fill={hole} shapeRendering="crispEdges">
        {CELLS.map(([c, r], i) => (
          <rect
            key={`${c}-${r}`} className="cell"
            x={c * U} y={r * U} width={U} height={U}
            // staggered by a diagonal sweep (top-left → bottom-right) for the "decode" cascade
            style={{ animationDelay: `${((c + r) / 12) * (total * 0.55)}s` }}
          />
        ))}
      </g>
    </svg>
  )
}

export default Mark
