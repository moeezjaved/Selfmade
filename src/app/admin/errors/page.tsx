'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

interface ErrorLog {
  id: string; user_id: string | null; user_email: string | null;
  error_message: string; error_stack: string | null;
  page_url: string | null; created_at: string; extra?: any;
}

function fmt(d: string) {
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// ── Plain-English translation ───────────────────────────────────────────────
// Every raw error is mapped to a severity + a human title + "what it means / what to do", so the log
// reads like sentences, not stack traces. Most volume is browser-extension / network noise (not app
// bugs) — those are marked "Safe to ignore" and hidden by default.
type Sev = 'serious' | 'watch' | 'info' | 'ignore'
const SEV: Record<Sev, { label: string; color: string; dot: string; rank: number }> = {
  serious: { label: 'Serious',        color: '#dc2626', dot: '#dc2626', rank: 0 },
  watch:   { label: 'Worth a look',   color: '#b45309', dot: '#d97706', rank: 1 },
  info:    { label: 'Info',           color: '#1d4ed8', dot: '#2563eb', rank: 2 },
  ignore:  { label: 'Safe to ignore', color: '#6b7280', dot: '#9ca3af', rank: 3 },
}

function classify(err: ErrorLog): { sev: Sev; tag: string; title: string; meaning: string } {
  const m = err.error_message || ''
  const s = m.toLowerCase()
  const kind = err.extra?.kind

  // Things we log ON PURPOSE (product events, not crashes)
  if (kind === 'plan_limit' || /\b(brand|plan) limit reached\b/i.test(m))
    return { sev: 'info', tag: 'Plan limit', title: 'A user hit their plan limit', meaning: 'They tried to do something beyond their plan (e.g. add another brand). Not a bug — an upgrade signal. Consider reaching out or comping them.' }
  if (kind === 'insufficient_credits' || /\binsufficient credits\b|\bran out of credits\b/i.test(m))
    return { sev: 'info', tag: 'Out of credits', title: 'A user ran out of credits', meaning: 'They tried to generate something but didn’t have enough credits. Not a bug — a top-up / upgrade signal.' }
  if (kind === 'render_failed' || /\brender failed\b|\bgeneration failed\b/i.test(m))
    return { sev: 'serious', tag: 'Render', title: 'A video/image render failed', meaning: 'A generation the user paid credits for failed. Check the credits were refunded; repeated failures point to a provider or pipeline issue.' }
  if (kind === 'payment_failed' || /\bpayment failed\b|\bcapture failed\b|\bcharge (?:failed|declined)\b/i.test(m))
    return { sev: 'serious', tag: 'Payment', title: 'A payment failed', meaning: 'A charge or checkout didn’t go through — the user may have tried to pay and couldn’t. Worth a quick follow-up so you don’t lose the sale.' }

  // React hydration errors = a browser extension changed the page on the VISITOR'S side
  if (/react error #(418|421|422|423|425)\b/i.test(m) || /hydrat|did not match|text content does not match/i.test(s))
    return { sev: 'ignore', tag: 'Browser extension', title: 'Page render mismatch on the visitor’s browser', meaning: 'Almost always a browser extension (Grammarly, translators, ad-blockers, password managers) editing the page. It is NOT a bug in your app — safe to ignore.' }

  // Network aborts — connection dropped or user navigated away mid-request
  if (/failed to fetch|networkerror|load failed|network connection was lost|aborterror|the operation was aborted/i.test(s))
    return { sev: 'ignore', tag: 'Network', title: 'A request got interrupted', meaning: 'The visitor’s internet dropped or they moved to another page mid-request. Harmless unless the SAME user sees it over and over.' }

  // Chunk / deploy — old tab loading files from a previous build
  if (/chunk|dynamically imported|module script failed|importing a module script failed/i.test(s))
    return { sev: 'info', tag: 'Deploy', title: 'App updated while their tab was open', meaning: 'Right after a deploy, an old tab tried to load a file from the previous build. The app auto-reloads to fix it — no action needed.' }

  // Timeouts / gateway
  if (/timeout|timed out|\b504\b|gateway|statement timeout/i.test(s))
    return { sev: 'watch', tag: 'Slow / timeout', title: 'Something took too long', meaning: 'A request timed out. Worth a look if it repeats — usually a slow database query or a busy server.' }

  // Genuine JS bugs
  if (/typeerror|referenceerror|is not a function|cannot read propert|undefined is not|null is not an object|syntaxerror|unexpected token/i.test(s))
    return { sev: 'serious', tag: 'App bug', title: 'A real code error for this user', meaning: 'This looks like an actual bug in the app. Open the details for the stack trace and the page it happened on.' }

  // Other minified React errors (some noise, some real)
  if (/minified react error/i.test(s))
    return { sev: 'watch', tag: 'React', title: 'A React rendering error', meaning: 'Some of these are extension noise, some are real. Open the react.dev link in the details to see which.' }

  // Server 5xx surfaced to the client
  if (/\b(500|502|503)\b|internal server error/i.test(s))
    return { sev: 'serious', tag: 'Server', title: 'A server request failed', meaning: 'The server returned an error for this user. Worth investigating — check the page URL and time against your server logs.' }

  return { sev: 'watch', tag: 'Other', title: m.slice(0, 90) || 'Unknown error', meaning: 'Not auto-categorized. Open the details to see the raw error.' }
}

export default function ErrorsPage() {
  const [errors, setErrors] = useState<ErrorLog[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [hideIgnorable, setHideIgnorable] = useState(true)
  const router = useRouter()

  useEffect(() => {
    fetch('/api/admin/errors').then(r => r.json()).then(d => { setErrors(d.errors || []); setLoading(false) })
  }, [])

  const rows = useMemo(() => errors.map(e => ({ e, c: classify(e) })), [errors])
  const counts = useMemo(() => {
    const c: Record<Sev, number> = { serious: 0, watch: 0, info: 0, ignore: 0 }
    rows.forEach(r => { c[r.c.sev]++ })
    return c
  }, [rows])
  const shown = useMemo(() => rows
    .filter(r => !(hideIgnorable && r.c.sev === 'ignore'))
    .sort((a, b) => SEV[a.c.sev].rank - SEV[b.c.sev].rank || +new Date(b.e.created_at) - +new Date(a.e.created_at)),
    [rows, hideIgnorable])

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111', margin: '0 0 6px' }}>Error Logs</h1>
      <p style={{ color: '#888', fontSize: 14, margin: '0 0 16px' }}>
        {errors.length} recorded · plain-English so you can tell real bugs from browser noise.
      </p>

      {/* Summary — how many of each severity */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {(['serious', 'watch', 'info', 'ignore'] as Sev[]).map(sev => (
          <div key={sev} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fff', border: '1px solid #e8e8e8', borderRadius: 100, padding: '6px 14px' }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: SEV[sev].dot }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: SEV[sev].color }}>{counts[sev]}</span>
            <span style={{ fontSize: 12.5, color: '#6b7280' }}>{SEV[sev].label}</span>
          </div>
        ))}
        <button onClick={() => setHideIgnorable(v => !v)}
          style={{ marginLeft: 'auto', fontSize: 12.5, fontWeight: 700, color: '#374151', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 100, padding: '6px 14px', cursor: 'pointer' }}>
          {hideIgnorable ? `Show safe-to-ignore (${counts.ignore})` : 'Hide safe-to-ignore'}
        </button>
      </div>

      {loading ? (
        <div style={{ color: '#aaa', fontSize: 14 }}>Loading…</div>
      ) : shown.length === 0 ? (
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8e8e8', padding: 48, textAlign: 'center', color: '#aaa', fontSize: 14 }}>
          {errors.length === 0 ? 'No errors recorded yet 🎉' : 'Nothing worth your attention right now — the rest are safe-to-ignore browser noise.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {shown.map(({ e: err, c }) => (
            <div key={err.id} style={{ background: '#fff', borderRadius: 10, border: '1px solid #e8e8e8', overflow: 'hidden' }}>
              <div onClick={() => setExpanded(expanded === err.id ? null : err.id)}
                style={{ padding: '13px 16px', cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: SEV[c.sev].dot, marginTop: 6, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.03em', textTransform: 'uppercase', color: SEV[c.sev].color, background: `${SEV[c.sev].color}14`, borderRadius: 5, padding: '2px 7px' }}>{c.tag}</span>
                    <span style={{ fontSize: 13.5, fontWeight: 700, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</span>
                  </div>
                  <div style={{ fontSize: 12.5, color: '#4b5563', lineHeight: 1.5, marginBottom: 5 }}>{c.meaning}</div>
                  <div style={{ fontSize: 11, color: '#aaa', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                    {err.user_email ? (
                      <button onClick={e => { e.stopPropagation(); if (err.user_id) router.push(`/admin/users/${err.user_id}`) }}
                        style={{ background: 'none', border: 'none', padding: 0, color: '#2563eb', cursor: 'pointer', fontSize: 11 }}>👤 {err.user_email}</button>
                    ) : <span>Anonymous</span>}
                    {err.page_url && <span>📍 {err.page_url}</span>}
                    <span>🕐 {fmt(err.created_at)}</span>
                  </div>
                </div>
                <span style={{ fontSize: 12, color: '#aaa', flexShrink: 0 }}>{expanded === err.id ? '▲' : '▼'}</span>
              </div>

              {expanded === err.id && (
                <div style={{ padding: '0 16px 16px', borderTop: '1px solid #f5f5f5' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', margin: '12px 0 4px' }}>Raw error</div>
                  <div style={{ fontSize: 12, color: '#374151', fontFamily: 'ui-monospace, monospace', wordBreak: 'break-word' }}>{err.error_message}</div>
                  {err.error_stack && (
                    <pre style={{ margin: '10px 0 0', padding: 12, background: '#1e1e1e', color: '#e5e7eb', borderRadius: 8, fontSize: 11, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{err.error_stack}</pre>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
