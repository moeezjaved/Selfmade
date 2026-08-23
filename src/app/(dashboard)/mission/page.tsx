'use client'
/**
 * /mission — the founder's marketing company, as a broadsheet.
 *
 * Layout grammar (learned from what users already use): a print surface, not an app. White paper, black
 * ink, hairline columns, a word + hard rule per section. Two voices only — Fraunces for everything human,
 * monospace for everything the MACHINE says (buttons, credit tags, timestamps, the live log strip). Orange
 * is a highlighter (live dots, the run button, links), never a background — the orange world stays on the
 * landing page.
 *
 * The centre column (Next moves) is fully wired: the Strategist plan → the agent router (/api/mello/agents)
 * → confirm card (who runs it + honest cost) → the existing /api/mello/tasks/run spine. The side columns
 * (Meta / Rivals / Connect) are honest shells for now — state-correct, never fabricated numbers — wired in
 * a follow-up. Additive: only this page + the strategist plan shape changed.
 */
import { useCallback, useEffect, useState } from 'react'

type Task = { title: string; lever: string; dept: string; why: string; steps: string[]; hypothesis: string; impact: string; runnable: boolean; needs?: 'meta' | 'shopify' | 'klaviyo' | null; suggested_key: string }
const CONNECT: Record<string, { label: string; href: string }> = {
  meta: { label: 'Connect Meta to launch →', href: '/connect/meta' },
  shopify: { label: 'Connect Shopify to fix this →', href: '/settings' },   // real /connect/shopify flow pending
  klaviyo: { label: 'Connect Klaviyo to send →', href: '/settings' },
}
type Signals = { competitors: number; ownAdsFound: boolean; winnerCount: number; metaConnected: boolean }
type MetaPanel = { connected: boolean; spend?: number | null; currency?: string; roas?: number | null; ctr?: number | null; cvr?: number | null; aov?: number | null; frequency?: number | null; activeCreatives?: number | null; biggestLever?: string | null }
type Plan = { stage: string; headline: string; tasks: Task[]; grounding?: string[]; notice?: string; brand?: string; signals?: Signals; meta?: MetaPanel }

const curSym = (c?: string) => (({ USD: '$', EUR: '€', GBP: '£' } as Record<string, string>)[c || 'USD']) || ''
const money = (n?: number | null, c?: string) => (n == null ? '—' : `${curSym(c)}${Math.round(n).toLocaleString()}`)
const pct = (f?: number | null) => (f == null ? '—' : `${(f * 100).toFixed(2)}%`)
const xx = (n?: number | null) => (n == null ? '—' : `${n.toFixed(1)}×`)

// The agent router's answer for one task: who runs it, how, and what it costs — confirm-before-run.
type AgentInfo = { key: string; name: string; emoji: string; role: string }
type Resolution =
  | { action: 'run'; agent: AgentInfo; suggestion: any; cost: string; note: string }
  | { action: 'run_existing'; agent: AgentInfo; taskId: string; title: string; cost: string; note: string }
  | { action: 'connect'; agent: AgentInfo | null; needs: 'meta' | 'shopify' | 'klaviyo'; note: string }
  | { action: 'brief'; agent: AgentInfo | null; note: string }
type RunState =
  | { phase: 'idle' } | { phase: 'resolving' } | { phase: 'confirm'; res: Resolution }
  | { phase: 'note'; text: string } | { phase: 'running'; agent?: AgentInfo }
  | { phase: 'done'; url?: string | null; agent?: AgentInfo } | { phase: 'error'; text: string }

const STAGE_LABEL: Record<string, string> = { setup: 'Setup', 'first-cycle': 'First cycle', running: 'Running', scaling: 'Scaling' }
const STAGE_CAP: Record<string, string> = { setup: 'Getting your company off the ground.', 'first-cycle': 'First ads exist — one clear win next.', running: 'Ads are live & spending.', scaling: 'Compounding what already works.' }

export default function MissionPage() {
  const [plan, setPlan] = useState<Plan | null>(null)
  const [loading, setLoading] = useState(true)
  const [step, setStep] = useState(0)
  const [open, setOpen] = useState<string | null>(null)
  const [runs, setRuns] = useState<Record<string, RunState>>({})
  const setRun = (key: string, s: RunState) => setRuns((r) => ({ ...r, [key]: s }))

  // Live desk panels (DB-only, fast) — load independently of the LLM plan so they populate immediately.
  type OwnAd = { adId: string; title: string | null; days: number | null; thumb: string; isVideo: boolean }
  type Rival = { name: string; pageId: string; newAds: number; thumbs: string[] }
  type Gen = { id: string; url: string; isVideo: boolean; at: string }
  type Desk = { ownAds: OwnAd[]; rivals: Rival[]; generations: Gen[]; ownIndexed: boolean }
  const [desk, setDesk] = useState<Desk | null>(null)
  const fetchDesk = useCallback(async () => {
    try { const r = await fetch('/api/mello/desk'); const j = await r.json(); if (r.ok) setDesk(j as Desk) } catch { /* panels degrade to empty states */ }
  }, [])
  useEffect(() => { fetchDesk() }, [fetchDesk])

  // "Your ads" = the SAME per-ad view /reports shows (Meta level=ad: spend/CTR/ROAS + creative thumbnail).
  // Reuse that data path so the mission desk matches how we already display ads.
  type AdRow = { name?: string; spend?: number; ctr?: number; roas?: number; conversions?: number; thumbnail_url?: string; preview_url?: string }
  const [ownReports, setOwnReports] = useState<AdRow[] | null>(null)   // null = loading; [] = none/not connected
  useEffect(() => {
    (async () => {
      try { const r = await fetch('/api/reports?dateRange=last_30d'); const j = await r.json(); setOwnReports(Array.isArray(j?.creatives) ? j.creatives : []) }
      catch { setOwnReports([]) }
    })()
  }, [])

  // The standup board — the founder's tasks by status (running/done/failed from mello_tasks; to-do = the plan).
  type BoardRow = { id: string; title: string; why: string | null; kind: string; status: string; url: string | null; error: string | null; at: string }
  type Board = { running: BoardRow[]; done: BoardRow[]; failed: BoardRow[] }
  const [boardOpen, setBoardOpen] = useState(false)
  const [board, setBoard] = useState<Board | null>(null)
  const [boardTab, setBoardTab] = useState<'todo' | 'running' | 'done' | 'failed'>('todo')
  const [boardLoading, setBoardLoading] = useState(false)
  const openBoard = async () => {
    setBoardOpen(true); setBoardTab('todo')
    if (board) return
    setBoardLoading(true)
    try { const r = await fetch('/api/mello/tasks/board'); const j = await r.json(); if (r.ok) setBoard(j as Board) } catch { /* keep to-do usable even if the fetch fails */ }
    setBoardLoading(false)
  }

  const STEPS = ['Reviewing your funnel + backlog…', 'Benchmarking against your competitors…', 'Diagnosing your biggest constraint…', 'Drafting your highest-impact moves…']

  const fetchPlan = useCallback(async () => {
    setLoading(true); setStep(0); setRuns({})
    const iv = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 1600)
    try {
      // limit:3 — the desk shows the 3 highest-impact moves (Polsia-style), so the engine drafts exactly 3;
      // nothing Mello reasoned about is generated-then-hidden. Regenerate ("+ New moves") for a fresh set.
      const r = await fetch('/api/mello/strategist', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ persist: false, limit: 3 }) })
      const j = await r.json()
      if (r.ok && Array.isArray(j?.tasks)) setPlan(j as Plan)
      else setPlan({ stage: 'setup', headline: j?.error ? 'Mello couldn’t reach your data just now — try again.' : 'No plan yet.', tasks: [] })
    } catch { setPlan({ stage: 'setup', headline: 'Something went wrong reaching Mello. Try again.', tasks: [] }) }
    clearInterval(iv); setLoading(false)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { fetchPlan() }, [fetchPlan])

  // Approve & run → ask the agent router WHO runs it and what it costs (read-only), then confirm.
  const resolveTask = async (t: Task) => {
    setRun(t.suggested_key, { phase: 'resolving' })
    try {
      const r = await fetch('/api/mello/agents', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ task: t }) })
      const j = await r.json()
      const res: Resolution | undefined = j?.resolution
      if (!r.ok || !res) throw new Error(j?.error || 'router failed')
      if (res.action === 'run' || res.action === 'run_existing') setRun(t.suggested_key, { phase: 'confirm', res })
      else { setRun(t.suggested_key, { phase: 'note', text: res.note }); if (res.action === 'brief') setOpen(t.suggested_key) }
    } catch { setRun(t.suggested_key, { phase: 'error', text: 'Couldn’t reach the agent router — try again.' }) }
  }
  // The founder's second yes → the EXISTING run spine (credits, dedupe, approvals all live there).
  const confirmRun = async (t: Task, res: Resolution) => {
    if (res.action !== 'run' && res.action !== 'run_existing') return
    setRun(t.suggested_key, { phase: 'running', agent: res.agent })
    try {
      const body = res.action === 'run' ? { suggestion: res.suggestion } : { id: res.taskId }
      const r = await fetch('/api/mello/tasks/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json(); const task = j?.task
      if (!r.ok || !task) throw new Error(j?.error || 'run failed')
      if (task.status === 'done') setRun(t.suggested_key, { phase: 'done', url: task?.result?.url || null, agent: res.agent })
      else if (task.status === 'failed') setRun(t.suggested_key, { phase: 'error', text: task?.error || 'The run failed — nothing was charged twice; try again.' })
      else setRun(t.suggested_key, { phase: 'running', agent: res.agent })
    } catch (e: any) { setRun(t.suggested_key, { phase: 'error', text: String(e?.message || 'The run failed.') }) }
  }

  const sig = plan?.signals
  const brand = plan?.brand || 'Your company'
  // Honest live-log lines derived from the real plan (never fabricated).
  const termLines: string[] = []
  if (loading) termLines.push('Task started: Diagnosing your funnel — spend, CTR, CVR, AOV, frequency')
  else {
    if (sig?.ownAdsFound) termLines.push('Research: read your live ads to ground the diagnosis')
    if (sig && sig.winnerCount > 0) termLines.push(`Research: benchmarked ${sig.winnerCount} competitor winner${sig.winnerCount === 1 ? '' : 's'}`)
    if (plan?.notice) termLines.push(plan.notice)
    if (plan && plan.tasks.length) termLines.push(`Strategist: drafted ${plan.tasks.length} high-impact move${plan.tasks.length === 1 ? '' : 's'}`)
  }
  while (termLines.length < 2) termLines.push('Standing by — approve a move and the team gets to work')

  return (
    <div className="ms">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      {/* the company, working */}
      <div className="ms-term">
        {termLines.slice(0, 3).map((l, i) => (
          <div className="ms-ln" key={i}><span className="t">{i === 0 && loading ? '▸' : '›'}</span> {l}</div>
        ))}
      </div>

      {/* masthead */}
      <div className="ms-mast">
        <h1>{brand}</h1>
        <span className="brandline">Selfmade · your marketing company</span>
        <span className="sp" />
        <button className="ms-btn solid" onClick={fetchPlan} disabled={loading}>{loading ? 'Thinking…' : '+ New moves'}</button>
      </div>

      <div className="ms-sheet">
        {/* COL 1 — the company */}
        <div className="ms-col">
          <h2 className="ms-sec">Selfmade</h2>
          <div className="ms-mood">
            <div className="face">{loading ? '· · ·' : '\\ ˙◡˙ /'}</div>
            <div className="stage">{STAGE_LABEL[plan?.stage || 'setup'] || plan?.stage}</div>
            <div className="cap">{STAGE_CAP[plan?.stage || 'setup'] || ''}</div>
          </div>

          {plan && !loading && plan.headline && (
            <div className="ms-diag">“{plan.headline}”</div>
          )}

          {(() => {
            const rep = (ownReports || []).filter((c) => c.thumbnail_url || c.spend != null).slice(0, 4)
            const ads = desk?.ownAds || []
            const m = plan?.meta
            const liveN = m?.connected ? (m.activeCreatives ?? rep.length) : ads.length
            const sub = m?.connected && m.spend != null ? `${money(m.spend, m.currency)} spend · ${xx(m.roas)} ROAS` : null
            const roasClass = (r?: number) => (r == null ? '' : r >= 2 ? 'good' : r >= 1 ? 'mid' : 'bad')
            return (
              <div className="ms-yours">
                <h2 className="ms-sec sec2">Your ads {m?.connected && <small>last 30 days</small>}</h2>
                {liveN > 0 && (
                  <div className="ms-figure">
                    <span className="big">{liveN}</span>
                    <span className="lbl">{m?.connected ? 'live creative' + (liveN === 1 ? '' : 's') : 'ad' + (liveN === 1 ? '' : 's') + ' in library'}</span>
                    {sub && <span className="sub">{sub}</span>}
                  </div>
                )}
                {rep.length > 0 ? (
                  // the /reports per-ad row: thumbnail + spend·CTR + ROAS pill — real Meta ad-level numbers
                  <div className="ms-adrows">
                    {rep.map((c, i) => (
                      <a className="ms-adrow" key={i} href={c.preview_url || '#'} target={c.preview_url ? '_blank' : undefined} rel="noopener noreferrer">
                        <div className="th">{c.thumbnail_url ? <img src={c.thumbnail_url} alt="" loading="lazy" /> : <span>🎨</span>}</div>
                        <div className="mid">
                          <div className="nm">{c.name || 'Ad'}</div>
                          <div className="mt">{money(c.spend, m?.currency)} · CTR {c.ctr != null ? c.ctr.toFixed(1) : '—'}%</div>
                        </div>
                        <span className={`roas ${roasClass(c.roas)}`}>{c.roas != null ? `${c.roas.toFixed(1)}×` : '—'}</span>
                      </a>
                    ))}
                  </div>
                ) : ads.length > 0 ? (
                  // fallback before Meta ad-level lands: the crawled creatives filmstrip
                  <div className="ms-strip">
                    {ads.map((a) => (
                      <div className="ms-shot" key={a.adId} title={a.title || ''}>
                        <img src={a.thumb} alt="" loading="lazy" />
                        {a.isVideo && <span className="pv">▶</span>}
                        {a.days != null && a.days > 0 && <span className="dd">{a.days}d</span>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="ms-note sm">{ownReports === null || desk === null ? 'Loading your ads…' : sig?.metaConnected ? 'No ad-level data yet — your live creatives appear here once they spend.' : 'Your live ads appear here once Meta is connected.'}</div>
                )}
                {!sig?.metaConnected && <a href="/connect/meta" className="ms-btn flame full">Connect Meta →</a>}
              </div>
            )
          })()}

          <div className="ms-hire">
            <div className="k">Works while you sleep</div>
            <h3>Your AI marketing company</h3>
            <a href="/settings" className="ms-btn solid full">See plans</a>
            <div className="fine">FROM $49/MO · CANCEL ANYTIME</div>
          </div>
        </div>

        {/* COL 2 — next moves + documents */}
        <div className="ms-col">
          <h2 className="ms-sec">Next moves <small>drafted by Mello</small></h2>

          {loading && (
            <div className="ms-loading">
              {STEPS.map((s, i) => (
                <div key={i} className="ms-lstep" style={{ opacity: i <= step ? 1 : .35, color: i < step ? 'var(--live)' : i === step ? 'var(--ink)' : 'var(--mut)' }}>
                  <span>{i < step ? '✓' : i === step ? '▸' : '·'}</span> {s}
                </div>
              ))}
            </div>
          )}

          {!loading && plan && plan.tasks.slice(0, 3).map((t, i) => {
            const isOpen = open === t.suggested_key
            const connect = t.needs ? CONNECT[t.needs] : null
            const run = runs[t.suggested_key] || { phase: 'idle' as const }
            const dept = `${t.lever}${t.dept ? ` · ${t.dept}` : ''}`
            return (
              <div className={`ms-task${run.phase === 'confirm' ? ' confirm' : ''}`} key={t.suggested_key || i}>
                <h4>{t.title}</h4>
                <p>{t.why}</p>

                {isOpen && (t.steps.length > 0 || t.hypothesis) && (
                  <div className="ms-brief">
                    {t.steps.length > 0 && <>
                      <div className="k">THE BRIEF</div>
                      <ol>{t.steps.map((s, j) => <li key={j}>{s}</li>)}</ol>
                    </>}
                    {t.hypothesis && <div className="bet"><b>Bet:</b> {t.hypothesis}</div>}
                  </div>
                )}

                <div className="foot">
                  <span className={`chip${t.runnable && !t.needs ? ' dot' : ''}`}>{dept}</span>
                  <span className={`cost${t.impact.includes('$') ? ' good' : ''}`}>{connect ? 'Needs ' + t.needs : t.impact}</span>
                </div>

                {/* the run lifecycle */}
                {run.phase === 'confirm' ? (() => {
                  const res = run.res as Extract<Resolution, { action: 'run' | 'run_existing' }>
                  return (
                    <div className="ms-confirm">
                      <div className="line"><b>{res.agent.emoji} {res.agent.name}</b> — {res.note} <span className="c">({res.cost})</span></div>
                      <div className="acts">
                        <button className="ms-btn flame" onClick={() => confirmRun(t, res)}>Yes, run it →</button>
                        <button className="ms-btn" onClick={() => setRun(t.suggested_key, { phase: 'idle' })}>Not now</button>
                      </div>
                    </div>
                  )
                })() : run.phase === 'running' ? (
                  <div className="ms-runline run">▸ {run.agent ? `${run.agent.emoji} ${run.agent.name} is on it…` : 'Running…'}</div>
                ) : run.phase === 'done' ? (
                  <div className="ms-runline done">✓ Done{run.agent ? ` — ${run.agent.name}` : ''} {run.url && <a href={run.url}>See the result →</a>}</div>
                ) : run.phase === 'error' ? (
                  <div className="ms-runline err">{run.text} <button className="ms-btn tiny" onClick={() => setRun(t.suggested_key, { phase: 'idle' })}>Try again</button></div>
                ) : (
                  <div className="ms-acts">
                    {run.phase === 'note' && <div className="ms-runline muted">{run.text}</div>}
                    <div className="ms-actrow">
                      {connect
                        ? <a href={connect.href} className="ms-btn flame">{connect.label}</a>
                        : t.runnable && run.phase !== 'note'
                          ? <button className="ms-btn flame" disabled={(run.phase as string) === 'resolving'} onClick={() => resolveTask(t)}>{(run.phase as string) === 'resolving' ? 'Checking…' : 'Approve & run →'}</button>
                          : <button className="ms-btn flame" onClick={() => setOpen(t.suggested_key)}>Get the brief →</button>}
                      <button className="ms-btn" onClick={() => setOpen(isOpen ? null : t.suggested_key)}>{isOpen ? 'Hide' : 'Brief'}</button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}

          {!loading && plan && plan.tasks.length === 0 && (
            <div className="ms-empty">No moves yet. Tap <b>+ New moves</b> and Mello drafts your highest-impact next steps.</div>
          )}

          {!loading && plan && (
            <div className="ms-taskbtns">
              <a href="/brief" className="ms-btn solid">+ Add to backlog</a>
              <button className="ms-btn" onClick={openBoard}>▦ Sprint board</button>
            </div>
          )}

          <h2 className="ms-sec sec2">From the studio <small>made by Mello</small></h2>
          {desk && desk.generations.length > 0 ? (
            <a href="/studio" className="ms-gens" title="Open the studio">
              {desk.generations.map((g) => (
                <div className="ms-gen" key={g.id}>
                  {g.isVideo ? <video src={g.url} muted preload="metadata" playsInline /> : <img src={g.url} alt="" loading="lazy" />}
                  {g.isVideo && <span className="pv">▶</span>}
                </div>
              ))}
            </a>
          ) : (
            <div className="ms-empty small">{desk === null ? 'Loading…' : 'Images & videos Mello makes for you land here — approve a creative move to fill it.'}</div>
          )}

          <h2 className="ms-sec sec2">Documents</h2>
          <div className="ms-empty small">Reports Mello writes — competitor teardowns, weekly narratives — land here.</div>
        </div>

        {/* COL 3 — channels & signals (honest shells) */}
        <div className="ms-col">
          <h2 className="ms-sec">Meta <small>{plan?.meta?.connected ? 'last 30 days' : ''}</small></h2>
          {plan?.meta?.connected ? (() => {
            const m = plan.meta!
            return <>
              <div className="ms-krow"><span className="k">Ad account</span><span className="v ok">● CONNECTED</span></div>
              <div className="ms-krow"><span className="k">Spend</span><span className="v">{money(m.spend, m.currency)}</span></div>
              <div className="ms-krow"><span className="k">ROAS</span><span className="v">{xx(m.roas)}</span></div>
              <div className="ms-krow"><span className="k">CTR</span><span className="v">{pct(m.ctr)}</span></div>
              <div className="ms-krow"><span className="k">CVR</span><span className={`v${m.cvr != null && m.cvr < 0.01 ? ' bad' : ''}`}>{pct(m.cvr)}</span></div>
              <div className="ms-krow"><span className="k">AOV</span><span className="v">{money(m.aov, m.currency)}</span></div>
              <div className="ms-krow"><span className="k">Frequency</span><span className="v">{m.frequency == null ? '—' : m.frequency.toFixed(1)}</span></div>
              <div className="ms-krow"><span className="k">Live creatives</span><span className="v">{m.activeCreatives ?? '—'}</span></div>
              {m.biggestLever && <div className="ms-note sm" style={{ marginTop: 10 }}><b>Biggest lever:</b> {m.biggestLever}</div>}
            </>
          })() : <>
            <div className="ms-conn">Ad account <span className="st"><a href="/connect/meta" className="ms-btn flame tiny">Connect</a></span></div>
            <div className="ms-note sm">Connect Meta and your live read — spend, ROAS, CTR, CVR, AOV — grounds every move.</div>
          </>}

          <h2 className="ms-sec sec2">Rivals <small>brand spy</small></h2>
          {desk && desk.rivals.length > 0 ? desk.rivals.map((r) => (
            <div className="ms-rival" key={r.pageId}>
              <div className="ms-rival-top">
                <span className="nm">{r.name}</span>
                <span className={`sig${r.newAds > 0 ? ' hot' : ''}`}>{r.newAds > 0 ? `${r.newAds} new · 72h` : 'quiet'}</span>
              </div>
              {r.thumbs.length > 0 && (
                <div className="ms-rival-shots">
                  {r.thumbs.map((t, j) => <div className="rs" key={j}><img src={t} alt="" loading="lazy" /></div>)}
                </div>
              )}
            </div>
          )) : (
            <div className="ms-note sm">{desk === null ? 'Loading your rivals…' : 'Spy a competitor in Brand Spy and their moves appear here.'}</div>
          )}

          <h2 className="ms-sec sec2">Customer <small>live</small></h2>
          <div className="ms-conn">💬 Support replies <span className="st"><a href="/inbox" className="ms-btn tiny">Inbox</a></span></div>
          <div className="ms-conn">📣 Cold outreach &amp; win-backs <span className="st"><a href="/inbox" className="ms-btn tiny">Inbox</a></span></div>
          <div className="ms-note sm">Mello drafts every reply and follow-up — you approve before anything sends. Email &amp; SMS unlock with Klaviyo below.</div>

          <h2 className="ms-sec sec2">Connect</h2>
          <div className="ms-conn">🛍️ Shopify <span className="st"><a href="/settings" className="ms-btn tiny">Connect</a></span></div>
          <div className="ms-conn">✉️ Klaviyo <span className="st"><a href="/settings" className="ms-btn tiny">Connect</a></span></div>
          <div className="ms-conn">📈 Meta <span className="st">{sig?.metaConnected ? <span className="on">● CONNECTED</span> : <a href="/connect/meta" className="ms-btn tiny">Connect</a>}</span></div>
        </div>

        {/* COL 4 — Mello rail */}
        <div className="ms-rail">
          <div className="stamp">Today</div>
          <div className="ms-mello">
            <h5>Here’s where {brand} stands</h5>
            <ul>
              <li><b>Market mapped</b> — {sig?.competitors ? `${sig.competitors} rival${sig.competitors === 1 ? '' : 's'} watched, their winning DNA extracted.` : 'add competitors in Brand Spy so I can benchmark you.'}</li>
              <li><b>Your ads</b> — {sig?.ownAdsFound ? 'read and grounding the diagnosis.' : 'not indexed yet — I’m pulling them in.'}</li>
              <li><b>The read</b> — {plan && !loading ? plan.headline : 'diagnosing your biggest constraint…'}</li>
            </ul>
            <div className="cta">Approve the moves on the left — I’ll take it from there.</div>
          </div>
          <a href="/brief" className="ms-btn open">Open Mello →</a>
          <div className="ms-approve">Approve mode · nothing runs or spends without your yes.</div>
        </div>
      </div>

      {/* the standup — tasks by status */}
      {boardOpen && (() => {
        const todo = plan?.tasks || []
        const rows: BoardRow[] = boardTab === 'todo'
          ? todo.map((t) => ({ id: t.suggested_key, title: t.title, why: t.why, kind: t.dept, status: 'todo', url: null, error: null, at: '' }))
          : (board?.[boardTab] || [])
        const TABS: [typeof boardTab, string, number][] = [
          ['todo', 'Backlog', todo.length],
          ['running', 'Running', board?.running.length ?? 0],
          ['done', 'Done', board?.done.length ?? 0],
          ['failed', 'Failed', board?.failed.length ?? 0],
        ]
        return (
          <div className="ms-modal-wrap" onClick={() => setBoardOpen(false)}>
            <div className="ms-modal" onClick={(e) => e.stopPropagation()}>
              <div className="ms-modal-top">
                <h3>Sprint board</h3>
                <button className="ms-x" onClick={() => setBoardOpen(false)}>✕</button>
              </div>
              <div className="ms-tabs">
                {TABS.map(([k, label, n]) => (
                  <button key={k} className={`ms-tab${boardTab === k ? ' on' : ''}`} onClick={() => setBoardTab(k)}>
                    {label}{n > 0 ? ` · ${n}` : ''}
                  </button>
                ))}
              </div>
              <div className="ms-modal-body">
                {boardLoading && boardTab !== 'todo' && <div className="ms-empty small">Loading the board…</div>}
                {!boardLoading && rows.length === 0 && (
                  <div className="ms-empty small">
                    {boardTab === 'todo' ? 'No moves on the desk — tap + New moves.'
                      : boardTab === 'running' ? 'Nothing running right now.'
                      : boardTab === 'done' ? 'Nothing shipped yet — approve a move to fill this.'
                      : 'Nothing failed — clean board.'}
                  </div>
                )}
                {rows.map((r) => (
                  <div className="ms-brow" key={r.id}>
                    <div className="ms-brow-head">
                      <span className={`chip${r.status === 'running' ? ' run' : r.status === 'done' ? ' done' : r.status === 'failed' ? ' fail' : ''}`}>{r.kind}</span>
                      <span className="ms-brow-title">{r.title}</span>
                    </div>
                    {r.why && <div className="ms-brow-why">{r.why}</div>}
                    {r.status === 'done' && r.url && <a href={r.url} className="ms-brow-link">See the result →</a>}
                    {r.status === 'failed' && r.error && <div className="ms-brow-err">{r.error}</div>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

const CSS = `
.ms{--paper:#ffffff;--ink:#141414;--ink2:#333;--sub:#6b6b6b;--mut:#9a9a9a;--hair:#e7e5e0;--rule:#141414;--panel:#f7f6f3;--panel-b:#ded;--flame:#ef4a1e;--live:#1f8a53;
  --serif:'Fraunces',Georgia,serif;--ui:'Inter',system-ui,sans-serif;--mono:ui-monospace,'SF Mono',Menlo,monospace;
  background:var(--paper);color:var(--ink);min-height:100%;font-family:var(--ui);font-size:14px}
.ms a{color:var(--flame);text-decoration:none}
.ms-term{background:#0d0d0c;color:#c9c4b8;font-family:var(--mono);font-size:12px;line-height:1.7;padding:11px clamp(16px,3vw,26px)}
.ms-ln{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ms-ln .t{color:#6f6a5f;margin-right:6px}
.ms-mast{display:flex;align-items:baseline;gap:16px;flex-wrap:wrap;padding:18px clamp(16px,3vw,26px) 12px;border-bottom:1px solid var(--rule)}
.ms-mast h1{font-family:var(--serif);font-weight:500;font-size:clamp(24px,3vw,30px);letter-spacing:-.02em;margin:0}
.ms-mast .brandline{font-family:var(--mono);font-size:11px;letter-spacing:.08em;color:var(--sub);text-transform:uppercase}
.ms-mast .sp{flex:1}
.ms-btn{font-family:var(--mono);font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;background:var(--paper);color:var(--ink);border:1px solid var(--ink);padding:8px 13px;cursor:pointer;display:inline-block;text-align:center}
.ms-btn:hover{background:var(--ink);color:var(--paper)}
.ms-btn:disabled{opacity:.5;cursor:default}
.ms-btn.solid{background:var(--ink);color:var(--paper)}
.ms-btn.solid:hover{background:var(--flame);border-color:var(--flame)}
.ms-btn.flame{border-color:var(--flame);color:var(--flame)}
.ms-btn.flame:hover{background:var(--flame);color:#fff}
.ms-btn.full{width:100%;margin-top:10px}
.ms-btn.tiny{padding:5px 9px;font-size:10px}
.ms-btn.open{margin:14px 0 0}
.ms-sheet{display:grid;grid-template-columns:240px 1.3fr 1fr 280px}
.ms-col{padding:18px clamp(14px,1.6vw,22px);border-right:1px solid var(--hair);min-width:0}
.ms-sec{font-family:var(--serif);font-weight:600;font-size:18px;letter-spacing:-.01em;padding-bottom:7px;border-bottom:1px solid var(--rule);margin:0 0 13px}
.ms-sec.sec2{margin-top:28px}
.ms-sec small{font-family:var(--mono);font-weight:400;font-size:10px;letter-spacing:.07em;color:var(--mut);text-transform:uppercase;margin-left:7px}
.ms-mood{border:1px solid var(--ink);padding:15px 13px;text-align:center;margin-bottom:6px}
.ms-mood .face{font-family:var(--mono);font-size:14px;letter-spacing:.18em;margin-bottom:7px}
.ms-mood .stage{font-family:var(--serif);font-weight:600;font-size:20px;letter-spacing:-.01em}
.ms-mood .cap{font-size:12px;color:var(--sub);margin-top:2px}
.ms-diag{font-family:var(--serif);font-style:italic;font-size:16px;line-height:1.45;color:var(--ink2);margin:18px 0 0}
.ms-signals{margin-top:18px;border-top:1px solid var(--hair);padding-top:14px}
.ms-note{font-size:12.5px;color:var(--sub);line-height:1.5}
.ms-note.sm{font-size:12px;margin-top:2px}
.ms-note b{color:var(--ink);font-weight:600}
.ms-yours{margin-top:6px}
.ms-figure{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin-bottom:11px}
.ms-figure .big{font-family:var(--serif);font-weight:600;font-size:32px;letter-spacing:-.02em;line-height:1}
.ms-figure .lbl{font-family:var(--mono);font-size:10.5px;letter-spacing:.05em;text-transform:uppercase;color:var(--sub)}
.ms-figure .sub{flex-basis:100%;font-family:var(--mono);font-size:11px;color:var(--sub);letter-spacing:.02em;margin-top:2px}
.ms-adrows{display:flex;flex-direction:column;gap:2px}
.ms-adrow{display:flex;align-items:center;gap:9px;padding:7px 0;border-bottom:1px solid var(--hair);text-decoration:none}
.ms-adrow .th{width:38px;height:38px;flex:none;background:var(--panel);border:1px solid #e2ded4;overflow:hidden;display:flex;align-items:center;justify-content:center;font-size:15px}
.ms-adrow .th img{width:100%;height:100%;object-fit:cover;display:block}
.ms-adrow .mid{flex:1;min-width:0}
.ms-adrow .mid .nm{font-size:12.5px;font-weight:500;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ms-adrow .mid .mt{font-family:var(--mono);font-size:10px;color:var(--sub);letter-spacing:.02em;margin-top:2px}
.ms-adrow .roas{font-family:var(--mono);font-size:12px;font-weight:700;flex:none;color:var(--sub)}
.ms-adrow .roas.good{color:var(--live)}
.ms-adrow .roas.mid{color:var(--ink)}
.ms-adrow .roas.bad{color:var(--flame)}
.ms-strip{display:grid;grid-template-columns:repeat(4,1fr);gap:5px}
.ms-shot{position:relative;aspect-ratio:4/5;background:var(--panel);border:1px solid #e2ded4;overflow:hidden}
.ms-shot img{width:100%;height:100%;object-fit:cover;display:block}
.ms-shot .pv{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;font-size:13px;text-shadow:0 1px 4px rgba(0,0,0,.6)}
.ms-shot .dd{position:absolute;bottom:0;left:0;right:0;font-family:var(--mono);font-size:8.5px;font-weight:600;color:#fff;background:rgba(20,18,15,.6);padding:1px 3px;text-align:right;letter-spacing:.03em}
.ms-gens{display:grid;grid-template-columns:repeat(4,1fr);gap:5px;text-decoration:none}
.ms-gen{position:relative;aspect-ratio:1;background:var(--panel);border:1px solid #e2ded4;overflow:hidden}
.ms-gen img,.ms-gen video{width:100%;height:100%;object-fit:cover;display:block}
.ms-gen .pv{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;font-size:13px;text-shadow:0 1px 4px rgba(0,0,0,.6)}
.ms-rival{padding:9px 0;border-bottom:1px solid var(--hair)}
.ms-rival-top{display:flex;align-items:center;gap:10px}
.ms-rival-top .nm{font-weight:500;font-size:13.5px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ms-rival-top .sig{font-family:var(--mono);font-size:10px;color:var(--sub);letter-spacing:.03em;flex:none}
.ms-rival-top .sig.hot{color:var(--flame);font-weight:700}
.ms-rival-shots{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;margin-top:6px;max-width:172px}
.ms-rival-shots .rs{aspect-ratio:4/5;background:var(--panel);border:1px solid #e2ded4;overflow:hidden}
.ms-rival-shots .rs img{width:100%;height:100%;object-fit:cover;display:block}
.ms-hire{border:1px solid var(--ink);padding:18px 15px;text-align:center;margin-top:24px}
.ms-hire .k{font-family:var(--mono);font-size:10px;letter-spacing:.13em;color:var(--sub);text-transform:uppercase}
.ms-hire h3{font-family:var(--serif);font-weight:500;font-size:21px;line-height:1.15;letter-spacing:-.02em;margin:4px 0 0}
.ms-hire .fine{font-family:var(--mono);font-size:9.5px;color:var(--mut);margin-top:8px;letter-spacing:.04em}
.ms-loading{display:flex;flex-direction:column;gap:2px}
.ms-lstep{display:flex;gap:9px;padding:6px 0;font-family:var(--mono);font-size:12.5px;transition:opacity .3s}
.ms-task{background:var(--panel);border:1px solid #e2ded4;padding:11px 13px;margin-bottom:8px}
.ms-task.confirm{border-color:var(--ink)}
.ms-task h4{font-family:var(--serif);font-weight:600;font-size:15px;letter-spacing:-.01em;line-height:1.22;margin:0 0 4px}
.ms-task p{margin:0 0 9px;font-size:12.5px;color:var(--sub);line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.ms-task .foot{display:flex;align-items:center;gap:8px;margin-bottom:9px}
.ms-task .chip{font-family:var(--mono);font-size:9.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;border:1px solid #ded9cd;background:var(--paper);padding:3px 8px;color:var(--ink2)}
.ms-task .chip.dot::before{content:'';display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--flame);margin-right:6px;vertical-align:1px}
.ms-task .cost{margin-left:auto;font-family:var(--mono);font-size:10px;font-weight:600;letter-spacing:.04em;color:var(--sub);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:52%;text-align:right}
.ms-task .cost.good{color:var(--live)}
.ms-brief{background:var(--paper);border:1px solid #e2ded4;padding:12px 14px;margin-bottom:12px}
.ms-brief .k{font-family:var(--mono);font-size:10px;letter-spacing:.06em;color:var(--mut);margin-bottom:7px}
.ms-brief ol{margin:0;padding-left:17px;font-size:13px;line-height:1.55}
.ms-brief li{margin-bottom:4px}
.ms-brief .bet{font-size:12.5px;color:var(--sub);margin-top:9px;font-style:italic}
.ms-brief .bet b{color:var(--ink);font-style:normal}
.ms-confirm .acts{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.ms-acts{display:flex;flex-direction:column;gap:6px}
.ms-actrow{display:flex;gap:8px;flex-wrap:wrap}
.ms-actrow .ms-btn{padding:7px 13px;font-size:10.5px}
.ms-confirm{background:var(--paper);border:1px solid var(--ink);padding:12px 13px}
.ms-confirm .line{font-size:13px;color:var(--ink2);line-height:1.5;margin-bottom:10px}
.ms-confirm .line .c{font-family:var(--mono);font-size:11px;color:var(--sub)}
.ms-runline{font-family:var(--mono);font-size:12.5px}
.ms-runline.run{color:var(--flame)}
.ms-runline.done{color:var(--live);display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.ms-runline.err{color:var(--flame);display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.ms-runline.muted{color:var(--sub);font-style:italic;font-family:var(--ui);margin-bottom:8px}
.ms-empty{color:var(--sub);font-size:13.5px;padding:14px 0}
.ms-empty.small{font-size:12.5px;padding:10px 0}
.ms-taskbtns{display:flex;gap:8px;margin:8px 0 2px}
.ms-taskbtns .ms-btn{flex:1;padding:11px 12px;font-size:11px}
.ms-krow{display:flex;justify-content:space-between;align-items:baseline;padding:8px 0;border-bottom:1px solid var(--hair);font-size:13px}
.ms-krow .k{color:var(--sub)}
.ms-krow .v{font-family:var(--mono);font-size:12px;font-weight:600}
.ms-krow .v.ok{color:var(--live)}
.ms-krow .v.bad{color:var(--flame)}
.ms-conn{display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--hair);font-size:13.5px}
.ms-conn .st{margin-left:auto}
.ms-conn .on{font-family:var(--mono);font-size:10.5px;color:var(--live);letter-spacing:.05em}
.ms-rail{background:var(--panel);padding:18px clamp(14px,1.6vw,20px);display:flex;flex-direction:column}
.ms-rail .stamp{font-family:var(--mono);font-size:10px;color:var(--mut);letter-spacing:.14em;text-transform:uppercase;text-align:center;margin-bottom:12px}
.ms-mello{background:var(--paper);border:1px solid #e2ded4;padding:14px 15px;font-size:13px;line-height:1.55}
.ms-mello h5{font-family:var(--serif);font-weight:600;font-size:15.5px;margin:0 0 9px}
.ms-mello ul{margin:0;padding-left:16px;color:var(--ink2)}
.ms-mello li{margin-bottom:7px}
.ms-mello .cta{border-top:1px solid var(--hair);margin-top:11px;padding-top:11px;font-weight:600}
.ms-approve{font-family:var(--mono);font-size:10px;color:var(--mut);letter-spacing:.04em;margin-top:14px}
.ms-modal-wrap{position:fixed;inset:0;background:rgba(20,18,15,.34);display:flex;align-items:flex-start;justify-content:center;padding:6vh 18px;z-index:60}
.ms-modal{background:var(--paper);border:1px solid var(--ink);width:100%;max-width:660px;max-height:82vh;display:flex;flex-direction:column;box-shadow:0 30px 80px -30px rgba(20,18,15,.5)}
.ms-modal-top{display:flex;align-items:center;padding:18px 22px 14px;border-bottom:1px solid var(--rule)}
.ms-modal-top h3{font-family:var(--serif);font-weight:600;font-size:23px;letter-spacing:-.01em;margin:0}
.ms-x{margin-left:auto;background:none;border:none;font-size:16px;color:var(--sub);cursor:pointer;line-height:1;padding:4px}
.ms-x:hover{color:var(--ink)}
.ms-tabs{display:flex;gap:4px;padding:12px 22px 0;border-bottom:1px solid var(--hair);flex-wrap:wrap}
.ms-tab{font-family:var(--mono);font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;background:none;border:none;border-bottom:2px solid transparent;color:var(--mut);padding:7px 8px 10px;cursor:pointer}
.ms-tab:hover{color:var(--ink)}
.ms-tab.on{color:var(--ink);border-bottom-color:var(--flame)}
.ms-modal-body{padding:16px 22px 22px;overflow-y:auto}
.ms-brow{border:1px solid #e2ded4;background:var(--panel);padding:13px 15px;margin-bottom:10px}
.ms-brow-head{display:flex;align-items:baseline;gap:10px}
.ms-brow-head .chip{font-family:var(--mono);font-size:9.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;border:1px solid #ded9cd;background:var(--paper);padding:3px 8px;color:var(--ink2);flex:none}
.ms-brow-head .chip.run{color:var(--flame);border-color:var(--flame)}
.ms-brow-head .chip.done{color:var(--live);border-color:var(--live)}
.ms-brow-head .chip.fail{color:var(--flame)}
.ms-brow-title{font-family:var(--serif);font-weight:600;font-size:15.5px;letter-spacing:-.01em;line-height:1.25}
.ms-brow-why{font-size:12.5px;color:var(--sub);line-height:1.5;margin-top:6px}
.ms-brow-link{display:inline-block;font-family:var(--mono);font-size:11px;font-weight:700;margin-top:8px}
.ms-brow-err{font-size:12px;color:var(--flame);margin-top:6px}
@media(max-width:1120px){.ms-sheet{grid-template-columns:1fr 1fr}.ms-col:nth-child(2){border-right:none}.ms-rail{grid-column:1/-1;border-top:1px solid var(--hair)}}
@media(max-width:720px){.ms-sheet{grid-template-columns:1fr}.ms-col{border-right:none;border-bottom:1px solid var(--hair)}}
`
