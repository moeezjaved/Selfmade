'use client'
/**
 * /story-team — a NO-AUTH preview of the onboarding "meet your marketing company" welcome, so the
 * team roster can be seen (and screenshotted) without a Supabase session. The real thing lives in
 * the onboarding welcome beat (src/app/(auth)/onboarding/page.tsx); this is a static mirror of just
 * that screen. Noindex; delete once the onboarding change is signed off.
 */
import MelloFace from '@/components/MelloFace'

const INK = '#161c17', MUTED = '#68756b', LINE = '#e7ece7', FOREST = '#17251c', LIME = '#dffe95', GREEN = '#3f8f4f'
const TEAM: [string, string][] = [
  ['Research', 'Reads the market while you sleep'],
  ['Creative', 'Turns research into campaigns'],
  ['Media Buying', 'Finds winners. Scales them'],
  ['Growth', 'Email, SEO, funnels'],
  ['Finance', 'Tracks profit, not ROAS'],
  ['Customer', 'Answers every message'],
]

export default function StoryTeamPreview() {
  const say: React.CSSProperties = { fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 31, fontWeight: 400, letterSpacing: '-.015em', lineHeight: 1.14, color: INK, textAlign: 'center', maxWidth: 540, margin: '0 auto' }
  const sub: React.CSSProperties = { fontSize: 14, color: MUTED, textAlign: 'center', maxWidth: 440, margin: '10px auto 0', lineHeight: 1.6 }
  const btnMain: React.CSSProperties = { background: FOREST, color: LIME, border: 'none', borderRadius: 100, padding: '13px 26px', fontSize: 14.5, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }
  return (
    <div style={{ minHeight: '100vh', background: '#faf9f4', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 24px', fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div style={{ textAlign: 'center', width: '100%', maxWidth: 560 }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 22 }}><MelloFace size={54} state="awake" /></div>
        <div style={say}>Hi. I&rsquo;m Mello.<br />I&rsquo;ll manage your marketing company.</div>
        <p style={sub}>This is your team — Research, Creative, Media Buying, Growth, Finance and Customer. They report to me, and I report to you. First, let me learn the business — about four minutes.</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, maxWidth: 470, margin: '24px auto 0', textAlign: 'left' }}>
          {TEAM.map(([n, d], i) => (
            <div key={n} className="team-in" style={{ animationDelay: `${i * 0.08}s`, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: '11px 13px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 800, color: INK }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: GREEN, display: 'inline-block' }} />{n}
              </div>
              <div style={{ fontSize: 11.5, color: MUTED, marginTop: 4, lineHeight: 1.45 }}>{d}</div>
            </div>
          ))}
        </div>
        <button style={{ ...btnMain, marginTop: 26 }}>Meet them properly — begin →</button>
      </div>
      <style>{`@keyframes team-in{from{opacity:0;transform:translateY(9px)}to{opacity:1;transform:none}} .team-in{animation:team-in .5s cubic-bezier(0,0,.2,1) both}`}</style>
    </div>
  )
}
