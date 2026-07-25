/**
 * MELLO — the one face. A dark squircle with lit eyes: a small figure working in the dark while
 * you sleep, which is literally what the product does.
 *
 * Deliberately NOT a lime robot head with antennae (antennae are the cheapest "I'm a bot" tell, and
 * a bright head competes with the lime we reserve for actions), and NOT a Sparkles icon — Mello is
 * an employee, not a feature, so Mello gets a portrait where features get line icons.
 *
 * Every expression is carried by the eyes alone (a three-word vocabulary), so state reads at 20px
 * without reading any text. Pure SVG, no hooks — safe in server and client components alike.
 */
const FOREST = '#17251c', LIME = '#dffe95'

export type MelloState = 'delivered' | 'awake' | 'resting'

// One fixed gradient id on purpose: every Mello's skin is identical, so sharing the id is harmless
// and — unlike a counter or useId — renders the same on the server and the client (no hydration mismatch).
const gid = 'melloSkin'

export default function MelloFace({
  size = 36, state = 'awake', title,
}: { size?: number; state?: MelloState; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 160 160" style={{ flexShrink: 0, display: 'block' }}
      role={title ? 'img' : undefined} aria-hidden={title ? undefined : 'true'} aria-label={title}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#23372a" /><stop offset="1" stopColor={FOREST} />
        </linearGradient>
      </defs>
      {/* hairline so the silhouette still reads on a dark surface (studio, keynote) */}
      <rect x="14" y="14" width="132" height="132" rx="46" fill={`url(#${gid})`} stroke="rgba(255,255,255,.10)" strokeWidth="2" />
      {state === 'delivered' ? (
        /* work is waiting for you — the eyes smile */
        <g stroke={LIME} strokeWidth="9" strokeLinecap="round" fill="none">
          <path d="M47 88q12-17 24 0" /><path d="M89 88q12-17 24 0" />
        </g>
      ) : state === 'resting' ? (
        /* a genuinely quiet day — Mello says so instead of pretending */
        <g stroke="#6f8073" strokeWidth="8.5" strokeLinecap="round">
          <path d="M47 85h24" /><path d="M89 85h24" />
        </g>
      ) : (
        /* awake, watching */
        <g fill={LIME}><circle cx="59" cy="83" r="11.5" /><circle cx="101" cy="83" r="11.5" /></g>
      )}
    </svg>
  )
}
