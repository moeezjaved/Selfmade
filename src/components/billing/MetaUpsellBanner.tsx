// Leak-led Meta upsell — shown only on /billing?feature=meta (a Free user redirected from
// /connect/meta). Presentational + prop-less; the <PricingSection> below carries the CTA, so
// this banner intentionally has NO button of its own. Matches the billing page's inline-style
// palette (#152928 dark green / #ff5a2c orange / system-ui).
export default function MetaUpsellBanner() {
  const items = [
    { icon: '🩸', label: 'See real wasted spend' },
    { icon: '⚡', label: 'One-click pause & scale' },
    { icon: '👁️', label: 'Mello watches it daily' },
  ]
  return (
    <div
      style={{
        background: '#152928',
        border: '1px solid rgba(255,90,44,0.22)',
        borderRadius: 20,
        padding: '28px 30px',
        marginBottom: 40,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div style={{ position: 'absolute', top: 0, left: '20%', right: '20%', height: '1.5px', background: 'linear-gradient(90deg,transparent,#ff5a2c,transparent)' }} />
      <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,90,44,0.6)', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 10 }}>
        Your audit, completed
      </div>
      <div style={{ fontSize: 26, fontWeight: 900, color: '#fff', lineHeight: 1.15, marginBottom: 12, maxWidth: 640 }}>
        Connect Meta to see exactly where your money is leaking
      </div>
      <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.62)', lineHeight: 1.6, maxWidth: 640, marginBottom: 22 }}>
        Your free scan estimated the opportunity from the outside. Creator connects your real account — Mello finds the ads bleeding budget, the winners to scale, and fixes each one with your approval.
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        {items.map((it) => (
          <div
            key={it.label}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: 'rgba(255,90,44,0.08)',
              border: '1px solid rgba(255,90,44,0.2)',
              borderRadius: 100,
              padding: '8px 16px',
            }}
          >
            <span style={{ fontSize: 15 }} aria-hidden>{it.icon}</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>{it.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
