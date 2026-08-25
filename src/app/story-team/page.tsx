'use client'
/**
 * /story-team — a NO-AUTH clickable walkthrough of the onboarding NARRATIVE, so the full emotional
 * flow can be seen without a Supabase session or signup. Static mirror of the real beats in
 * src/app/(auth)/onboarding/page.tsx (welcome → tools → agreement → night). Noindex; throwaway —
 * delete once the onboarding change is signed off. The REAL onboarding button advances the same way.
 */
import { useState } from 'react'
import MelloFace from '@/components/MelloFace'
import { ChannelLogo } from '@/components/brand/logos'

const INK = '#161c17', MUTED = '#6f6d5a', LINE = '#efece2', FOREST = '#141d15', LIME = '#ff5a2c', GREEN = '#ef4a1e'
const PAPER = '#fffdf4', PAPERLINE = '#efe9c8'
const TEAM: [string, string][] = [
  ['Research', 'Reads the market while you sleep'],
  ['Creative', 'Turns research into campaigns'],
  ['Media Buying', 'Finds winners. Scales them'],
  ['Growth', 'Email, SEO, funnels'],
  ['Finance', 'Tracks profit, not ROAS'],
  ['Customer', 'Answers every message'],
]

const say: React.CSSProperties = { fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 31, fontWeight: 400, letterSpacing: '-.015em', lineHeight: 1.14, color: INK, textAlign: 'center', maxWidth: 540, margin: '0 auto' }
const sub: React.CSSProperties = { fontSize: 14, color: MUTED, textAlign: 'center', maxWidth: 440, margin: '10px auto 0', lineHeight: 1.6 }
const btnMain: React.CSSProperties = { background: '#ef4a1e', color: '#fff', border: 'none', borderRadius: 100, padding: '13px 26px', fontSize: 14.5, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }

export default function StoryTeamPreview() {
  const [step, setStep] = useState(0)
  const [name, setName] = useState('')
  const dark = step === 3
  return (
    <div key={step} style={{ minHeight: '100vh', background: dark ? '#0c120d' : '#faf9f4', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 24px', fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div style={{ textAlign: 'center', width: '100%', maxWidth: 560 }}>

        {/* ── 0 · MEET THE TEAM ── */}
        {step === 0 && (
          <>
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
            <button style={{ ...btnMain, marginTop: 26 }} onClick={() => setStep(1)}>Meet them properly — begin →</button>
          </>
        )}

        {/* ── 1 · GIVE YOUR TEAM THEIR TOOLS ── */}
        {step === 1 && (
          <>
            <div style={say}>Give your team their tools.</div>
            <p style={sub}>Your company works through the apps you already use — no dashboard to check. First, where should the team reach you?</p>
            <div style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap', margin: '22px 0 6px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, background: '#fff', border: `1.5px solid ${LINE}`, borderRadius: 14, padding: '13px 18px', color: INK, fontSize: 14, fontWeight: 800 }}><ChannelLogo provider="slack" size={22} /> Add to Slack</span>
                <span style={{ fontSize: 11.5, fontWeight: 750, color: MUTED }}>For teams</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, background: '#fff', border: `1.5px solid ${LINE}`, borderRadius: 14, padding: '13px 18px', color: INK, fontSize: 14, fontWeight: 800 }}><ChannelLogo provider="whatsapp" size={22} /> Connect WhatsApp</span>
                <span style={{ fontSize: 11.5, fontWeight: 750, color: MUTED }}>For solo founders</span>
              </div>
            </div>
            <div style={{ height: 1, background: LINE, margin: '22px 0 18px' }} />
            <div style={{ ...say, fontSize: 22 }}>Give Media Buying your ad account.</div>
            <div style={{ display: 'block', textAlign: 'left', background: '#fff', border: `1.5px solid ${GREEN}`, borderRadius: 14, padding: '15px 18px', maxWidth: 430, margin: '16px auto 18px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <b style={{ fontSize: 14.5, color: INK }}>Connect Meta Ads →</b>
                <span style={{ fontSize: 9, fontWeight: 900, letterSpacing: '.08em', background: '#ef4a1e', color: '#fff', borderRadius: 6, padding: '3px 8px' }}>AVAILABLE</span>
              </div>
              <div style={{ fontSize: 12, color: MUTED, marginTop: 4 }}>So Media Buying sees what already worked.</div>
            </div>
            <div style={{ ...say, fontSize: 22 }}>And soon — more for the team.</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9, margin: '18px 0 4px', textAlign: 'left' }}>
              {[['Shopify', 'so the team knows what actually sells'], ['TikTok', 'so Creative learns your short-video wins'], ['Google', 'so Research sees what people search']].map(([n, d]) => (
                <div key={n} style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 13, padding: '13px 15px', opacity: .75 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <b style={{ fontSize: 13.5, color: INK }}>{n}</b>
                    <span style={{ fontSize: 9, fontWeight: 900, letterSpacing: '.08em', background: '#f1f4f0', color: MUTED, borderRadius: 6, padding: '3px 7px' }}>SOON</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: MUTED, marginTop: 4, lineHeight: 1.5 }}>{d}</div>
                </div>
              ))}
            </div>
            <button style={{ ...btnMain, marginTop: 20 }} onClick={() => setStep(2)}>I&rsquo;ll start from the market →</button>
          </>
        )}

        {/* ── 2 · THE AGREEMENT ── */}
        {step === 2 && (
          <div style={{ background: PAPER, border: `1px solid ${PAPERLINE}`, borderRadius: 18, padding: '30px 30px 26px', boxShadow: '0 30px 70px -30px rgba(20,29,21,.25)', position: 'relative', overflow: 'hidden', textAlign: 'left' }}>
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 5, background: LIME }} />
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.2em', color: '#8a927f', marginBottom: 18 }}>MARKETING EMPLOYEE AGREEMENT</div>
            {[['Employee', 'Mello & your marketing team'], ['Employer', 'Your company'], ['Department', 'Marketing — the whole company'], ['Working hours', '24 / 7'], ['Start date', 'Today'], ['Mission', 'Help grow this business']].map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid #ecebe0', fontSize: 13.5 }}>
                <span style={{ color: '#8a927f' }}>{k}</span><b style={{ fontWeight: 750, color: INK }}>{v}</b>
              </div>
            ))}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 22, alignItems: 'end', marginTop: 20 }}>
              <div>
                <div style={{ borderBottom: `1.5px solid ${INK}`, height: 38, display: 'flex', alignItems: 'flex-end', paddingBottom: 3, fontFamily: "'Snell Roundhand','Segoe Script',cursive", fontSize: 23, color: '#1f2a1c' }}>Mello</div>
                <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '.12em', color: '#8a927f', marginTop: 6 }}>MELLO · YOUR MARKETING MANAGER</div>
              </div>
              <div>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="Type your name to sign" style={{ width: '100%', border: 'none', borderBottom: `1.5px solid ${INK}`, background: 'transparent', outline: 'none', height: 38, fontFamily: "'Snell Roundhand','Segoe Script',cursive", fontSize: 23, color: '#1f2a1c' }} />
                <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '.12em', color: '#8a927f', marginTop: 6 }}>YOU · THE FOUNDER</div>
              </div>
            </div>
            <button style={{ ...btnMain, width: '100%', marginTop: 22, opacity: name.trim().length < 2 ? .45 : 1 }} disabled={name.trim().length < 2} onClick={() => setStep(3)}>Countersign &amp; hire the team</button>
          </div>
        )}

        {/* ── 3 · THE NIGHT ── */}
        {step === 3 && (
          <>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}><MelloFace size={54} state="awake" /></div>
            <div style={{ ...say, color: '#fff' }}>The team is starting work now.</div>
            <div style={{ maxWidth: 380, margin: '22px auto 0', textAlign: 'left', font: "600 13px/2.3 'Helvetica Neue', Helvetica, Arial, sans-serif", color: '#7d8a7c' }}>
              {['Research is reading your market', 'Creative is drafting your first ads', 'Media Buying is scanning for winners', 'Customer is sorting your inbox'].map((l, i) => (
                <div key={i}><span style={{ color: '#a9d96a' }}>✓</span> {l}</div>
              ))}
            </div>
            <p style={{ ...sub, color: '#7d8a7c', marginTop: 24 }}>The team studies your market all night. But I already have a first read for you.</p>
            <button style={{ ...btnMain, background: '#ef4a1e', color: '#fff', marginTop: 18 }} onClick={() => setStep(0)}>Read my first briefing →</button>
            <div style={{ marginTop: 22, fontSize: 11.5, color: '#5d675c' }}>(preview — loops back to the start)</div>
          </>
        )}

        {step !== 3 && <div style={{ marginTop: 26, fontSize: 11.5, color: '#b6bcae' }}>Preview {step + 1} / 4 · this is the onboarding narrative, no signup needed</div>}
      </div>
      <style>{`@keyframes team-in{from{opacity:0;transform:translateY(9px)}to{opacity:1;transform:none}} .team-in{animation:team-in .5s cubic-bezier(0,0,.2,1) both}`}</style>
    </div>
  )
}
