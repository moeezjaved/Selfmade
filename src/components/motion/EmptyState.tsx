'use client'
/**
 * Ambient empty-state illustration (handoff moment #5) — a lime magnifying glass sweeping faint
 * ghost ad-cards that "materialize" as it passes. Calm/ambient, not a loader. For empty Boards /
 * Following / Brand Spy. Honors prefers-reduced-motion (static scene).
 */
export default function EmptyState({
  heading = 'No saved ads yet',
  sub = 'Save any ad from Discovery or the Chrome extension.',
}: { heading?: string; sub?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 22, fontFamily: 'Inter, sans-serif', background: 'transparent', padding: 30 }}>
      <style>{`
        @keyframes es-glass { 0%{transform:translate(22px,30px) rotate(-4deg);} 25%{transform:translate(108px,46px) rotate(2deg);} 50%{transform:translate(192px,30px) rotate(-4deg);} 75%{transform:translate(108px,46px) rotate(2deg);} 100%{transform:translate(22px,30px) rotate(-4deg);} }
        @keyframes es-sheen { 0%{transform:translateX(-140%);} 55%{transform:translateX(140%);} 100%{transform:translateX(140%);} }
        @keyframes es-spark { 0%,84%,100%{opacity:0;transform:scale(0) rotate(45deg);} 92%{opacity:1;transform:scale(1) rotate(45deg);} }
        @keyframes es-hl1 { 0%{background:rgba(120,140,110,.14);border-color:#8fbf3d;} 14%,100%{background:rgba(120,140,110,.05);border-color:rgba(143,191,61,.35);} }
        @keyframes es-hl2 { 0%,17%{background:rgba(120,140,110,.05);border-color:rgba(143,191,61,.35);} 25%{background:rgba(120,140,110,.14);border-color:#8fbf3d;} 33%,67%{background:rgba(120,140,110,.05);border-color:rgba(143,191,61,.35);} 75%{background:rgba(120,140,110,.14);border-color:#8fbf3d;} 83%,100%{background:rgba(120,140,110,.05);border-color:rgba(143,191,61,.35);} }
        @keyframes es-hl3 { 0%,42%{background:rgba(120,140,110,.05);border-color:rgba(143,191,61,.35);} 50%{background:rgba(120,140,110,.14);border-color:#8fbf3d;} 58%,100%{background:rgba(120,140,110,.05);border-color:rgba(143,191,61,.35);} }
        @media (prefers-reduced-motion: reduce) { .es-anim{animation:none !important;} }
      `}</style>

      <div style={{ position: 'relative', width: 280, height: 130 }}>
        {/* ghost cards */}
        <div className="es-anim" style={{ position: 'absolute', left: 30, top: 26, width: 60, height: 80, borderRadius: 10, border: '1.5px dashed rgba(143,191,61,.35)', transform: 'rotate(-6deg)', animation: 'es-hl1 6s ease-in-out infinite' }} />
        <div className="es-anim" style={{ position: 'absolute', left: 110, top: 24, width: 60, height: 80, borderRadius: 10, border: '1.5px dashed rgba(143,191,61,.35)', animation: 'es-hl2 6s ease-in-out infinite' }} />
        <div className="es-anim" style={{ position: 'absolute', left: 190, top: 26, width: 60, height: 80, borderRadius: 10, border: '1.5px dashed rgba(143,191,61,.35)', transform: 'rotate(5deg)', animation: 'es-hl3 6s ease-in-out infinite' }} />

        {/* magnifying glass */}
        <div className="es-anim" style={{ position: 'absolute', left: 0, top: 0, width: 54, height: 54, animation: 'es-glass 6s ease-in-out infinite' }}>
          <div style={{ position: 'absolute', left: 38, top: 38, width: 26, height: 9, borderRadius: 5, background: '#141d15', transform: 'rotate(45deg)', transformOrigin: 'left center' }} />
          <div style={{ position: 'absolute', left: 0, top: 0, width: 44, height: 44, borderRadius: '50%', border: '4px solid #8fbf3d', background: 'rgba(143,191,61,.12)', overflow: 'hidden', boxShadow: '0 4px 12px -4px rgba(0,0,0,.3)' }}>
            <div className="es-anim" style={{ position: 'absolute', top: 0, left: 0, width: '60%', height: '100%', background: 'linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,.5), rgba(255,255,255,0))', animation: 'es-sheen 6s ease-in-out infinite' }} />
          </div>
          <div className="es-anim" style={{ position: 'absolute', left: 20, top: 20, width: 8, height: 8, background: '#8fbf3d', borderRadius: 1, transform: 'rotate(45deg)', animation: 'es-spark 1.5s ease-in-out infinite' }} />
        </div>
      </div>

      <div style={{ textAlign: 'center', maxWidth: 300 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#111827' }}>{heading}</div>
        <div style={{ fontSize: 13, fontWeight: 400, color: '#6b7280', marginTop: 5, lineHeight: 1.45 }}>{sub}</div>
      </div>
    </div>
  )
}
