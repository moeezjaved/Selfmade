/**
 * The Selfmade MARK — the exact brand symbol used on the marketing landing (see src/app/v3/V3Mark).
 * THREE separate dumbbell bonds (a bar with a round node at each end) at 120°, with three gaps between
 * them (NOT a closed ring). Crisp hard edges — no goo/blur — so it stays clear at favicon/sidebar sizes.
 * Same exports/props as before so every call site is unchanged.
 *   <Mark />        the static symbol (app / favicon parity)
 *   <MarkDecode />  the intro variant — a quick fade+scale settle
 */
'use client'

const R = 30, C = 50
const P = (d: number): [number, number] => [C + R * Math.cos((d * Math.PI) / 180), C + R * Math.sin((d * Math.PI) / 180)]
// Three bonds (each a 60° edge between two neighbouring nodes), 120° apart; the edges between are open → 3 gaps.
const ARCS: [number, number][] = [[60, 120], [180, 240], [300, 360]]
const NODES = [0, 60, 120, 180, 240, 300].map(P)

function Symbol({ size, color, className, title, animate = false, durationMs = 900, loop = false }: {
  size: number; color: string; className?: string; title: string; animate?: boolean; durationMs?: number; loop?: boolean
}) {
  const style = animate
    ? { color, transformBox: 'fill-box' as const, transformOrigin: 'center', animation: `sfmk ${(durationMs / 1000).toFixed(2)}s cubic-bezier(.2,.7,.2,1) ${loop ? 'infinite' : 'both'}` }
    : { color }
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={className} role="img" aria-label={title} style={{ display: 'block', overflow: 'visible', ...style }}>
      {animate && <style>{`@keyframes sfmk{0%{opacity:0;transform:scale(.9)}60%{opacity:1;transform:scale(1.03)}100%{opacity:1;transform:scale(1)}}@media (prefers-reduced-motion:reduce){svg[aria-label="${title}"]{animation:none!important}}`}</style>}
      <g fill="none" stroke="currentColor" strokeWidth={12} strokeLinecap="round">
        {ARCS.map(([a, b], i) => {
          const [x1, y1] = P(a), [x2, y2] = P(b)
          return <line key={i} x1={x1.toFixed(2)} y1={y1.toFixed(2)} x2={x2.toFixed(2)} y2={y2.toFixed(2)} />
        })}
      </g>
      <g fill="currentColor">
        {NODES.map((p, i) => <circle key={i} cx={p[0].toFixed(2)} cy={p[1].toFixed(2)} r={12} />)}
      </g>
    </svg>
  )
}

export function Mark({ size = 34, color = '#ff5a2c', className, title = 'Selfmade' }: {
  size?: number; color?: string; hole?: string; radius?: number; className?: string; title?: string
}) {
  return <Symbol size={size} color={color} className={className} title={title} />
}

export function MarkDecode({ size = 48, color = '#ff5a2c', loop = false, durationMs = 900, className }: {
  size?: number; color?: string; hole?: string; radius?: number; loop?: boolean; durationMs?: number; className?: string
}) {
  return <Symbol size={size} color={color} className={className} title="Selfmade" animate durationMs={durationMs} loop={loop} />
}

export default Mark
