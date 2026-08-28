/**
 * Shown on any per-brand ACTION surface (SEO / GEO / CRO / Pages / Content) when the switcher is on
 * "All brands" and the user has more than one brand. These features run against ONE brand's site, so we
 * ask the user to pick a brand rather than silently auditing/generating for a default one.
 */
const INK = '#141d15', SUB = '#7a9a7a', LINE = 'rgba(0,0,0,0.08)', PAPER = '#faf9f5', ORANGE = '#ff5a2c'

export default function SelectBrandNotice({ feature = 'This' }: { feature?: string }) {
  return (
    <div style={{ maxWidth: 560, margin: '10px auto 0', border: `1px solid ${LINE}`, borderRadius: 16, background: PAPER, padding: '40px 30px', textAlign: 'center', fontFamily: 'Inter, system-ui, sans-serif', color: INK }}>
      <div style={{ width: 50, height: 50, borderRadius: 13, background: '#fdeee9', color: ORANGE, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7h18M3 12h18M3 17h18" /></svg>
      </div>
      <div style={{ fontSize: 20, fontWeight: 800 }}>Select a brand</div>
      <div style={{ color: SUB, fontSize: 14.5, margin: '8px auto 0', maxWidth: 430, lineHeight: 1.55 }}>
        You&rsquo;re viewing <b>All brands</b>. {feature} runs against one brand&rsquo;s store, so pick a brand from the switcher at the <b>top-left</b> and it loads that brand&rsquo;s data automatically.
      </div>
    </div>
  )
}
