'use client'
/**
 * TeamRoster — the "meet your team" moment for the landing page. A wall of the AI employees you're
 * hiring, each with a face (original gradient portrait-avatars, generated in-CSS — NOT photos of real
 * people), a name, a role and a one-line job. Gives the "wow, a whole company" feeling Sila-style.
 * Visible-by-default (opacity:1) with a load-stagger, so browser extensions can't blank it.
 */
import React from 'react'

type Member = { name: string; role: string; job: string; hue: number; initials: string }

// The company. Mello is chief of staff; the rest are the departments that report through them.
const TEAM: Member[] = [
  { name: 'Mello', role: 'Chief of Staff', job: 'Runs the company. Brings you one report each morning.', hue: 150, initials: 'M' },
  { name: 'Ravi', role: 'Head of Research', job: 'Reads the market every night — 3M+ ads, 611K brands.', hue: 212, initials: 'R' },
  { name: 'Cleo', role: 'Creative Director', job: 'Remakes winning ads into your brand. Image and video.', hue: 288, initials: 'C' },
  { name: 'Mo', role: 'Media Buyer', job: 'Runs your Facebook ads. Scales what works, asks first.', hue: 158, initials: 'Mo' },
  { name: 'Fin', role: 'Finance', job: 'Watches margin and spend so the growth actually pays.', hue: 42, initials: 'F' },
  { name: 'Suri', role: 'Customer Care', job: 'Answers your inbox on WhatsApp, Instagram and email.', hue: 6, initials: 'S' },
]

export default function TeamRoster() {
  return (
    <section className="tr-wrap">
      <div className="tr-head">
        <div className="tr-eyebrow rv">Your team</div>
        <h2 className="tr-h2 rv d2">Six employees.<br />Hired in one click.</h2>
        <p className="tr-sub rv d3">Not tools. Not templates. A team with names, jobs and a boss —
        working for you tonight.</p>
      </div>

      <div className="tr-grid">
        {TEAM.map((m, i) => (
          <div className="tr-card" key={m.name} style={{ ['--d' as any]: i }}>
            <div className="tr-face" style={{ ['--h' as any]: m.hue }}>
              <span className="tr-init">{m.initials}</span>
              <span className="tr-ring" />
            </div>
            <div className="tr-name">{m.name}</div>
            <div className="tr-role">{m.role}</div>
            <div className="tr-job">{m.job}</div>
          </div>
        ))}
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        .tr-wrap{max-width:1080px;margin:0 auto;padding:96px 20px 40px;text-align:center}
        .tr-eyebrow{font:800 11px/1 ui-monospace,Menlo,monospace;letter-spacing:.16em;text-transform:uppercase;color:#3b6d11}
        .tr-h2{font-size:clamp(30px,5vw,52px);line-height:1.02;margin-top:16px;color:#171d18;letter-spacing:-.02em}
        .tr-sub{max-width:52ch;margin:18px auto 0;font-size:clamp(15px,1.7vw,18px);line-height:1.7;color:#4c5347}

        .tr-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:44px}
        .tr-card{background:#fff;border:1px solid rgba(17,37,28,.08);border-radius:18px;padding:26px 20px 22px;
          box-shadow:0 20px 50px -40px rgba(17,37,28,.5);opacity:1;
          animation:tr-rise .6s cubic-bezier(.2,.7,.2,1) both;animation-delay:calc(var(--d) * .07s);
          transition:transform .3s ease,box-shadow .3s ease}
        .tr-card:hover{transform:translateY(-4px);box-shadow:0 30px 60px -38px rgba(17,37,28,.55)}
        @keyframes tr-rise{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}

        .tr-face{position:relative;width:74px;height:74px;margin:0 auto 16px;border-radius:50%;
          display:grid;place-items:center;
          background:
            radial-gradient(120% 120% at 30% 20%, hsl(var(--h) 85% 72%), hsl(var(--h) 70% 52%) 55%, hsl(calc(var(--h) + 26) 68% 42%) 100%);
          box-shadow:0 10px 24px -12px hsl(var(--h) 60% 45% / .7), inset 0 2px 6px rgba(255,255,255,.35)}
        .tr-init{font:900 26px/1 'Inter',system-ui,sans-serif;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.18);letter-spacing:-.02em}
        .tr-ring{position:absolute;inset:-5px;border-radius:50%;border:2px solid hsl(var(--h) 70% 60% / .35)}

        .tr-name{font:800 18px/1.1 'Inter',system-ui,sans-serif;color:#171d18;letter-spacing:-.01em}
        .tr-role{margin-top:5px;font:800 10.5px/1 ui-monospace,Menlo,monospace;letter-spacing:.09em;text-transform:uppercase;color:#3b6d11}
        .tr-job{margin-top:11px;font-size:13.5px;line-height:1.55;color:#5a6154}

        @media (max-width:820px){ .tr-grid{grid-template-columns:repeat(2,1fr)} }
        @media (max-width:480px){
          .tr-grid{grid-template-columns:1fr;gap:12px}
          .tr-card{padding:22px 18px;display:grid;grid-template-columns:64px 1fr;grid-template-rows:auto auto auto;
            column-gap:16px;text-align:left;align-items:center}
          .tr-face{width:56px;height:56px;margin:0;grid-row:1 / span 2}
          .tr-init{font-size:20px}
          .tr-name{align-self:end}
          .tr-role{margin-top:2px}
          .tr-job{grid-column:1 / -1;margin-top:10px}
        }
        @media (prefers-reduced-motion:reduce){ .tr-card{animation:none!important;opacity:1;transform:none} }
      ` }} />
    </section>
  )
}
