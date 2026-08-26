/**
 * The Selfmade MARK — the original "S" badge: an orange rounded square with a white serif S.
 * (Reverted from the 7×7 grid mark.) Same exports/props as before so every call site is unchanged.
 *   <Mark />        the static badge (app / favicon parity)
 *   <MarkDecode />  the intro variant — a quick fade+scale settle (no grid decode)
 */
'use client'

const SERIF_STACK = "'Instrument Serif','Iowan Old Style',Georgia,'Times New Roman',serif"

function SBadge({ size, color, radius, className, title, animate = false, durationMs = 900, loop = false }: {
  size: number; color: string; radius: number; className?: string; title: string; animate?: boolean; durationMs?: number; loop?: boolean
}) {
  // radius is given in the caller's px scale (e.g. 9 on a 34px badge). Map it onto the 700px viewBox so
  // the corner rounding matches the old inline badge (~0.26 ratio). If unset, use that ratio of size.
  const rx = ((radius > 0 ? radius : Math.round(size * 0.26)) / size) * 700
  const style = animate
    ? { transformBox: 'fill-box' as const, transformOrigin: 'center', animation: `sfmk ${(durationMs / 1000).toFixed(2)}s cubic-bezier(.2,.7,.2,1) ${loop ? 'infinite' : 'both'}` }
    : undefined
  return (
    <svg width={size} height={size} viewBox="0 0 700 700" className={className} role="img" aria-label={title} style={style}>
      {animate && <style>{`@keyframes sfmk{0%{opacity:0;transform:scale(.9)}60%{opacity:1;transform:scale(1.03)}100%{opacity:1;transform:scale(1)}}@media (prefers-reduced-motion:reduce){svg[aria-label="${title}"]{animation:none!important}}`}</style>}
      <rect width="700" height="700" rx={rx} fill={color} />
      <text x="350" y="392" textAnchor="middle" fontFamily={SERIF_STACK} fontWeight="700" fontSize="500" fill="#ffffff">S</text>
    </svg>
  )
}

export function Mark({ size = 40, color = '#ef4a1e', radius = 0, className, title = 'Selfmade' }: {
  size?: number; color?: string; hole?: string; radius?: number; className?: string; title?: string
}) {
  return <SBadge size={size} color={color} radius={radius} className={className} title={title} />
}

export function MarkDecode({ size = 48, color = '#ef4a1e', radius = 0, loop = false, durationMs = 900, className }: {
  size?: number; color?: string; hole?: string; radius?: number; loop?: boolean; durationMs?: number; className?: string
}) {
  return <SBadge size={size} color={color} radius={radius} className={className} title="Selfmade" animate durationMs={durationMs} loop={loop} />
}

export default Mark
