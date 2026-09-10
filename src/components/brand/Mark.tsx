/**
 * The Selfmade MARK — the molecule/network symbol: three orange "bond" dumbbells on alternating edges
 * of a flat-top hexagon (3-fold symmetry) around a hollow centre. Rendered as metaballs (goo filter) so
 * the necks flare smoothly into the nodes. Same exports/props as before so every call site is unchanged.
 *   <Mark />        the static badge (app / favicon parity)
 *   <MarkDecode />  the intro variant — a quick fade+scale settle
 */
'use client'

import { useId } from 'react'

function Molecule({ size, color, className, title, animate = false, durationMs = 900, loop = false }: {
  size: number; color: string; className?: string; title: string; animate?: boolean; durationMs?: number; loop?: boolean
}) {
  const fid = useId().replace(/[:]/g, '')   // unique filter id so multiple marks on a page don't collide
  const style = animate
    ? { transformBox: 'fill-box' as const, transformOrigin: 'center', animation: `sfmk ${(durationMs / 1000).toFixed(2)}s cubic-bezier(.2,.7,.2,1) ${loop ? 'infinite' : 'both'}` }
    : undefined
  return (
    <svg width={size} height={size} viewBox="0 0 700 700" className={className} role="img" aria-label={title} style={style}>
      {animate && <style>{`@keyframes sfmk{0%{opacity:0;transform:scale(.9)}60%{opacity:1;transform:scale(1.03)}100%{opacity:1;transform:scale(1)}}@media (prefers-reduced-motion:reduce){svg[aria-label="${title}"]{animation:none!important}}`}</style>}
      <defs>
        <filter id={`goo-${fid}`} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="13" result="b" />
          <feColorMatrix in="b" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 24 -12" />
        </filter>
      </defs>
      {/* three bonds (each its OWN goo group so blur never bridges across them → three clean gaps) */}
      <g filter={`url(#goo-${fid})`} fill={color}>
        <line x1="291" y1="541" x2="409" y2="541" stroke={color} strokeWidth="130" strokeLinecap="round" />
        <circle cx="291" cy="541" r="105" /><circle cx="409" cy="541" r="105" />
      </g>
      <g filter={`url(#goo-${fid})`} fill={color}>
        <line x1="155" y1="305" x2="214" y2="204" stroke={color} strokeWidth="130" strokeLinecap="round" />
        <circle cx="155" cy="305" r="105" /><circle cx="214" cy="204" r="105" />
      </g>
      <g filter={`url(#goo-${fid})`} fill={color}>
        <line x1="486" y1="204" x2="545" y2="305" stroke={color} strokeWidth="130" strokeLinecap="round" />
        <circle cx="486" cy="204" r="105" /><circle cx="545" cy="305" r="105" />
      </g>
    </svg>
  )
}

export function Mark({ size = 40, color = '#ef4a1e', className, title = 'Selfmade' }: {
  size?: number; color?: string; hole?: string; radius?: number; className?: string; title?: string
}) {
  return <Molecule size={size} color={color} className={className} title={title} />
}

export function MarkDecode({ size = 48, color = '#ef4a1e', loop = false, durationMs = 900, className }: {
  size?: number; color?: string; hole?: string; radius?: number; loop?: boolean; durationMs?: number; className?: string
}) {
  return <Molecule size={size} color={color} className={className} title="Selfmade" animate durationMs={durationMs} loop={loop} />
}

export default Mark
