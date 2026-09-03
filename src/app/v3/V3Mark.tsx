/**
 * The Selfmade brand lockup for marketing surfaces.
 *
 * V3Mark — the symbol: THREE separate dumbbell shapes (a bar with a round node at each end) arranged
 * at 120°, with three gaps between them (it is NOT a closed ring — matches the supplied logo). Renders
 * in `currentColor`. Static (no animation) — the spin softened the edges when the mark rotated.
 * V3Wordmark — the "Selfmade" wordmark in the brand's own font, from /logo.png via a CSS mask so it can
 * be recolored. V3Logo — mark + wordmark together, so every page shows the exact same logo.
 * Self-contained + reduced-motion-safe. Pure/presentational — safe in server or client components.
 */
const R = 30, C = 50
const P = (d: number) => [C + R * Math.cos((d * Math.PI) / 180), C + R * Math.sin((d * Math.PI) / 180)] as [number, number]
// Three dumbbells (each a 60° arc between two neighbouring nodes), 120° apart. The three edges BETWEEN
// them (top, lower-left, lower-right) are left open → three gaps, three separate shapes.
const ARCS: [number, number][] = [[60, 120], [180, 240], [300, 360]]
const NODES = [0, 60, 120, 180, 240, 300].map(P)

export function V3Mark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className="v3mark" aria-hidden="true" style={{ display: 'block', color: 'inherit', overflow: 'visible' }}>
      {/* Static (no animation) — the spin softened the edges when rotated. */}
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

/** The "Selfmade" wordmark in the brand font (/logo.png), recolorable via CSS mask. */
export function V3Wordmark({ height = 19, color = '#0d0d0d' }: { height?: number; color?: string }) {
  return (
    <span
      aria-label="Selfmade"
      role="img"
      style={{
        display: 'inline-block', height, width: height * 3.4, background: color,
        WebkitMaskImage: 'url(/logo.png)', maskImage: 'url(/logo.png)',
        WebkitMaskSize: 'contain', maskSize: 'contain',
        WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat',
        WebkitMaskPosition: 'left center', maskPosition: 'left center',
      }}
    />
  )
}

/** Full logo lockup — the mark + the wordmark. One component so the logo is identical on every page. */
export function V3Logo({ markSize = 34, wordHeight = 27, markColor = '#ff5a2c', wordColor = '#0d0d0d' }: {
  markSize?: number; wordHeight?: number; markColor?: string; wordColor?: string
}) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      <span style={{ color: markColor, display: 'inline-flex' }}><V3Mark size={markSize} /></span>
      <V3Wordmark height={wordHeight} color={wordColor} />
    </span>
  )
}
