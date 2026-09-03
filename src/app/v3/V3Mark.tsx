/**
 * V3Mark — the Selfmade brand mark: a flat-top hexagonal ring of six connected nodes (a "company of
 * agents"), recreated from the supplied logo. Renders in `currentColor` (set it orange via CSS), and
 * animates Firecrawl-style: the ring rotates slowly and each node pulses in sequence, like a signal
 * travelling the loop. Self-contained (bundles its own keyframes) so it works on any page; honours
 * prefers-reduced-motion. Pure/presentational — safe in server or client components.
 */
const R = 30, C = 50
const NODES = [0, 60, 120, 180, 240, 300].map((d) => {
  const r = (d * Math.PI) / 180
  return [C + R * Math.cos(r), C + R * Math.sin(r)] as [number, number]
})
const EDGES = NODES.map((p, i) => [p, NODES[(i + 1) % NODES.length]] as const)

export function V3Mark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className="v3mark" aria-hidden="true" style={{ display: 'block', color: 'inherit' }}>
      <style>{`
        .v3mark .v3mark-g{transform-origin:50px 50px;animation:v3mark-spin 22s linear infinite}
        .v3mark circle{animation:v3mark-pulse 2.4s ease-in-out infinite}
        @keyframes v3mark-spin{to{transform:rotate(360deg)}}
        @keyframes v3mark-pulse{0%,100%{opacity:.5}50%{opacity:1}}
        @media(prefers-reduced-motion:reduce){.v3mark .v3mark-g,.v3mark circle{animation:none}}
      `}</style>
      <g className="v3mark-g">
        <g fill="none" stroke="currentColor" strokeWidth={10} strokeLinecap="round">
          {EDGES.map(([a, b], i) => <line key={i} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />)}
        </g>
        <g fill="currentColor">
          {NODES.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={9} style={{ animationDelay: `${i * 0.4}s` }} />)}
        </g>
      </g>
    </svg>
  )
}
