'use client'
/**
 * /connect/meta — "Teach Mello your ad account." The BYO-token door (works TODAY, no Meta app
 * review): a 30-second guided mint of a System User token → paste-and-validate (never
 * paste-and-pray) → pick accounts → Mello reads back what it learned with real numbers and promises
 * the first audit in tomorrow's brief. OAuth becomes step-①'s one-button alternative the day the
 * app is approved — nothing else changes (both doors land in meta_accounts).
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Check, ExternalLink } from 'lucide-react'

const FOREST = '#17251c', LIME = '#dffe95', INK = '#161c17', MUTED = '#68756b', LINE = '#e7ece7', GREEN = '#3f8f4f'
type Acct = { account_id: string; name: string; currency: string; timezone: string; active: boolean }

export default function ConnectMetaByo() {
  const router = useRouter()
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [accounts, setAccounts] = useState<Acct[] | null>(null)
  const [bizName, setBizName] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [learned, setLearned] = useState<any>(null)

  const validate = async () => {
    setBusy(true); setErr(null)
    try {
      const r = await fetch('/api/meta/connect-byo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, action: 'validate' }) }).then((x) => x.json())
      if (r.error) { setErr(r.error); return }
      setBizName(r.name); setAccounts(r.accounts); setPicked(r.accounts.map((a: Acct) => a.account_id))
    } catch { setErr('Couldn’t reach Meta — try again in a moment.') } finally { setBusy(false) }
  }

  const connect = async () => {
    setBusy(true); setErr(null)
    try {
      const r = await fetch('/api/meta/connect-byo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, accountIds: picked }) }).then((x) => x.json())
      if (r.error) { setErr(r.error); return }
      setLearned(r)
    } catch { setErr('Couldn’t save the connection — try again.') } finally { setBusy(false) }
  }

  const stepNum = (n: number, done: boolean) => (
    <span style={{ width: 26, height: 26, borderRadius: '50%', background: done ? GREEN : FOREST, color: done ? '#fff' : LIME, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, flexShrink: 0 }}>{done ? <Check size={14} /> : n}</span>
  )

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '34px 20px 80px', fontFamily: "'Inter', -apple-system, sans-serif", color: INK }}>
      <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-.025em', lineHeight: 1.15 }}>Teach Mello your ad account</div>
      <p style={{ fontSize: 14.5, color: MUTED, lineHeight: 1.65, margin: '10px 0 26px', maxWidth: 54 * 8 }}>
        Connect Meta with your own Business token — no waiting on app approvals, your business, your token.
        Mello reads your campaigns tonight and puts the first audit in tomorrow&rsquo;s brief.
      </p>

      {/* ── done state — the read-back ── */}
      {learned ? (
        <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16, padding: '22px 24px' }}>
          <div style={{ fontSize: 17, fontWeight: 800 }}>Connected — {learned.connected} account{learned.connected === 1 ? '' : 's'} for {learned.name}. ✓</div>
          {learned.learned ? (
            <p style={{ fontSize: 14, color: '#2c342d', lineHeight: 1.7, margin: '10px 0 0' }}>
              I just read <b>{learned.learned.campaigns} campaigns</b> — ${Number(learned.learned.activeSpend).toLocaleString()} spend at {learned.learned.roas}x average ROAS over the last 14 days.
              {learned.learned.scale > 0 && <> <b style={{ color: GREEN }}>{learned.learned.scale} ready to scale.</b></>}
              {learned.learned.pause > 0 && <> <b style={{ color: '#a3382d' }}>{learned.learned.pause} burning budget.</b></>}
              {' '}The full audit — with one-click actions — is in your brief.
            </p>
          ) : (
            <p style={{ fontSize: 14, color: MUTED, lineHeight: 1.65, margin: '10px 0 0' }}>I&rsquo;m reading your campaigns now — the audit lands in your Morning Brief.</p>
          )}
          <button onClick={() => router.push('/brief')} style={{ marginTop: 16, background: FOREST, color: LIME, border: 'none', borderRadius: 100, padding: '12px 24px', fontSize: 14, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>Open my brief →</button>
        </div>
      ) : (
        <>
          {/* ── step 1 — mint the token (guided) ── */}
          <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16, padding: '18px 20px', marginBottom: 14 }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              {stepNum(1, !!accounts)}
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 800 }}>Create a System User token <span style={{ color: MUTED, fontWeight: 600 }}>· ~2 minutes, one time</span></div>
                <ol style={{ fontSize: 13.5, color: '#2c342d', lineHeight: 1.8, margin: '8px 0 0', paddingLeft: 18 }}>
                  <li><b>Add an app to your Business</b> (required before a token can be generated — a brand-new app is fine, <b>no review needed</b>): <a href="https://business.facebook.com/settings/apps" target="_blank" rel="noreferrer" style={{ color: GREEN, fontWeight: 700, textDecoration: 'none' }}>Business Settings → Apps <ExternalLink size={11} style={{ display: 'inline', verticalAlign: '-1px' }} /></a> → <b>Add → Create a New App ID</b> → name it “Selfmade”, type <b>Business</b>.</li>
                  <li>Open <a href="https://business.facebook.com/settings/system-users" target="_blank" rel="noreferrer" style={{ color: GREEN, fontWeight: 700, textDecoration: 'none' }}>System users <ExternalLink size={11} style={{ display: 'inline', verticalAlign: '-1px' }} /></a> → <b>Add</b> a system user (name “Selfmade”, role Admin), then <b>Assign assets</b> → your ad account(s) → full control.</li>
                  <li><b>Generate token</b> → pick the app from step 1 → scopes <b>ads_read</b>, <b>ads_management</b>, <b>read_insights</b> → expiry <b>Never</b> → copy it.</li>
                </ol>
                <div style={{ fontSize: 12, color: MUTED, background: '#f4f7f2', borderRadius: 8, padding: '8px 11px', marginTop: 9, lineHeight: 1.5 }}>“Generate token” greyed out? That’s step 1 — your Business has no app yet. Add one (above) and it lights up. The app needs no approval to read <i>your own</i> ad account.</div>
              </div>
            </div>
          </div>

          {/* ── step 2 — paste + validate + pick ── */}
          <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16, padding: '18px 20px' }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              {stepNum(2, false)}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 800 }}>Paste the token</div>
                <textarea value={token} onChange={(e) => { setToken(e.target.value); setAccounts(null); setErr(null) }} rows={3}
                  placeholder="EAAG… (the token stays encrypted on our servers — it’s never shown again or sent to your browser)"
                  style={{ width: '100%', marginTop: 8, fontSize: 12.5, fontFamily: 'ui-monospace, Menlo, monospace', border: `1.5px solid ${LINE}`, borderRadius: 10, padding: '10px 12px', resize: 'vertical', boxSizing: 'border-box' }} />
                {!accounts && (
                  <button onClick={validate} disabled={busy || token.trim().length < 30}
                    style={{ marginTop: 10, background: FOREST, color: LIME, border: 'none', borderRadius: 100, padding: '11px 20px', fontSize: 13.5, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', opacity: token.trim().length < 30 ? 0.5 : 1, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    {busy ? <><Loader2 size={15} className="spin" /> Checking with Meta…</> : 'Validate token'}
                  </button>
                )}
                {err && <div style={{ marginTop: 10, fontSize: 13, color: '#a3382d', lineHeight: 1.55, background: '#fbe9e6', borderRadius: 10, padding: '9px 12px' }}>{err}</div>}

                {accounts && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 13, color: GREEN, fontWeight: 750 }}>✓ Token valid — {bizName}. Pick the account{accounts.length === 1 ? '' : 's'} Mello should watch:</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                      {accounts.map((a) => (
                        <label key={a.account_id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13.5, border: `1px solid ${picked.includes(a.account_id) ? '#a8cf6f' : LINE}`, background: picked.includes(a.account_id) ? '#f4fbe6' : '#fff', borderRadius: 10, padding: '9px 12px', cursor: 'pointer' }}>
                          <input type="checkbox" checked={picked.includes(a.account_id)} onChange={(e) => setPicked((p) => e.target.checked ? [...p, a.account_id] : p.filter((x) => x !== a.account_id))} />
                          <span style={{ fontWeight: 700 }}>{a.name}</span>
                          <span style={{ color: MUTED, fontSize: 12 }}>act_{a.account_id} · {a.currency}{a.active ? '' : ' · inactive'}</span>
                        </label>
                      ))}
                    </div>
                    <button onClick={connect} disabled={busy || !picked.length}
                      style={{ marginTop: 12, background: FOREST, color: LIME, border: 'none', borderRadius: 100, padding: '12px 24px', fontSize: 14, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', opacity: picked.length ? 1 : 0.5, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      {busy ? <><Loader2 size={15} className="spin" /> Mello is reading your account…</> : `Teach Mello ${picked.length > 1 ? `these ${picked.length} accounts` : 'this account'} →`}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          <p style={{ fontSize: 12, color: '#9aa79a', lineHeight: 1.6, marginTop: 14 }}>
            Security: the token is validated server-side, AES-encrypted at rest, and used only to read your campaigns and
            perform actions you approve from your brief. Disconnect anytime in Settings.
          </p>
        </>
      )}
      <style>{`.spin{animation:cmspin 1s linear infinite}@keyframes cmspin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}
