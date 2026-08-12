'use client'
/**
 * /connect/meta — "Teach Mello your ad account." Two doors, easiest first:
 *
 *  EASIEST (default) — the agency-partner model: the founder adds Selfmade as a partner in their
 *  own Business Settings (paste our Business ID, tick their ad account — 60 seconds, a screen
 *  they've already used for freelancers). No apps, no system users, no tokens on their side.
 *
 *  ADVANCED — bring-your-own System User token (agencies / users who won't partner-share).
 *
 *  Both doors land in meta_accounts; every downstream surface (sync, audit, M4) is door-agnostic.
 *  OAuth becomes a third one-click door the day the new Meta app clears review.
 */
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Check, ExternalLink, Copy } from 'lucide-react'
import { META_LIVE } from '@/lib/flags'

const FOREST = '#141d15', LIME = '#ff5a2c', INK = '#161c17', MUTED = '#6f6d5a', LINE = '#efece2', GREEN = '#ef4a1e'
type Acct = { account_id: string; name: string; currency: string; timezone: string; active: boolean }

export default function ConnectMetaByo() {
  const router = useRouter()
  const [tab, setTab] = useState<'partner' | 'token'>('partner')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [learned, setLearned] = useState<any>(null)

  // partner door
  const [bizId, setBizId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [pAccounts, setPAccounts] = useState<Acct[] | null>(null)
  const [pPicked, setPPicked] = useState<string[]>([])

  // token door
  const [token, setToken] = useState('')
  const [accounts, setAccounts] = useState<Acct[] | null>(null)
  const [bizName, setBizName] = useState('')
  const [picked, setPicked] = useState<string[]>([])

  // Meta is a Creator (paid) feature — a Free user shouldn't reach the connect flow (it OAuth'd then
  // dead-ended on an empty home). Gate here → upgrade.
  const [gate, setGate] = useState<'checking' | 'ok' | 'locked'>('checking')
  useEffect(() => {
    fetch('/api/credits/balance').then(r => r.ok ? r.json() : null)
      .then(async j => {
        // Same source of truth as UpgradeGate (/m4, /reports): the plan's `launch` entitlement — so every
        // Meta surface agrees instead of a hardcoded whitelist disagreeing with the rest.
        const { planEntitlements } = await import('@/lib/plans')
        if (planEntitlements(j?.plan).launch) setGate('ok'); else { setGate('locked'); router.replace('/billing?feature=meta') }
      })
      .catch(() => setGate('ok'))   // on error, don't block a paying user
  }, [router])

  useEffect(() => {
    fetch('/api/meta/connect-partner').then((r) => r.json())
      .then((j) => { if (j.businessId) setBizId(j.businessId); else setTab('token') })   // not configured → token door
      .catch(() => setTab('token'))
  }, [])

  const copyBiz = () => { if (bizId) { navigator.clipboard?.writeText(bizId).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1600) } }

  const partnerList = async () => {
    setBusy(true); setErr(null)
    try {
      const r = await fetch('/api/meta/connect-partner', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'list' }) }).then((x) => x.json())
      if (r.error) { setErr(r.error); return }
      if (!r.accounts?.length) { setErr('I don’t see a shared account yet — Meta can take a minute to propagate. Finish the sharing step, wait a moment, and tap again.'); return }
      setPAccounts(r.accounts); setPPicked(r.accounts.map((a: Acct) => a.account_id))
    } catch { setErr('Couldn’t reach Meta — try again in a moment.') } finally { setBusy(false) }
  }

  const partnerConnect = async () => {
    setBusy(true); setErr(null)
    try {
      const r = await fetch('/api/meta/connect-partner', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accountIds: pPicked }) }).then((x) => x.json())
      if (r.error) { setErr(r.error); return }
      setLearned(r)
    } catch { setErr('Couldn’t save the connection — try again.') } finally { setBusy(false) }
  }

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
  const cardS: React.CSSProperties = { background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16, padding: '18px 20px', marginBottom: 14 }
  const btnS: React.CSSProperties = { background: FOREST, color: LIME, border: 'none', borderRadius: 100, padding: '11px 22px', fontSize: 13.5, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 8 }
  const pickRow = (a: Acct, on: boolean, toggle: (c: boolean) => void) => (
    <label key={a.account_id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13.5, border: `1px solid ${on ? '#a8cf6f' : LINE}`, background: on ? '#f4fbe6' : '#fff', borderRadius: 10, padding: '9px 12px', cursor: 'pointer' }}>
      <input type="checkbox" checked={on} onChange={(e) => toggle(e.target.checked)} />
      <span style={{ fontWeight: 700 }}>{a.name}</span>
      <span style={{ color: MUTED, fontSize: 12 }}>act_{a.account_id} · {a.currency}{a.active ? '' : ' · inactive'}</span>
    </label>
  )

  // Don't flash the connect UI to a Free user we're about to redirect to upgrade.
  if (gate !== 'ok') return <div style={{ maxWidth: 640, margin: '0 auto', padding: '60px 20px', color: MUTED, fontSize: 14 }}>{gate === 'locked' ? 'Meta is a Creator feature — taking you to upgrade…' : 'Loading…'}</div>

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '34px 20px 80px', fontFamily: "'Inter', -apple-system, sans-serif", color: INK }}>
      <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-.025em', lineHeight: 1.15 }}>Teach Mello your ad account</div>
      <p style={{ fontSize: 14.5, color: MUTED, lineHeight: 1.65, margin: '10px 0 22px', maxWidth: 54 * 8 }}>
        Mello reads your campaigns tonight and puts the first audit — with one-click fixes — in tomorrow&rsquo;s brief.
      </p>

      {learned ? (
        <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16, padding: '22px 24px' }}>
          <div style={{ fontSize: 17, fontWeight: 800 }}>Connected — {learned.connected} account{learned.connected === 1 ? '' : 's'}. ✓</div>
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
          <button onClick={() => router.push('/brief')} style={{ ...btnS, marginTop: 16, padding: '12px 24px', fontSize: 14 }}>Open my brief →</button>
        </div>
      ) : (
        <>
          {/* ── ONE-CLICK OAuth — the easiest door now that the Meta app is approved. Sends the founder
              straight to Facebook's permission dialog (/api/meta/init → dialog/oauth), then the callback
              stores the account and lands them back here connected. Manual doors stay below as fallback. ── */}
          {META_LIVE && (
            <div style={{ background: FOREST, borderRadius: 16, padding: '22px 24px', marginBottom: 18 }}>
              <div style={{ fontSize: 17, fontWeight: 800, color: '#fff', letterSpacing: '-.02em' }}>Connect with Meta — one click</div>
              <p style={{ fontSize: 13.5, color: '#b8c4b4', lineHeight: 1.6, margin: '6px 0 16px', maxWidth: 460 }}>
                Sign in with Facebook and approve — Mello reads your ad account and puts the first audit in tomorrow&rsquo;s brief. No tokens, no setup.
              </p>
              <a href="/api/meta/init" style={{ display: 'inline-flex', alignItems: 'center', gap: 9, background: '#1877F2', color: '#fff', borderRadius: 100, padding: '12px 24px', fontSize: 14.5, fontWeight: 800, textDecoration: 'none' }}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="#fff" aria-hidden><path d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.96.93-1.96 1.89v2.25h3.33l-.53 3.49h-2.8V24C19.61 23.1 24 18.1 24 12.07Z"/></svg>
                Continue with Facebook
              </a>
            </div>
          )}

          {/* Manual doors (partner-share / BYO token) are the FALLBACK — only shown when one-click OAuth
              isn't live (flag off). With Meta approved, users get the single clean button above; the code
              below stays intact so it can be re-exposed instantly if OAuth ever fails for an agency. */}
          {!META_LIVE && (<>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {bizId && <button onClick={() => { setTab('partner'); setErr(null) }} style={{ ...btnS, background: tab === 'partner' ? FOREST : '#eef2ec', color: tab === 'partner' ? LIME : '#3c463c' }}>Share with Selfmade · easiest</button>}
            <button onClick={() => { setTab('token'); setErr(null) }} style={{ ...btnS, background: tab === 'token' ? FOREST : '#eef2ec', color: tab === 'token' ? LIME : '#3c463c' }}>Use your own token</button>
          </div>

          {tab === 'partner' && bizId ? (
            <>
              <div style={cardS}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  {stepNum(1, !!pAccounts)}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 800 }}>Add Selfmade as a partner <span style={{ color: MUTED, fontWeight: 600 }}>· ~60 seconds</span></div>
                    <ol style={{ fontSize: 13.5, color: '#2c342d', lineHeight: 1.8, margin: '8px 0 0', paddingLeft: 18 }}>
                      <li>Copy our Business ID:&nbsp;
                        <button onClick={copyBiz} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#f4f7f2', border: `1px solid ${LINE}`, borderRadius: 8, padding: '4px 10px', fontSize: 12.5, fontWeight: 800, fontFamily: 'ui-monospace, Menlo, monospace', cursor: 'pointer', color: INK }}>
                          {bizId} {copied ? <Check size={13} color={GREEN} /> : <Copy size={13} />}
                        </button>
                      </li>
                      <li>Open <a href="https://business.facebook.com/settings/partners" target="_blank" rel="noreferrer" style={{ color: GREEN, fontWeight: 700, textDecoration: 'none' }}>Business Settings → Partners <ExternalLink size={11} style={{ display: 'inline', verticalAlign: '-1px' }} /></a> → <b>Add</b> → “Give a partner access to your assets”.</li>
                      <li>Paste the ID → pick your <b>ad account</b> → give <b>Manage campaigns</b> (or full control) → Save.</li>
                    </ol>
                    <div style={{ fontSize: 12, color: MUTED, background: '#f4f7f2', borderRadius: 8, padding: '8px 11px', marginTop: 9, lineHeight: 1.5 }}>No apps, no tokens, nothing to copy back — it&rsquo;s the same screen you&rsquo;d use to add a freelancer. You can remove Selfmade there anytime.</div>
                  </div>
                </div>
              </div>

              <div style={cardS}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  {stepNum(2, false)}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 800 }}>Tell Mello it&rsquo;s done</div>
                    {!pAccounts ? (
                      <button onClick={partnerList} disabled={busy} style={{ ...btnS, marginTop: 10 }}>
                        {busy ? <><Loader2 size={15} className="spin" /> Looking for your account…</> : 'I’ve shared it — find my account'}
                      </button>
                    ) : (
                      <div style={{ marginTop: 10 }}>
                        <div style={{ fontSize: 13, color: GREEN, fontWeight: 750 }}>✓ Found. Pick your account{pAccounts.length === 1 ? '' : 's'}:</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                          {pAccounts.map((a) => pickRow(a, pPicked.includes(a.account_id), (c) => setPPicked((p) => c ? [...p, a.account_id] : p.filter((x) => x !== a.account_id))))}
                        </div>
                        <button onClick={partnerConnect} disabled={busy || !pPicked.length} style={{ ...btnS, marginTop: 12, padding: '12px 24px', fontSize: 14, opacity: pPicked.length ? 1 : 0.5 }}>
                          {busy ? <><Loader2 size={15} className="spin" /> Mello is reading your account…</> : 'Teach Mello this account →'}
                        </button>
                      </div>
                    )}
                    {err && <div style={{ marginTop: 10, fontSize: 13, color: '#a3382d', lineHeight: 1.55, background: '#fbe9e6', borderRadius: 10, padding: '9px 12px' }}>{err}</div>}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
              <div style={cardS}>
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

              <div style={cardS}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  {stepNum(2, false)}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 800 }}>Paste the token</div>
                    <textarea value={token} onChange={(e) => { setToken(e.target.value); setAccounts(null); setErr(null) }} rows={3}
                      placeholder="EAAG… (the token stays encrypted on our servers — it’s never shown again or sent to your browser)"
                      style={{ width: '100%', marginTop: 8, fontSize: 12.5, fontFamily: 'ui-monospace, Menlo, monospace', border: `1.5px solid ${LINE}`, borderRadius: 10, padding: '10px 12px', resize: 'vertical', boxSizing: 'border-box' }} />
                    {!accounts && (
                      <button onClick={validate} disabled={busy || token.trim().length < 30} style={{ ...btnS, marginTop: 10, opacity: token.trim().length < 30 ? 0.5 : 1 }}>
                        {busy ? <><Loader2 size={15} className="spin" /> Checking with Meta…</> : 'Validate token'}
                      </button>
                    )}
                    {err && <div style={{ marginTop: 10, fontSize: 13, color: '#a3382d', lineHeight: 1.55, background: '#fbe9e6', borderRadius: 10, padding: '9px 12px' }}>{err}</div>}
                    {accounts && (
                      <div style={{ marginTop: 12 }}>
                        <div style={{ fontSize: 13, color: GREEN, fontWeight: 750 }}>✓ Token valid — {bizName}. Pick the account{accounts.length === 1 ? '' : 's'} Mello should watch:</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                          {accounts.map((a) => pickRow(a, picked.includes(a.account_id), (c) => setPicked((p) => c ? [...p, a.account_id] : p.filter((x) => x !== a.account_id))))}
                        </div>
                        <button onClick={connect} disabled={busy || !picked.length} style={{ ...btnS, marginTop: 12, padding: '12px 24px', fontSize: 14, opacity: picked.length ? 1 : 0.5 }}>
                          {busy ? <><Loader2 size={15} className="spin" /> Mello is reading your account…</> : `Teach Mello ${picked.length > 1 ? `these ${picked.length} accounts` : 'this account'} →`}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
          </>)}

          <p style={{ fontSize: 12, color: '#9aa79a', lineHeight: 1.6, marginTop: 14 }}>
            Security: access is validated server-side, encrypted at rest, and used only to read your campaigns and
            perform actions you approve from your brief. Disconnect anytime — remove Selfmade in Business Settings → Partners, or in Settings here.
          </p>
        </>
      )}
      <style>{`.spin{animation:cmspin 1s linear infinite}@keyframes cmspin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}
