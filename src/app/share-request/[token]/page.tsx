'use client'
/**
 * Partner collaboration accept page (Motion's /share-request). A partner lands here from the invite
 * email: shows the shared report, lets them accept into their workspace, then drops them into the
 * report (which now lives under "Shared with me"). Requires sign-in first.
 */
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const FONT = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'

export default function ShareRequestPage() {
  const { token } = useParams<{ token: string }>()
  const router = useRouter()
  const supabase = createClient()
  const [invite, setInvite] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [workspace, setWorkspace] = useState('Your workspace')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.user) { window.location.href = `/login?next=${encodeURIComponent(`/share-request/${token}`)}`; return }
      const name = session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || 'Your workspace'
      setWorkspace(`${name}${name.endsWith('s') ? "'" : "'s"} Workspace`)
      fetch(`/api/reports/collab/${token}`).then(r => r.json()).then(j => {
        if (j.error) setErr(j.error === 'not_found' ? 'This invite is no longer available.' : j.error)
        else setInvite(j)
      }).catch(() => setErr('Could not load this invite.')).finally(() => setLoading(false))
    })
  }, [token])

  const accept = async () => {
    setBusy(true); setErr('')
    try {
      const res = await fetch(`/api/reports/collab/${token}`, { method: 'POST' })
      const j = await res.json()
      if (!res.ok) { setErr(j.error || 'Could not accept.'); return }
      router.push(`/reports?report=${j.reportId}`)
    } catch (e: any) { setErr(e.message) }
    finally { setBusy(false) }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#eef1e8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT, padding: 20 }}>
      <div style={{ width: 440, maxWidth: '100%', background: '#fff', borderRadius: 18, boxShadow: '0 24px 60px -20px rgba(0,0,0,.3)', padding: '26px 26px 22px', position: 'relative' }}>
        <button onClick={() => router.push('/dashboard')} style={{ position: 'absolute', top: 18, right: 18, border: 'none', background: 'transparent', cursor: 'pointer', color: '#9aa196', fontSize: 16 }}>✕</button>

        {loading ? (
          <div style={{ padding: '30px 0', textAlign: 'center', color: '#7c8577' }}>Loading invite…</div>
        ) : err && !invite ? (
          <div style={{ padding: '20px 0' }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#0e1b12', marginBottom: 8 }}>Invite unavailable</div>
            <div style={{ fontSize: 14, color: '#6f7a68', marginBottom: 20 }}>{err}</div>
            <button onClick={() => router.push('/dashboard')} style={btnDark}>Go to dashboard</button>
          </div>
        ) : invite ? (
          <>
            <div style={{ fontSize: 19, fontWeight: 800, color: '#0e1b12', lineHeight: 1.3, marginBottom: 18, paddingRight: 20 }}>
              {invite.ownerName} wants to collaborate on a report with you
            </div>
            <div style={{ background: '#f4f6f0', border: '1px solid rgba(20,29,21,.08)', borderRadius: 12, padding: '14px 16px', marginBottom: 20 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#0e1b12', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 18 }}>{invite.emoji}</span>{invite.reportName}
              </div>
              <div style={{ fontSize: 13, color: '#9aa196', marginTop: 3 }}>Shared from {invite.ownerName}</div>
            </div>

            <div style={{ fontSize: 13, fontWeight: 600, color: '#3a4636', marginBottom: 7 }}>Select a workspace</div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: '1px solid rgba(20,29,21,.16)', borderRadius: 11, padding: '11px 14px', fontSize: 14, fontWeight: 600, color: '#0e1b12', marginBottom: 22 }}>
              {workspace}
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#7c8577" strokeWidth="1.7"><path d="M2 4l4 4 4-4" strokeLinecap="round" /></svg>
            </div>

            {invite.status === 'accepted' && <div style={{ fontSize: 12.5, color: '#2d7a2d', marginBottom: 12 }}>You've already accepted — accepting again just refreshes access.</div>}
            {err && <div style={{ fontSize: 12.5, color: '#c0392b', marginBottom: 12 }}>{err}</div>}

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1 }} />
              <button onClick={() => router.push('/dashboard')} style={btnGhost}>Cancel</button>
              <button onClick={accept} disabled={busy} style={btnDark}>{busy ? 'Accepting…' : 'Accept'}</button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}

const btnDark: React.CSSProperties = { padding: '10px 20px', borderRadius: 11, border: 'none', background: '#0e1b12', color: '#f4f7ef', fontWeight: 700, fontSize: 13.5, cursor: 'pointer', fontFamily: FONT }
const btnGhost: React.CSSProperties = { padding: '10px 18px', borderRadius: 11, border: '1px solid rgba(20,29,21,.16)', background: '#fff', color: '#3a4636', fontWeight: 600, fontSize: 13.5, cursor: 'pointer', fontFamily: FONT }
