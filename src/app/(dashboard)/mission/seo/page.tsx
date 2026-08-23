'use client'
/**
 * /mission/seo — the SEO department. Phase 1: a technical audit of the brand's real site (title/meta/H1/
 * schema/thin-content/canonical/alt issues), scored, grouped by severity. Everything shown is a fact found
 * on a real page — the crawler reads your site (resolved from your Meta ads / GEO). Keyword brain +
 * Programmatic SEO land in later phases.
 */
import { useCallback, useEffect, useState } from 'react'

type Issue = { severity: 'high' | 'medium' | 'low'; title: string; detail: string; pages: string[] }
type Audit = { hasData: boolean; site?: string; score?: number; pagesCrawled?: number; issues?: Issue[]; note?: string }

export default function SeoPage() {
  const [audit, setAudit] = useState<Audit | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [open, setOpen] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try { const r = await fetch('/api/seo/audit'); const j = await r.json(); if (r.ok) setAudit(j as Audit) } catch { /* empty */ }
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const runAudit = async () => {
    if (running) return
    setRunning(true)
    try { const r = await fetch('/api/seo/audit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); const j = await r.json(); if (r.ok) setAudit(j as Audit) } catch { /* keep */ }
    setRunning(false)
  }

  const issues = audit?.issues || []
  const counts = { high: issues.filter((i) => i.severity === 'high').length, medium: issues.filter((i) => i.severity === 'medium').length, low: issues.filter((i) => i.severity === 'low').length }

  return (
    <div className="seo">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="wrap">
        <a href="/mission" className="back">← Back to your desk</a>
        <div className="top">
          <div>
            <div className="eyebrow">SEO · technical audit</div>
            <h1>Is your site built to rank?</h1>
            <p className="sub">I crawl your real site and flag the technical + on-page issues holding back your Google rankings. Every finding is a fact from a real page{audit?.site ? <> on <b>{host(audit.site)}</b></> : null}.</p>
          </div>
          <div className="runbox">
            <button className="btn lime" onClick={runAudit} disabled={running}>{running ? 'Crawling your site…' : audit?.hasData ? '↻ Re-audit' : 'Audit my site →'}</button>
            <div className="runcost">crawls up to 10 pages · free</div>
          </div>
        </div>

        {running && <div className="note">Fetching your pages and checking titles, meta, headings, schema, content depth…</div>}

        {!loading && audit && !audit.hasData && !running && (
          <div className="empty">{audit.note || 'No audit yet. Tap “Audit my site” and I’ll crawl your pages.'}</div>
        )}

        {audit && audit.hasData && (
          <>
            <div className="score">
              <div className="big"><span className={`n ${scoreClass(audit.score || 0)}`}>{audit.score}</span><span className="lbl">/ 100 SEO health</span></div>
              <div className="scap">Crawled <b>{audit.pagesCrawled}</b> pages · <b className="hi">{counts.high}</b> critical · <b>{counts.medium}</b> to improve · <b>{counts.low}</b> minor. {counts.high > 0 ? 'Fix the critical ones first — they directly block rankings.' : 'Solid foundation — tighten the rest to compete.'}</div>
            </div>

            <div className="lead">What to fix</div>
            {issues.length === 0 && <div className="empty small">No issues found on the pages I crawled — clean.</div>}
            {issues.map((iss, i) => (
              <div className={`issue ${iss.severity}`} key={i}>
                <div className="ihead" onClick={() => setOpen(open === iss.title ? null : iss.title)}>
                  <span className={`sev ${iss.severity}`}>{iss.severity}</span>
                  <span className="it">{iss.title}</span>
                  <span className="ic">{iss.pages.length} page{iss.pages.length === 1 ? '' : 's'}</span>
                </div>
                <div className="idetail">{iss.detail}</div>
                {open === iss.title && (
                  <div className="ipages">
                    {iss.pages.map((p, j) => <a key={j} href={p} target="_blank" rel="noopener noreferrer" className="pg">{path(p)}</a>)}
                  </div>
                )}
              </div>
            ))}

            <div className="foot">Every finding is read live from your site — nothing is assumed. Next: I’ll fix these for you (needs Shopify), plus keyword research + programmatic pages.</div>
          </>
        )}
      </div>
    </div>
  )
}

const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, '') } catch { return u } }
const path = (u: string) => { try { const x = new URL(u); return (x.pathname === '/' ? x.hostname.replace(/^www\./, '') : x.pathname) } catch { return u } }
const scoreClass = (n: number) => (n >= 80 ? 'good' : n >= 55 ? 'mid' : 'bad')

const CSS = `
.seo{--ink:#161c17;--sub:#6f6d5a;--mut:#9aa79a;--paper:#faf9f5;--shell:#ffffff;--card:#ffffff;--hair:#ecebe3;--line:#e3e2da;--flame:#ef4a1e;--lime:#ff5a2c;--live:#3f7a4e;--warn:#a9852f;--greenBg:#eef6e4;
  --serif:'Instrument Serif',Georgia,serif;--ui:'Inter',system-ui,sans-serif;--mono:ui-monospace,'SF Mono',Menlo,monospace;
  background:var(--shell);color:var(--ink);min-height:100%;font-family:var(--ui);font-size:14px;line-height:1.5}
.seo a{color:var(--flame);text-decoration:none}
.wrap{max-width:900px;margin:0 auto;padding:26px clamp(18px,4vw,40px) 80px}
.back{font-family:var(--mono);font-size:12px;color:var(--sub);display:inline-block;margin-bottom:22px}
.top{display:flex;gap:20px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;border-bottom:1px solid var(--line);padding-bottom:22px}
.eyebrow{font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--mut);margin-bottom:8px}
h1{font-family:var(--serif);font-weight:400;font-size:clamp(30px,5vw,44px);line-height:1.05;letter-spacing:-.01em;margin:0}
.sub{font-size:15px;color:var(--sub);margin-top:10px;max-width:560px}
.btn{font-family:var(--ui);font-size:13px;font-weight:600;border-radius:10px;padding:11px 17px;cursor:pointer;border:1px solid var(--line);background:var(--card);color:var(--ink)}
.btn.lime{background:var(--lime);border-color:var(--lime);color:#fff}
.btn:disabled{opacity:.55;cursor:default}
.runbox{display:flex;flex-direction:column;align-items:flex-end;gap:6px}
.runcost{font-family:var(--mono);font-size:10.5px;color:var(--mut)}
.note{font-family:var(--mono);font-size:12.5px;color:var(--sub);background:var(--paper);border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin-top:18px}
.empty{color:var(--sub);font-size:15px;padding:34px 0;max-width:560px}
.empty.small{font-size:13px;padding:14px 0}
.score{display:flex;gap:24px;align-items:center;flex-wrap:wrap;margin:26px 0 6px;padding:20px 22px;background:var(--paper);border:1px solid var(--line);border-radius:16px}
.score .big{display:flex;align-items:baseline;gap:8px;flex:none}
.score .big .n{font-family:var(--serif);font-size:56px;line-height:1}
.score .big .n.good{color:var(--live)} .score .big .n.mid{color:var(--warn)} .score .big .n.bad{color:var(--flame)}
.score .big .lbl{font-family:var(--mono);font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--mut)}
.score .scap{flex:1;min-width:220px;font-size:14px;color:var(--sub);line-height:1.5}
.score .scap b{color:var(--ink)} .score .scap b.hi{color:var(--flame)}
.lead{font-family:var(--serif);font-size:23px;margin:30px 0 12px}
.issue{border:1px solid var(--line);border-radius:12px;background:var(--card);padding:14px 16px;margin-bottom:10px;border-left-width:3px}
.issue.high{border-left-color:var(--flame)} .issue.medium{border-left-color:var(--warn)} .issue.low{border-left-color:var(--mut)}
.ihead{display:flex;align-items:center;gap:10px;cursor:pointer}
.sev{font-family:var(--mono);font-size:9px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;border-radius:100px;padding:3px 8px;flex:none}
.sev.high{color:var(--flame);background:#fff4f0;border:1px solid #ffd9cc} .sev.medium{color:var(--warn);background:#fbf6ea;border:1px solid #ecdcb4} .sev.low{color:var(--mut);background:var(--paper);border:1px solid var(--line)}
.it{font-family:var(--serif);font-size:18px;letter-spacing:-.005em;flex:1;min-width:0}
.ic{font-family:var(--mono);font-size:10.5px;color:var(--mut);flex:none}
.idetail{font-size:13px;color:var(--sub);line-height:1.5;margin-top:6px}
.ipages{margin-top:10px;border-top:1px solid var(--hair);padding-top:10px;display:flex;flex-direction:column;gap:4px}
.pg{font-family:var(--mono);font-size:11.5px;color:var(--flame);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.foot{margin-top:22px;font-family:var(--mono);font-size:11px;color:var(--mut);line-height:1.6}
`
