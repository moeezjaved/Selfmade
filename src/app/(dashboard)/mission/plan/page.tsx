'use client'
/**
 * /mission/plan — "The road from $X to $Y" — the growth plan waterfall, opened from the mission ladder's
 * "See the plan →". Each lever shows its + revenue and the math in plain words; live levers act, locked
 * ones route to the connection that unlocks them. Read-first: nothing runs or spends from this view without
 * the founder's yes (live actions route to the surface that executes them). Data: POST /api/mello/growth-plan.
 */
import { useCallback, useEffect, useState } from 'react'
import type { GrowthPlan, Lever, MathSeg } from '@/lib/mello/growth-plan'

const CONF: Record<string, string> = { measured: 'measured', estimated: 'estimated', benchmark: 'benchmark', test: 'test', potential: 'potential' }

export default function GrowthPlanPage() {
  const [plan, setPlan] = useState<GrowthPlan | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/mello/growth-plan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      const j = await r.json()
      if (r.ok) setPlan(j as GrowthPlan)
      else setPlan(null)
    } catch { setPlan(null) }
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const cur = plan?.currency || 'USD'
  const sym = (({ USD: '$', EUR: '€', GBP: '£' } as Record<string, string>)[cur]) || ''
  const money = (n?: number) => (n == null ? '—' : `${sym}${Math.round(n).toLocaleString()}`)
  const nowPct = plan && plan.goal > 0 ? Math.min(100, Math.round((plan.current / plan.goal) * 100)) : 0

  return (
    <div className="gp">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="gp-wrap">
        <a href="/mission" className="gp-back">← Back to your desk</a>

        {loading && <div className="gp-load">Building your plan from your real numbers…</div>}

        {!loading && plan && !plan.metaConnected && (
          <div className="gp-connect">
            <div className="eyebrow">Your growth plan</div>
            <h1>Connect Meta to build your plan</h1>
            <p>{plan.note}</p>
            <a href="/connect/meta" className="btn lime">Connect Meta →</a>
          </div>
        )}

        {!loading && plan && plan.metaConnected && (
          <>
            <div className="gp-top">
              <div className="eyebrow">Your growth plan · built by Mello</div>
              <h1>The road from {money(plan.current)} to <em>{money(plan.goal)}</em> a month</h1>
              <p className="sub">Here’s exactly how we get there — every move, what it adds, and the simple math behind it. Approve the ones you like; I’ll run them and swap these estimates for real results as they land.</p>
              <div className="barwrap">
                <div className="bar"><span className="now" style={{ width: `${nowPct}%` }} /><span className="planbar" style={{ left: `${nowPct}%`, width: `${Math.max(0, plan.coveragePct - nowPct)}%` }} /></div>
                <div className="marks"><span><b>{money(plan.current)}</b> today <span className="ad">· ad-driven</span></span><span>the plan fills this gap →</span><span className="goal">{money(plan.goal)} goal</span></div>
              </div>
            </div>

            <div className="lead">{plan.levers.length} moves to close the {money(plan.gap)} gap</div>
            <div className="leadsub">Each number below comes from your real cost-per-sale, order value and buy rate — or a clearly-labelled estimate.</div>

            {plan.levers.map((l) => <LeverCard key={l.key} l={l} money={money} />)}

            <div className="total">
              <span className="lbl">The plan adds</span><span className="n">+{money(plan.planTotal)}/mo</span>
              <span className="gap">{money(plan.current)} + {money(plan.planTotal)} = {money(plan.projected)} · about {Math.min(100, Math.round((plan.projected / plan.goal) * 100))}% of your {money(plan.goal)} goal.</span>
            </div>
            <div className="footnote">Every number here comes from YOUR data or a clearly-labelled benchmark. Estimates become real results the moment a move goes live. Nothing runs or spends without your yes.</div>
          </>
        )}
      </div>
    </div>
  )
}

function MathText({ segs }: { segs: MathSeg[] }) {
  return <>{segs.map((s, i) => (s.b ? <b key={i}>{s.t}</b> : <span key={i}>{s.t}</span>))}</>
}

function LeverCard({ l, money }: { l: Lever; money: (n?: number) => string }) {
  return (
    <div className={`lever${l.live ? '' : ' locked'}`}>
      <div className="head"><h3>{l.name}</h3><span className={`metric ${l.metric}`}>{l.metric === 'cvr' ? 'Conversion' : l.metric === 'aov' ? 'Order value' : l.metric === 'retention' ? 'Repeat' : 'Traffic'}</span><span className="agent">{l.agent}</span></div>
      <div className={`delta${l.live ? '' : ' locked'}`}><div className="n">{l.deltaText}</div><div className={`c ${l.confidence}`}>{CONF[l.confidence] || l.confidence}</div></div>
      <div className="math">
        <MathText segs={l.math} />
        {l.flow.length > 0 && (
          <div className="flow">{l.flow.map((f, i) => (<span key={i} className="fi"><span className="step">{f}</span>{i < l.flow.length - 1 && <span className="ar">→</span>}</span>))}</div>
        )}
      </div>
      <div className="assume">{l.assumption}</div>
      <div className="act">
        {l.action.kind === 'soon'
          ? <button className="btn soon" disabled>{l.action.label}</button>
          : <a href={l.action.href || '#'} className={`btn ${l.action.kind === 'run' ? 'lime' : ''}`}>{l.action.label}</a>}
        <span className="chain">{l.chain}</span>
      </div>
    </div>
  )
}

const CSS = `
.gp{--ink:#161c17;--sub:#6f6d5a;--mut:#9aa79a;--paper:#faf9f5;--shell:#ffffff;--card:#ffffff;--hair:#ecebe3;--line:#e3e2da;--forest:#141d15;--flame:#ef4a1e;--lime:#ff5a2c;--live:#3f7a4e;--greenBg:#eef6e4;
  --serif:'Instrument Serif',Georgia,serif;--ui:'Inter',system-ui,sans-serif;--mono:ui-monospace,'SF Mono',Menlo,monospace;
  background:var(--shell);color:var(--ink);min-height:100%;font-family:var(--ui);font-size:14px;line-height:1.5}
.gp a{color:var(--flame);text-decoration:none}
.gp-wrap{max-width:900px;margin:0 auto;padding:26px clamp(18px,4vw,40px) 80px}
.gp-back{font-family:var(--mono);font-size:12px;color:var(--sub);display:inline-block;margin-bottom:22px}
.gp-load{font-family:var(--mono);font-size:13px;color:var(--sub);padding:40px 0}
.gp .eyebrow{font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--mut);margin-bottom:8px}
.gp h1{font-family:var(--serif);font-weight:400;font-size:clamp(30px,5vw,46px);line-height:1.05;letter-spacing:-.01em;margin:0}
.gp h1 em{font-style:normal;color:var(--lime)}
.gp .sub{font-size:15px;color:var(--sub);margin-top:10px;max-width:620px}
.gp-connect{padding:30px 0}
.gp-connect p{font-size:15px;color:var(--sub);max-width:520px;margin:12px 0 20px}
.gp-top{border-bottom:1px solid var(--line);padding-bottom:22px}
.barwrap{margin-top:20px}
.bar{position:relative;height:12px;border-radius:100px;background:var(--greenBg)}
.bar .now{position:absolute;left:0;top:0;bottom:0;background:var(--live);border-radius:100px}
.bar .planbar{position:absolute;top:0;bottom:0;background:repeating-linear-gradient(45deg,rgba(255,90,44,.5),rgba(255,90,44,.5) 6px,rgba(255,90,44,.26) 6px,rgba(255,90,44,.26) 12px);border-radius:0 100px 100px 0}
.marks{display:flex;justify-content:space-between;gap:10px;margin-top:8px;font-family:var(--mono);font-size:11px;color:var(--mut);flex-wrap:wrap}
.marks b{color:var(--ink)} .marks .ad{color:var(--mut)} .marks .goal{color:var(--lime);font-weight:700}
.lead{font-family:var(--serif);font-size:23px;margin:34px 0 4px;letter-spacing:-.005em}
.leadsub{font-size:13.5px;color:var(--sub);margin-bottom:16px}
.lever{border:1px solid var(--line);border-radius:16px;background:var(--card);padding:20px 22px;margin-bottom:14px;display:grid;grid-template-columns:1fr auto;gap:6px 24px;align-items:start}
.lever.locked{background:var(--paper);border-style:dashed}
.lever .head{grid-column:1;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.lever h3{font-family:var(--serif);font-weight:400;font-size:22px;letter-spacing:-.005em;margin:0}
.metric{font-family:var(--mono);font-size:9.5px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;border-radius:100px;padding:3px 9px;border:1px solid var(--line);color:var(--sub)}
.metric.traffic{color:#2f6df0;border-color:#c9d9fb;background:#f2f6ff}
.metric.cvr{color:var(--lime);border-color:#ffd9cc;background:#fff4f0}
.metric.aov{color:#a9852f;border-color:#ecdcb4;background:#fbf6ea}
.metric.retention{color:#7a52c0;border-color:#e0d4f2;background:#f7f3fd}
.agent{font-family:var(--mono);font-size:10px;letter-spacing:.03em;color:var(--mut)}
.delta{grid-column:2;grid-row:1/3;text-align:right;flex:none}
.delta .n{font-family:var(--serif);font-size:34px;line-height:1;color:var(--live)}
.delta.locked .n{color:var(--mut)}
.delta .c{font-family:var(--mono);font-size:9.5px;letter-spacing:.04em;text-transform:uppercase;color:var(--mut);margin-top:5px}
.delta .c.measured{color:var(--live)}
.math{grid-column:1;background:var(--paper);border-radius:12px;padding:14px 16px;margin-top:12px;font-size:14.5px;line-height:1.65;color:var(--ink)}
.lever.locked .math{background:var(--shell);border:1px solid var(--line)}
.math b{font-weight:700}
.math .flow{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-family:var(--mono);font-size:12.5px;color:var(--sub);margin-top:10px;padding-top:10px;border-top:1px dashed var(--line)}
.math .flow .fi{display:inline-flex;align-items:center;gap:8px}
.math .flow .step{background:var(--card);border:1px solid var(--line);border-radius:7px;padding:4px 9px;color:var(--ink)}
.math .flow .ar{color:var(--mut)}
.assume{grid-column:1;font-size:12px;color:var(--mut);font-style:italic;margin-top:8px}
.act{grid-column:1;display:flex;gap:10px;align-items:center;margin-top:14px;flex-wrap:wrap}
.btn{font-family:var(--ui);font-size:13px;font-weight:600;border-radius:10px;padding:10px 16px;cursor:pointer;border:1px solid var(--line);background:var(--card);color:var(--ink);display:inline-block}
.btn:hover{border-color:var(--sub)}
.btn.lime{background:var(--lime);border-color:var(--lime);color:#fff}
.btn.soon{opacity:.55;cursor:default}
.chain{font-family:var(--mono);font-size:11px;color:var(--mut)}
.total{border-top:2px solid var(--ink);margin-top:24px;padding-top:20px;display:flex;align-items:baseline;gap:16px;flex-wrap:wrap}
.total .lbl{font-family:var(--serif);font-size:24px}
.total .n{font-family:var(--serif);font-size:34px;color:var(--live);line-height:1}
.total .gap{font-family:var(--mono);font-size:12px;color:var(--sub);margin-left:auto}
.footnote{margin-top:18px;font-family:var(--mono);font-size:11px;color:var(--mut);line-height:1.6}
@media(max-width:640px){.lever{grid-template-columns:1fr}.delta{grid-column:1;grid-row:auto;text-align:left;display:flex;align-items:baseline;gap:10px}.delta .c{margin-top:0}}
`
