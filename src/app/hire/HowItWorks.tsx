'use client'
/**
 * HowItWorks — "One company. Three steps." The practical explainer before the signature: Connect →
 * Teach → Let it work, closing on "You don't manage the work. You manage the decisions." Visible-by-
 * default (opacity:1) with a load-stagger so extensions can't blank it; reduced-motion safe.
 */
import React from 'react'

const INK = '#17251c'

const STEPS: { n: string; title: string; body: string }[] = [
  { n: '01', title: 'Connect', body: 'Give Selfmade access to your business — Slack, WhatsApp, Shopify, Meta, email and your documents.' },
  { n: '02', title: 'Teach', body: 'Tell it how you work, what you sell and what matters. Once. It becomes the company brain.' },
  { n: '03', title: 'Let it work', body: 'Your departments research, create, market and answer customers — then report back every morning.' },
]

export default function HowItWorks() {
  return (
    <section className="hw-wrap">
      <div className="hw-head">
        <div className="hw-eye">How it works</div>
        <h2 className="hw-title">One company. Three steps.</h2>
      </div>

      <div className="hw-grid">
        {STEPS.map((s, i) => (
          <div className="hw-step" key={s.n} style={{ ['--d' as any]: i }}>
            <div className="hw-n">{s.n}</div>
            <div className="hw-t">{s.title}</div>
            <div className="hw-b">{s.body}</div>
          </div>
        ))}
      </div>

      <p className="hw-punch">You don’t manage the work.<br /><b>You manage the decisions.</b></p>

      <style dangerouslySetInnerHTML={{ __html: `
        .hw-wrap{max-width:1000px;margin:96px auto 0;padding:0 20px;text-align:center}
        .hw-eye{font:800 11px/1 ui-monospace,Menlo,monospace;letter-spacing:.16em;text-transform:uppercase;color:#9aa79a}
        .hw-title{font-family:'Instrument Serif',Georgia,serif;font-size:clamp(30px,5vw,50px);line-height:1.03;color:${INK};margin:14px 0 0;letter-spacing:-.01em}

        .hw-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:44px;text-align:left}
        .hw-step{background:#fff;border:1px solid rgba(17,37,28,.08);border-radius:18px;padding:24px 22px 26px;
          box-shadow:0 20px 50px -42px rgba(17,37,28,.5);opacity:1;
          animation:hw-rise .6s cubic-bezier(.2,.7,.2,1) both;animation-delay:calc(var(--d) * .1s)}
        @keyframes hw-rise{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}
        .hw-n{display:inline-grid;place-items:center;width:34px;height:34px;border-radius:10px;background:${INK};color:#dffe95;font:900 13px/1 'Inter',sans-serif}
        .hw-t{margin-top:16px;font:800 20px/1.1 'Inter',system-ui,sans-serif;color:${INK};letter-spacing:-.01em}
        .hw-b{margin-top:9px;font-size:14px;line-height:1.55;color:#5a6154}

        .hw-punch{margin:40px auto 0;font-family:'Instrument Serif',Georgia,serif;font-size:clamp(24px,3.6vw,38px);line-height:1.18;color:${INK};text-wrap:balance}
        .hw-punch b{color:#3b6d11}

        @media (max-width:820px){ .hw-grid{grid-template-columns:1fr;gap:12px} }
        @media (prefers-reduced-motion:reduce){ .hw-step{animation:none!important;opacity:1;transform:none} }
      ` }} />
    </section>
  )
}
