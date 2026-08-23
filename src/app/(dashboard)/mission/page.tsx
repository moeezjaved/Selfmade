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
type Plan = { stage: string; headline: string; tasks: Task[]; grounding?: string[]; notice?: string; brand?: string; signals?: Signals }

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

          <div className="ms-signals">
            {sig?.metaConnected
              ? <div className="ms-note">Your live Meta read grounds the diagnosis above. The full metric panel — spend, ROAS, CVR, AOV — lands here next.</div>
              : <>
                  <div className="ms-note">Connect Meta and your real numbers ground every move.</div>
                  <a href="/connect/meta" className="ms-btn flame full">Connect Meta →</a>
                </>}
          </div>

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
                    {connect
                      ? <a href={connect.href} className="ms-btn flame">{connect.label}</a>
                      : t.runnable && run.phase !== 'note'
                        ? <button className="ms-btn flame" disabled={(run.phase as string) === 'resolving'} onClick={() => resolveTask(t)}>{(run.phase as string) === 'resolving' ? 'Checking with the team…' : 'Approve & run →'}</button>
                        : <button className="ms-btn flame" onClick={() => setOpen(t.suggested_key)}>Get the brief →</button>}
                    <button className="ms-btn" onClick={() => setOpen(isOpen ? null : t.suggested_key)}>{isOpen ? 'Hide brief' : 'Open brief'}</button>
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
              <a href="/brief" className="ms-btn">+ Ask for a move</a>
              <a href="/brief" className="ms-btn">▦ All moves</a>
            </div>
          )}

          <h2 className="ms-sec sec2">Documents</h2>
          <div className="ms-empty small">Reports Mello writes — competitor teardowns, weekly narratives — land here.</div>
        </div>

        {/* COL 3 — channels & signals (honest shells) */}
        <div className="ms-col">
          <h2 className="ms-sec">Meta</h2>
          {sig?.metaConnected
            ? <div className="ms-krow"><span className="k">Ad account</span><span className="v ok">● CONNECTED</span></div>
            : <div className="ms-conn">Meta <span className="st"><a href="/connect/meta" className="ms-btn flame tiny">Connect</a></span></div>}
          <div className="ms-note sm">Your live account read — spend, CTR, CVR, AOV, frequency — wires up here next.</div>

          <h2 className="ms-sec sec2">Rivals <small>brand spy</small></h2>
          {sig && sig.competitors > 0
            ? <div className="ms-note sm">Watching <b>{sig.competitors}</b> rival{sig.competitors === 1 ? '' : 's'}. Their new-ad moves land in this feed next.</div>
            : <div className="ms-note sm">Spy a competitor and their moves appear here.</div>}

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
.ms-hire{border:1px solid var(--ink);padding:18px 15px;text-align:center;margin-top:24px}
.ms-hire .k{font-family:var(--mono);font-size:10px;letter-spacing:.13em;color:var(--sub);text-transform:uppercase}
.ms-hire h3{font-family:var(--serif);font-weight:500;font-size:21px;line-height:1.15;letter-spacing:-.02em;margin:4px 0 0}
.ms-hire .fine{font-family:var(--mono);font-size:9.5px;color:var(--mut);margin-top:8px;letter-spacing:.04em}
.ms-loading{display:flex;flex-direction:column;gap:2px}
.ms-lstep{display:flex;gap:9px;padding:6px 0;font-family:var(--mono);font-size:12.5px;transition:opacity .3s}
.ms-task{background:var(--panel);border:1px solid #e2ded4;padding:14px 15px;margin-bottom:11px}
.ms-task.confirm{border-color:var(--ink)}
.ms-task h4{font-family:var(--serif);font-weight:600;font-size:16px;letter-spacing:-.01em;line-height:1.25;margin:0 0 6px}
.ms-task p{margin:0 0 11px;font-size:13px;color:var(--sub);line-height:1.5}
.ms-task .foot{display:flex;align-items:center;gap:8px;margin-bottom:12px}
.ms-task .chip{font-family:var(--mono);font-size:9.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;border:1px solid #ded9cd;background:var(--paper);padding:3px 8px;color:var(--ink2)}
.ms-task .chip.dot::before{content:'';display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--flame);margin-right:6px;vertical-align:1px}
.ms-task .cost{margin-left:auto;font-family:var(--mono);font-size:11px;font-weight:700;letter-spacing:.05em;color:var(--ink)}
.ms-task .cost.good{color:var(--live)}
.ms-brief{background:var(--paper);border:1px solid #e2ded4;padding:12px 14px;margin-bottom:12px}
.ms-brief .k{font-family:var(--mono);font-size:10px;letter-spacing:.06em;color:var(--mut);margin-bottom:7px}
.ms-brief ol{margin:0;padding-left:17px;font-size:13px;line-height:1.55}
.ms-brief li{margin-bottom:4px}
.ms-brief .bet{font-size:12.5px;color:var(--sub);margin-top:9px;font-style:italic}
.ms-brief .bet b{color:var(--ink);font-style:normal}
.ms-acts,.ms-confirm .acts{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.ms-acts{flex-direction:column;align-items:stretch}
.ms-acts>div{display:flex;gap:8px;flex-wrap:wrap}
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
.ms-taskbtns{display:flex;gap:8px;margin:4px 0 2px;flex-wrap:wrap}
.ms-krow{display:flex;justify-content:space-between;align-items:baseline;padding:8px 0;border-bottom:1px solid var(--hair);font-size:13px}
.ms-krow .k{color:var(--sub)}
.ms-krow .v{font-family:var(--mono);font-size:12px;font-weight:600}
.ms-krow .v.ok{color:var(--live)}
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
@media(max-width:1120px){.ms-sheet{grid-template-columns:1fr 1fr}.ms-col:nth-child(2){border-right:none}.ms-rail{grid-column:1/-1;border-top:1px solid var(--hair)}}
@media(max-width:720px){.ms-sheet{grid-template-columns:1fr}.ms-col{border-right:none;border-bottom:1px solid var(--hair)}}
`
