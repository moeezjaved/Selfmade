'use client'
/**
 * Radar-sweep loader (handoff moment #3). On-brand "spying" loader for search / Brand Spy crawls.
 * Transparent background → embeddable anywhere. Honors prefers-reduced-motion (static radar + text).
 */
const BLIPS = [
  { left: 102, top: 32, delay: '-1.778s' },
  { left: 110, top: 73, delay: '-1.472s' },
  { left: 92, top: 117, delay: '-1.139s' },
  { left: 39, top: 101, delay: '-0.75s' },
  { left: 28, top: 46, delay: '-0.333s' },
]

export default function RadarSearch({ caption = 'Scanning 4.3M ads' }: { caption?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, fontFamily: 'Inter, sans-serif', background: 'transparent', padding: 30 }}>
      <style>{`
        @keyframes rd-sweep { to { transform: rotate(360deg); } }
        @keyframes rd-ping { 0%{transform:scale(1.7);opacity:1;} 8%{transform:scale(1);opacity:1;} 30%{opacity:.28;} 100%{transform:scale(1);opacity:.28;} }
        @keyframes rd-ringpulse { 0%{transform:translate(-50%,-50%) scale(.4);opacity:.85;} 26%{transform:translate(-50%,-50%) scale(2.4);opacity:0;} 100%{opacity:0;} }
        @keyframes rd-blink { 0%,80%,100%{opacity:.25;transform:translateY(0);} 40%{opacity:1;transform:translateY(-2px);} }
        @media (prefers-reduced-motion: reduce) { .rd-anim{animation:none !important;} .rd-blip{opacity:.5 !important;} }
      `}</style>

      <div style={{ position: 'relative', width: 140, height: 140 }}>
        {/* radar disc */}
        <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'radial-gradient(circle at 50% 50%, #16301c 0%, #0e1b12 100%)', border: '1.5px solid rgba(223,254,149,.28)', overflow: 'hidden' }}>
          {[75, 50, 25].map(s => (
            <div key={s} style={{ position: 'absolute', left: '50%', top: '50%', width: `${s}%`, height: `${s}%`, transform: 'translate(-50%,-50%)', borderRadius: '50%', border: '1px solid rgba(223,254,149,.15)' }} />
          ))}
          <div className="rd-anim" style={{ position: 'absolute', inset: 0, borderRadius: '50%', transformOrigin: 'center', background: 'conic-gradient(from 0deg, rgba(223,254,149,.5) 0deg, rgba(223,254,149,.12) 34deg, rgba(223,254,149,0) 62deg, transparent 360deg)', animation: 'rd-sweep 2s linear infinite' }} />
          <div style={{ position: 'absolute', left: '50%', top: '50%', width: 5, height: 5, transform: 'translate(-50%,-50%)', borderRadius: '50%', background: '#dffe95' }} />
        </div>
        {/* blips */}
        {BLIPS.map((b, i) => (
          <div key={i} style={{ position: 'absolute', left: b.left, top: b.top, transform: 'translate(-50%,-50%)' }}>
            <div className="rd-anim rd-blip" style={{ width: 10, height: 13, borderRadius: 2, background: '#dffe95', opacity: 0.28, animation: `rd-ping 2s linear ${b.delay} infinite` }} />
            <div className="rd-anim" style={{ position: 'absolute', left: '50%', top: '50%', width: 14, height: 14, borderRadius: '50%', border: '1.5px solid #dffe95', transform: 'translate(-50%,-50%)', opacity: 0, animation: `rd-ringpulse 2s linear ${b.delay} infinite` }} />
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: '#8a9182' }}>{caption}</span>
        <span style={{ display: 'inline-flex', gap: 3, marginBottom: 1 }}>
          {[0, 0.18, 0.36].map(d => (
            <span key={d} className="rd-anim" style={{ width: 4, height: 4, borderRadius: '50%', background: '#8fbf3d', display: 'inline-block', animation: `rd-blink 1.3s ease-in-out ${d}s infinite` }} />
          ))}
        </span>
      </div>
    </div>
  )
}
