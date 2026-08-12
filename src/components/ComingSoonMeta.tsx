'use client'
/**
 * Coming-soon teaser for Meta-connected surfaces (Launch, Campaigns, Insights, Reports…).
 * Shown while META_LIVE is off (new Facebook app awaiting review). Captures intent via a
 * notify-me button (POST /api/meta-waitlist → email to the team, no DB) and routes the user
 * back to the live spy→clone loop. Colours target the app's LIGHT dashboard content area
 * (dark text on light bg) so it stays readable. Pure client component.
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
    <div style={{ minHeight: '72vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 24px' }}>
      <div style={{ maxWidth: 540, textAlign: 'center' }}>
        <div style={{ display: 'inline-block', background: '#dcfce7', border: '1px solid #86efac', color: '#15803d', fontSize: 11, fontWeight: 800, letterSpacing: '.09em', textTransform: 'uppercase', padding: '5px 14px', borderRadius: 100, marginBottom: 20 }}>
          Coming soon
        </div>
        <h1 style={{ fontSize: 30, fontWeight: 900, color: '#0e1b12', letterSpacing: '-.02em', marginBottom: 14, lineHeight: 1.15 }}>
          {feature} is almost here
        </h1>
        <p style={{ fontSize: 15, color: '#45573f', lineHeight: 1.65, marginBottom: 28, maxWidth: 460, marginLeft: 'auto', marginRight: 'auto' }}>
          {feature} connects directly to your Meta ad account — we&apos;re rolling it out to early
          users in the next few weeks. Until then, the full spy&nbsp;→&nbsp;clone workflow is live:
          find any winning ad and turn it into <b>your</b> ad in minutes.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button onClick={notify} disabled={state !== 'idle'}
            style={{ background: state === 'done' ? '#dcfce7' : '#141d15', color: state === 'done' ? '#15803d' : '#ff5a2c', border: state === 'done' ? '1px solid #86efac' : 'none', fontWeight: 800, fontSize: 14, padding: '13px 24px', borderRadius: 12, cursor: state === 'idle' ? 'pointer' : 'default', fontFamily: 'inherit' }}>
            {state === 'done' ? "You're on the list ✓" : state === 'sending' ? 'Adding you…' : 'Notify me when it launches'}
          </button>
          <Link href="/discovery"
            style={{ display: 'inline-flex', alignItems: 'center', background: '#fff', color: '#141d15', border: '1.5px solid #cdd8cf', fontWeight: 700, fontSize: 14, padding: '13px 24px', borderRadius: 12, textDecoration: 'none' }}>
            Remake a winning ad now →
          </Link>
        </div>
      </div>
    </div>
  )
}
