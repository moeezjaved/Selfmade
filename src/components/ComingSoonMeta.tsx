'use client'
/**
 * Coming-soon teaser for Meta-connected surfaces (Launch, Campaigns, Insights, Reports…).
 * Shown while META_LIVE is off (new Facebook app awaiting review). Captures intent via a
 * notify-me button (POST /api/meta-waitlist → email to the team, no DB) and routes the user
 * back to the live spy→clone loop. Pure client component; delete nothing, flip the flag later.
 */
import { useState } from 'react'
import Link from 'next/link'

export default function ComingSoonMeta({ feature }: { feature: string }) {
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle')

  const notify = async () => {
    if (state !== 'idle') return
    setState('sending')
    try {
      await fetch('/api/meta-waitlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ feature }),
      })
    } catch { /* best-effort — still show success so the moment isn't wasted */ }
    setState('done')
  }

  return (
    <div style={{ minHeight: '70vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px' }}>
      <div style={{ maxWidth: 520, textAlign: 'center' }}>
        <div style={{ display: 'inline-block', background: 'rgba(223,254,149,0.12)', border: '1px solid rgba(223,254,149,0.3)', color: '#dffe95', fontSize: 11, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', padding: '5px 14px', borderRadius: 100, marginBottom: 18 }}>
          Coming soon
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 900, color: '#fff', letterSpacing: '-.02em', marginBottom: 12 }}>
          {feature} is almost here
        </h1>
        <p style={{ fontSize: 14.5, color: 'rgba(255,255,255,0.55)', lineHeight: 1.65, marginBottom: 26 }}>
          {feature} connects directly to your Meta ad account — we&apos;re rolling it out to early users
          in the next few weeks. Until then, the full spy&nbsp;→&nbsp;clone workflow is live: find any
          winning ad and turn it into <i>your</i> ad in minutes.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button onClick={notify} disabled={state !== 'idle'}
            style={{ background: state === 'done' ? 'rgba(223,254,149,0.15)' : '#dffe95', color: state === 'done' ? '#dffe95' : '#0e1b12', border: state === 'done' ? '1px solid rgba(223,254,149,0.35)' : 'none', fontWeight: 800, fontSize: 14, padding: '12px 22px', borderRadius: 12, cursor: state === 'idle' ? 'pointer' : 'default', fontFamily: 'inherit' }}>
            {state === 'done' ? "You're on the list ✓" : state === 'sending' ? 'Adding you…' : 'Notify me when it launches'}
          </button>
          <Link href="/discovery"
            style={{ display: 'inline-flex', alignItems: 'center', background: 'transparent', color: 'rgba(255,255,255,0.75)', border: '1px solid rgba(255,255,255,0.16)', fontWeight: 700, fontSize: 14, padding: '12px 22px', borderRadius: 12, textDecoration: 'none' }}>
            Clone a winning ad now →
          </Link>
        </div>
      </div>
    </div>
  )
}
