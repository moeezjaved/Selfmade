'use client'
/**
 * "Watch this brand" — for a LOGGED-IN user it actually enrolls the brand into spy + follow (so it
 * starts landing in the brief), instead of the old link to /signup which bounced logged-in users to
 * the home page. Logged-out users (401) are sent to /signup as before.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'

const LIME = '#ff5a2c', FOREST = '#141d15'

export default function WatchBrandButton({ pageId, name }: { pageId: string; name: string }) {
  const router = useRouter()
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle')

  async function watch() {
    if (state === 'done') { router.push('/discovery/brand-spy'); return }
    if (state === 'busy') return
    setState('busy')
    try {
      const r = await fetch('/api/discovery/brand-spy', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pageId, name, crawlOnly: true }) })
      if (r.status === 401) { router.push('/signup'); return }
      await fetch('/api/follows', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pageId, brandName: name, action: 'follow' }) }).catch(() => {})
      setState('done')
    } catch { setState('idle') }
  }

  return (
    <button onClick={watch} disabled={state === 'busy'}
      style={{ background: '#ef4a1e', color: '#fff', fontSize: 13.5, fontWeight: 800, padding: '11px 20px', borderRadius: 100, border: 'none', cursor: state === 'busy' ? 'default' : 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', opacity: state === 'busy' ? 0.7 : 1 }}>
      {state === 'busy' ? 'Adding…' : state === 'done' ? '✓ Watching — open Brand Spy →' : 'Watch this brand →'}
    </button>
  )
}
