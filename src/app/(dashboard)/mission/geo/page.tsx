'use client'
/**
 * /mission/geo — the GEO Visibility Monitor (Phase A). Shows whether the brand is cited in AI answers
 * (ChatGPT / Gemini / Perplexity) for its target buyer questions, vs rivals, over time. "Run check" asks
 * the real engines (metered). Everything shown is really checked and stored — never asserted.
 */
import { useCallback, useEffect, useState } from 'react'
import { useEmbedded } from '@/lib/ui/embedded'
import { openCredits } from '@/components/credits/CreditModal'
import LlmsGuide from '@/components/geo/LlmsGuide'
import SelectBrandNotice from '@/components/app/SelectBrandNotice'
import { requireUpgrade } from '@/lib/ui/requireUpgrade'

type EngineCell = { engine: string; label: string; cited: boolean; grounded: boolean; competitorsCited: string[]; excerpt: string }
type PromptResult = { prompt: string; engines: EngineCell[]; youCited: boolean; rivalsCited: number }
type Status = {
  hasData: boolean; brandName: string | null; score: number; shareOfVoice: number; promptsChecked: number
  engines: { engine: string; label: string }[]; availableEngines: { engine: string; label: string }[]
  results: PromptResult[]; gaps: { prompt: string; rivals: string[] }[]; history: { date: string; score: number }[]
  lastRun: string | null; lastRunCalls?: number; estCostUsd?: number; perCheckEstUsd?: number; category?: string
  understanding?: { websiteUrl: string | null; websiteSource: string; siteRead: boolean; competitors: string[]; metaAdCopy: number; uncertain: boolean }; note?: string
}
const usd = (n?: number) => (n == null ? '' : n < 0.01 ? '<$0.01' : `~$${n.toFixed(2)}`)

type Asset = { id: string | null; kind?: string; title: string; target_prompt: string; body_markdown: string; status: string; published_url: string | null }
const CRAWL_KINDS = ['llms_txt', 'schema', 'fact_sheet']

export default function GeoPage() {
  const embedded = useEmbedded()
  const [status, setStatus] = useState<Status | null>(null)
  const [selectBrand, setSelectBrand] = useState(false)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [assets, setAssets] = useState<Asset[]>([])
  const [writing, setWriting] = useState<string | null>(null)   // the prompt currently being written
  const [openAsset, setOpenAsset] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  // In-app toast (replaces browser alert() so confirmations feel native, not "www.tryselfmade.ai says…").
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'err' } | null>(null)
  const flash = useCallback((text: string, tone: 'ok' | 'err' = 'ok') => { setToast({ text, tone }); setTimeout(() => setToast(null), 3600) }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try { const r = await fetch('/api/geo/status'); const j = await r.json(); if (r.ok) { if (j?.selectBrand) { setSelectBrand(true); setLoading(false); return } setSelectBrand(false); setStatus(j as Status) } } catch { /* empty state */ }
    try { const r = await fetch('/api/geo/answer'); const j = await r.json(); if (r.ok && Array.isArray(j?.assets)) setAssets(j.assets) } catch { /* ignore */ }
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])
  // Re-fetch when the founder switches brand (the switcher fires this) — otherwise the page keeps the
  // previous brand's data because it only fetched on mount.
  useEffect(() => { const h = () => load(); window.addEventListener('sf:brandchange', h); return () => window.removeEventListener('sf:brandchange', h) }, [load])
  // when we're only guessing (name-match, no trusted signal), open the correction form so it's obvious.
  useEffect(() => { if (status?.understanding?.uncertain) setShowFix(true) }, [status?.understanding?.uncertain])

  const writeAnswer = async (prompt: string, rivals: string[]) => {
    if (await requireUpgrade()) return   // free → agreement + payment wall
    if (writing) return
    setWriting(prompt)
    try {
      const r = await fetch('/api/geo/answer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt, rivals }) })
      const j = await r.json()
      if (r.ok && j?.asset?.body_markdown) { setAssets((a) => [j.asset as Asset, ...a]); setOpenAsset(j.asset.id || prompt) }
      else if (r.status === 402) openCredits('buy', j.reason || 'Writing a GEO answer page costs credits — top up to continue.')
      else if (r.ok && j?.asset && !j.asset.body_markdown) flash('The writer came back empty — please try again.', 'err')
      else flash(j?.detail || j?.error || 'Couldn’t write that page — try again.', 'err')
    } catch { flash('Network error — try again.', 'err') }
    setWriting(null)
  }
  const copy = async (a: Asset) => { try { await navigator.clipboard.writeText(a.body_markdown); setCopied(a.id || a.target_prompt); setTimeout(() => setCopied(null), 1800) } catch { /* ignore */ } }

  // Publish a reviewed answer page LIVE to the Shopify blog — this is what makes GEO real (a draft is
  // invisible to AI engines; a published, crawlable page can be cited). Paid feature; free → upgrade.
  const [publishing, setPublishing] = useState<string | null>(null)
  const publish = async (a: Asset) => {
    if (await requireUpgrade()) return   // free → agreement + payment wall
    if (!a.id || publishing) return
    setPublishing(a.id)
    try {
      const r = await fetch('/api/geo/answer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'publish', id: a.id }) })
      const j = await r.json()
      if (r.ok && j?.url) { setAssets((list) => list.map((x) => (x.id === a.id ? { ...x, status: 'published', published_url: j.url } : x))) }
      else if (r.status === 402) openCredits('plan', j.reason || 'Publishing live is a paid feature — upgrade to publish.')
      else if (j?.error === 'no_store') openCredits('plan', j.reason || 'Connect your Shopify store to publish.')
      else flash(j?.detail || j?.reason || 'Couldn’t publish — try again.', 'err')
    } catch { flash('Network error — try again.', 'err') }
    setPublishing(null)
  }

  // Apply a built crawlability/entity asset to the store: fact_sheet → a live Shopify Page; schema → the
  // theme <head>. (llms.txt can't auto-apply — it must sit at the site root; we keep it copy-only.)
  const [guideAsset, setGuideAsset] = useState<Asset | null>(null)
  const [applying, setApplying] = useState<string | null>(null)
  const apply = async (a: Asset) => {
    if (!a.id || applying) return
    setApplying(a.id)
    try {
      const r = await fetch('/api/geo/build', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'apply', id: a.id }) })
      const j = await r.json()
      if (r.ok) { const live = j.url || null; setAssets((list) => list.map((x) => (x.id === a.id ? { ...x, status: 'published', published_url: live } : x))); if (j.applied === 'theme') flash(j.alreadyPresent ? 'Schema updated in your store theme.' : 'Schema added to your store’s head.') }
      else if (r.status === 402) openCredits('plan', j.reason || 'Applying live is a paid feature — upgrade.')
      else if (j?.error === 'no_store') openCredits('plan', j.reason || 'Connect your Shopify store to apply.')
      else flash(j?.reason || j?.detail || 'Couldn’t apply — try again.', 'err')
    } catch { flash('Network error — try again.', 'err') }
    setApplying(null)
  }

  const [building, setBuilding] = useState<string | null>(null)
  const buildAsset = async (kind: string) => {
    if (await requireUpgrade()) return   // free → agreement + payment wall
    if (building) return
    setBuilding(kind)
    try {
      const r = await fetch('/api/geo/build', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind }) })
      const j = await r.json()
      if (r.ok && j?.asset?.body_markdown) { setAssets((a) => [j.asset as Asset, ...a]); setOpenAsset(j.asset.id || kind) }
      else if (r.status === 402) openCredits('buy', j.reason || 'Building a GEO asset costs credits — top up to continue.')
    } catch { /* keep prior */ }
    setBuilding(null)
  }
  const renderAsset = (a: Asset) => (
    <div className="asset" key={a.id || a.target_prompt}>
      <div className="ahead" onClick={() => setOpenAsset(openAsset === (a.id || a.target_prompt) ? null : (a.id || a.target_prompt))}>
        <span className="at">{a.title}</span>
        <span className={`ast ${a.status}`}>{a.published_url ? 'published' : a.status}</span>
      </div>
      {a.target_prompt && a.kind === 'answer_page' && <div className="aq">answers: “{a.target_prompt}”</div>}
      {a.kind === 'offsite' && a.target_prompt && <div className="aq">a helpful reply for a real discussion · <a href={a.target_prompt} target="_blank" rel="noopener noreferrer">open thread →</a></div>}
      {openAsset === (a.id || a.target_prompt) && (
        <div className="abody">
          <pre>{a.body_markdown}</pre>
          <div className="aact">
            <button className="btn tiny" onClick={() => copy(a)}>{copied === (a.id || a.target_prompt) ? 'Copied ✓' : 'Copy'}</button>
            {a.kind === 'answer_page' && (
              a.published_url
                ? <a className="btn tiny" href={a.published_url} target="_blank" rel="noopener noreferrer">View live →</a>
                : <button className="btn tiny lime" onClick={() => publish(a)} disabled={publishing === a.id}>{publishing === a.id ? 'Publishing…' : 'Publish to Shopify'}</button>
            )}
            {a.kind === 'fact_sheet' && (
              a.published_url
                ? <a className="btn tiny" href={a.published_url} target="_blank" rel="noopener noreferrer">View page →</a>
                : <button className="btn tiny lime" onClick={() => apply(a)} disabled={applying === a.id}>{applying === a.id ? 'Publishing…' : 'Publish as page'}</button>
            )}
            {a.kind === 'schema' && (
              <button className="btn tiny lime" onClick={() => apply(a)} disabled={applying === a.id}>{applying === a.id ? 'Applying…' : a.published_url ? 'Re-apply to theme' : 'Add to store theme'}</button>
            )}
            {a.kind === 'llms_txt' && (
              <button className="btn tiny lime" onClick={() => setGuideAsset(a)}>▶ How to add it (2-min guide)</button>
            )}
            {a.kind === 'offsite' && (
              <button className="btn tiny" disabled title="Auto-post coming soon">Post reply — soon</button>
            )}
          </div>
        </div>
      )}
    </div>
  )
  const answerAssets = assets.filter((a) => !a.kind || a.kind === 'answer_page')
  // Singleton crawl kinds (llms.txt / schema / fact sheet): show ONE per kind even if older
  // duplicate rows still exist — prefer a published copy, else the newest. (assets are newest-first.)
  const crawlAssets = (() => {
    const byKind = new Map<string, any>()
    for (const a of assets) {
      if (!a.kind || !CRAWL_KINDS.includes(a.kind)) continue
      const cur = byKind.get(a.kind)
      if (!cur) { byKind.set(a.kind, a); continue }
      if (cur.status !== 'published' && a.status === 'published') byKind.set(a.kind, a)
    }
    return CRAWL_KINDS.map((k) => byKind.get(k)).filter(Boolean)
  })()
  const offsiteAssets = assets.filter((a) => a.kind === 'offsite')

  const [reaching, setReaching] = useState(false)
  const [reachNote, setReachNote] = useState<string | null>(null)
  const findDiscussions = async () => {
    if (reaching) return
    setReaching(true); setReachNote(null)
    try {
      const r = await fetch('/api/geo/reach', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      const j = await r.json()
      if (r.ok) {
        const rr = await fetch('/api/geo/answer'); const jj = await rr.json(); if (rr.ok && Array.isArray(jj?.assets)) setAssets(jj.assets)
        setReachNote(j?.note || null)
      } else if (r.status === 402) openCredits('buy', j.reason || 'Outreach drafting costs credits — top up to continue.')
    } catch { setReachNote('Couldn’t reach out just now — try again.') }
    setReaching(false)
  }

  const [showFix, setShowFix] = useState(false)
  const [fixCat, setFixCat] = useState('')
  const [fixUrl, setFixUrl] = useState('')
  const submitFix = async () => {
    if (running || (!fixCat.trim() && !fixUrl.trim())) return
    setRunning(true)
    try { const r = await fetch('/api/geo/identity', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ category: fixCat.trim(), website: fixUrl.trim() }) }); const j = await r.json(); if (r.ok) { setStatus(j as Status); setShowFix(false) } } catch { /* keep prior */ }
    setRunning(false)
  }

  const runCheck = async (regenerate = false) => {
    if (running) return
    setRunning(true)
    try { const r = await fetch('/api/geo/sweep', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ regenerate }) }); const j = await r.json(); if (r.ok) setStatus(j as Status); else if (r.status === 402) openCredits('buy', j.reason || 'An AI-visibility check costs credits — top up to run it.') } catch { /* keep prior */ }
    setRunning(false)
  }

  const engines = status?.engines?.length ? status.engines : status?.availableEngines || []
  // First load (or right after a brand switch): show a skeleton instead of the empty "run your first check"
  // state, so we never flash "no data" while the status is still fetching.
  const booting = loading && !status
  const sov = status ? Math.round(status.shareOfVoice * 100) : 0

  if (selectBrand) return (
    <div className={`geo${embedded ? ' embedded' : ''}`}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <style>{`.geo.embedded .wrap{padding:6px 0 30px;max-width:100%}`}</style>
      <div className="wrap"><SelectBrandNotice feature="AI-visibility (GEO)" /></div>
    </div>
  )

  return (
    <div className={`geo${embedded ? ' embedded' : ''}`}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <style>{`.geo.embedded .back{display:none}.geo.embedded .top>div:first-child{display:none}.geo.embedded .wrap{padding:6px 0 30px;max-width:100%}`}</style>
      <div className="wrap">
        <a href="/mission" className="back">← Back to your desk</a>

        {booting && (
          <div style={{ marginTop: 10 }} aria-busy="true">
            <style>{`@keyframes sfShim{0%,100%{opacity:.55}50%{opacity:1}}.sfsk{animation:sfShim 1.2s ease-in-out infinite}`}</style>
            <div className="sfsk" style={{ height: 12, width: 110, borderRadius: 6, background: '#e9ece7', marginBottom: 16 }} />
            <div className="sfsk" style={{ height: 40, width: '58%', borderRadius: 10, background: '#e9ece7', marginBottom: 14 }} />
            <div className="sfsk" style={{ height: 15, width: '82%', borderRadius: 6, background: '#eef1ec', marginBottom: 8 }} />
            <div className="sfsk" style={{ height: 15, width: '68%', borderRadius: 6, background: '#eef1ec', marginBottom: 28 }} />
            <div className="sfsk" style={{ height: 84, width: '100%', borderRadius: 12, background: '#f2f4f0', marginBottom: 14 }} />
            <div className="sfsk" style={{ height: 120, width: '100%', borderRadius: 12, background: '#f2f4f0' }} />
          </div>
        )}

        {!booting && <div className="top">
          <div>
            <div className="eyebrow">AI visibility · GEO</div>
            <h1>Are you in the AI answers?</h1>
            <p className="sub">When someone asks ChatGPT, Gemini or Perplexity to recommend {status?.brandName ? <b>a {status.brandName}-type product</b> : 'your kind of product'}, do you come up? Here’s the honest read — really asked, really checked.</p>
          </div>
          <div className="runbox">
            <button className="btn lime" onClick={() => runCheck(false)} disabled={running}>{running ? 'Asking the AIs…' : status?.hasData ? '↻ Run check again' : 'Run your first check →'}</button>
            {status && (status.availableEngines?.length ?? 0) > 0 && (
              <div className="runcost">{status.availableEngines.map((e) => e.label).join(' · ')}{status.perCheckEstUsd != null && <> · {usd(status.perCheckEstUsd)}/check</>}</div>
            )}
            {status?.hasData && <button className="regen" onClick={() => runCheck(true)} disabled={running}>↻ Re-read my site &amp; regenerate questions</button>}
          </div>
        </div>}

        {status?.category && (
          <div className="understood">
            <div>{status.understanding?.uncertain
              ? <>I couldn’t confidently tell what you sell (I don’t have your Meta ads, competitors or site yet). <b>Tell me your category</b> so the check is accurate:</>
              : <>Checking you as: <b>{status.category}</b>. Not right? <button className="reglink" onClick={() => runCheck(true)} disabled={running}>re-read my site →</button> or <button className="reglink" onClick={() => setShowFix((s) => !s)} disabled={running}>tell me exactly →</button></>}</div>
            {showFix && (
              <div className="fixform">
                <input placeholder="Your category, e.g. nicotine-free vape / quit-vaping aid" value={fixCat} onChange={(e) => setFixCat(e.target.value)} />
                <input placeholder="Your website (optional, so I read the right one)" value={fixUrl} onChange={(e) => setFixUrl(e.target.value)} />
                <button className="btn lime" onClick={submitFix} disabled={running || (!fixCat.trim() && !fixUrl.trim())}>{running ? 'Fixing…' : 'Fix & re-check →'}</button>
              </div>
            )}
            {status.understanding && (
              <div className="howread">
                How I read you: source <b>{status.understanding.websiteSource === 'meta_ads' ? 'your Meta ads' : status.understanding.websiteSource === 'brand_kit' ? 'your brand kit' : status.understanding.websiteSource === 'name_match' ? '⚠️ name match (may be a different brand)' : 'no site found'}</b>
                {status.understanding.websiteUrl && <> · site <b>{(() => { try { return new URL(status.understanding.websiteUrl!.startsWith('http') ? status.understanding.websiteUrl! : `https://${status.understanding.websiteUrl}`).hostname } catch { return status.understanding.websiteUrl } })()}</b> {status.understanding.siteRead ? '(read ✓)' : '(not read)'}</>}
                {' '}· competitors <b>{status.understanding.competitors.length}</b>{status.understanding.competitors.length > 0 && <> ({status.understanding.competitors.slice(0, 4).join(', ')})</>} · your ad copy <b>{status.understanding.metaAdCopy}</b> lines
              </div>
            )}
          </div>
        )}

        {running && <div className="note">Asking {engines.map((e) => e.label).join(', ') || 'the AI engines'} your buyer questions — this takes a moment.</div>}

        {!loading && status && !status.hasData && !running && (
          <div className="empty">
            {status.note || 'No check yet. Tap “Run your first check” and I’ll ask the AI engines whether you come up for your buyers’ questions.'}
          </div>
        )}

        {status && status.hasData && (
          <>
            <div className="score">
              <div className="big"><span className="n">{sov}<span className="pctm">%</span></span><span className="lbl">share of voice</span></div>
              <div className="scap">You appear in <b>{sov}%</b> of the AI answers we checked{engines.length ? <> across <b>{engines.map((e) => e.label).join(', ')}</b></> : null}. {sov < 30 ? 'Big opportunity — most of these answers go to rivals.' : sov < 60 ? 'You’re showing up, but there’s room.' : 'Strong presence — protect and extend it.'}</div>
              {status.history.length > 1 && (
                <div className="spark">
                  {status.history.slice(-12).map((h, i) => <span key={i} className="bar" style={{ height: `${Math.max(6, h.score)}%` }} title={`${h.date}: ${h.score}%`} />)}
                  <span className="sparklbl">over time</span>
                </div>
              )}
            </div>

            {status.gaps.length > 0 && (
              <div className="gaps">
                <div className="gk">Answer gaps — rivals win these, you’re missing</div>
                {status.gaps.slice(0, 6).map((g, i) => (
                  <div className="gap" key={i}>
                    <span className="q">“{g.prompt}”</span>
                    {g.rivals.length > 0 && <span className="r">→ {g.rivals.join(', ')} cited</span>}
                    <button className="btn tiny" disabled={writing === g.prompt} onClick={() => writeAnswer(g.prompt, g.rivals)}>{writing === g.prompt ? 'Writing…' : 'Write the answer →'}</button>
                  </div>
                ))}
                <div className="gnote">Mello writes the answer page that wins each back. Drafts now — one-click publish to your Shopify blog once it’s connected.</div>
              </div>
            )}

            <div className="lead">Question by question</div>
            <div className="tablehd" style={{ gridTemplateColumns: `1fr repeat(${Math.max(1, engines.length)}, 76px)` }}>
              <span>Buyer question</span>
              {engines.map((e) => <span key={e.engine} className="eh">{e.label}</span>)}
            </div>
            {status.results.map((r, i) => (
              <div key={i}>
                <div className="row" style={{ gridTemplateColumns: `1fr repeat(${Math.max(1, engines.length)}, 76px)` }} onClick={() => setOpen(open === r.prompt ? null : r.prompt)}>
                  <span className="q">“{r.prompt}”</span>
                  {engines.map((e) => {
                    const cell = r.engines.find((c) => c.engine === e.engine)
                    return <span key={e.engine} className={`cell ${cell ? (cell.cited ? 'yes' : 'no') : 'na'}`}>{cell ? (cell.cited ? '✓' : '✗') : '—'}</span>
                  })}
                </div>
                {open === r.prompt && (
                  <div className="detail">
                    {r.engines.map((c, j) => (
                      <div className="ex" key={j}>
                        <div className="exh"><b>{c.label}</b> {c.cited ? <span className="tag yes">you’re cited</span> : <span className="tag no">not cited</span>} {!c.grounded && <span className="tag km">model knowledge</span>}{c.competitorsCited.length > 0 && <span className="tag riv">rivals: {c.competitorsCited.join(', ')}</span>}</div>
                        {c.excerpt && <div className="exq">{c.excerpt}…</div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {answerAssets.length > 0 && (
              <div className="assets">
                <div className="lead">Answer pages Mello wrote</div>
                <div className="assub">Review, tweak, and publish. Copy into your site now, or one-click to your Shopify blog once connected.</div>
                {answerAssets.map(renderAsset)}
              </div>
            )}

            <div className="assets">
              <div className="lead">Make yourself readable to AI</div>
              <div className="assub">The files + markup that tell AI engines exactly who you are — so they can find and cite {status.brandName || 'you'}. Built from your real brand, copy-to-apply now.</div>
              <div className="crawlbtns">
                <button className="btn" disabled={building === 'llms_txt'} onClick={() => buildAsset('llms_txt')}>{building === 'llms_txt' ? 'Writing…' : 'Generate llms.txt'}</button>
                <button className="btn" disabled={building === 'schema'} onClick={() => buildAsset('schema')}>{building === 'schema' ? 'Writing…' : 'Generate schema'}</button>
                <button className="btn" disabled={building === 'fact_sheet'} onClick={() => buildAsset('fact_sheet')}>{building === 'fact_sheet' ? 'Writing…' : 'Generate fact sheet'}</button>
              </div>
              {crawlAssets.map(renderAsset)}
            </div>

            <div className="assets">
              <div className="lead">Get mentioned where buyers ask</div>
              <div className="assub">Real Reddit &amp; forum discussions where {status.brandName || 'your'} buyers are asking — with a genuinely-helpful reply drafted for you. You review &amp; post; nothing auto-posts, and it skips anywhere a mention would be spammy.</div>
              <div className="crawlbtns"><button className="btn" disabled={reaching} onClick={findDiscussions}>{reaching ? 'Finding discussions…' : 'Find discussions →'}</button></div>
              {reachNote && <div className="note">{reachNote}</div>}
              {offsiteAssets.map(renderAsset)}
            </div>

            <div className="foot">
              {status.lastRunCalls != null && status.lastRunCalls > 0 && (
                <div className="runstat">Last run: <b>{status.promptsChecked}</b> questions × <b>{status.engines.length}</b> engine{status.engines.length === 1 ? '' : 's'} = <b>{status.lastRunCalls}</b> checks · <b>{usd(status.estCostUsd)}</b> <span className="est">(estimate)</span></div>
              )}
              {status.lastRun && <>Last checked {new Date(status.lastRun).toLocaleString()} · </>}
              Every ✓/✗ is a real answer we asked and stored — “model knowledge” means the engine answered without live web search. Nothing here is projected.
            </div>
          </>
        )}
      </div>
      {guideAsset && <LlmsGuide content={guideAsset.body_markdown} domain={status?.understanding?.websiteUrl} onClose={() => setGuideAsset(null)} />}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 200, background: toast.tone === 'err' ? '#b42318' : '#181712', color: '#fff', padding: '12px 20px', borderRadius: 999, fontSize: 13.5, fontWeight: 600, boxShadow: '0 16px 40px -12px rgba(0,0,0,.4)', maxWidth: '90vw' }}>{toast.text}</div>
      )}
    </div>
  )
}

const CSS = `
.geo{--ink:#161c17;--sub:#6f6d5a;--mut:#9aa79a;--paper:#faf9f5;--shell:#ffffff;--card:#ffffff;--hair:#ecebe3;--line:#e3e2da;--flame:#ef4a1e;--lime:#ff5a2c;--live:#3f7a4e;--greenBg:#eef6e4;
  --serif:'Instrument Serif',Georgia,serif;--ui:'Inter',system-ui,sans-serif;--mono:ui-monospace,'SF Mono',Menlo,monospace;
  background:var(--shell);color:var(--ink);min-height:100%;font-family:var(--ui);font-size:14px;line-height:1.5}
.geo a{color:var(--flame);text-decoration:none}
.wrap{max-width:900px;margin:0 auto;padding:26px clamp(18px,4vw,40px) 80px}
.back{font-family:var(--mono);font-size:12px;color:var(--sub);display:inline-block;margin-bottom:22px}
.top{display:flex;gap:20px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;border-bottom:1px solid var(--line);padding-bottom:22px}
.eyebrow{font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--mut);margin-bottom:8px}
h1{font-family:var(--serif);font-weight:400;font-size:clamp(30px,5vw,44px);line-height:1.05;letter-spacing:-.01em;margin:0}
.sub{font-size:15px;color:var(--sub);margin-top:10px;max-width:560px}
.btn{font-family:var(--ui);font-size:13px;font-weight:600;border-radius:10px;padding:11px 17px;cursor:pointer;border:1px solid var(--line);background:var(--card);color:var(--ink)}
.btn.lime{background:var(--lime);border-color:var(--lime);color:#fff}
.btn:disabled{opacity:.55;cursor:default}
.runbox{display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex:none}
.runcost{font-family:var(--mono);font-size:10.5px;color:var(--mut);letter-spacing:.02em;text-align:right}
.regen{background:none;border:none;font-family:var(--mono);font-size:10.5px;color:var(--flame);cursor:pointer;padding:0}
.regen:disabled{opacity:.5;cursor:default}
.understood{font-size:13px;color:var(--sub);background:var(--paper);border:1px solid var(--line);border-radius:10px;padding:10px 14px;margin-top:16px}
.understood b{color:var(--ink)}
.reglink{background:none;border:none;color:var(--flame);cursor:pointer;font-size:13px;padding:0}
.howread{font-family:var(--mono);font-size:11px;color:var(--mut);margin-top:8px;line-height:1.6}
.howread b{color:var(--sub)}
.fixform{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.fixform input{flex:1;min-width:220px;border:1px solid var(--line);border-radius:9px;padding:9px 12px;font-family:var(--ui);font-size:13px;background:var(--card);color:var(--ink);outline:none}
.fixform input:focus{border-color:var(--sub)}
.fixform .btn{flex:none}
.runstat{font-family:var(--mono);font-size:11px;color:var(--sub);margin-bottom:8px}
.runstat b{color:var(--ink)} .runstat .est{color:var(--mut)}
.note{font-family:var(--mono);font-size:12.5px;color:var(--sub);background:var(--paper);border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin-top:18px}
.empty{color:var(--sub);font-size:15px;padding:34px 0;max-width:560px}
.score{display:flex;gap:24px;align-items:center;flex-wrap:wrap;margin:26px 0 6px;padding:20px 22px;background:var(--paper);border:1px solid var(--line);border-radius:16px}
.score .big{display:flex;align-items:baseline;gap:8px;flex:none}
.score .big .n{font-family:var(--serif);font-size:56px;line-height:1;color:var(--lime)}
.score .big .pctm{font-size:26px}
.score .big .lbl{font-family:var(--mono);font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--mut)}
.score .scap{flex:1;min-width:220px;font-size:14px;color:var(--sub);line-height:1.5}
.score .scap b{color:var(--ink)}
.spark{display:flex;align-items:flex-end;gap:3px;height:44px;flex:none}
.spark .bar{width:7px;background:var(--live);border-radius:2px;opacity:.8}
.spark .sparklbl{font-family:var(--mono);font-size:9px;color:var(--mut);align-self:flex-end;margin-left:4px}
.gaps{margin-top:20px;border:1px dashed var(--line);border-radius:14px;padding:16px 18px;background:var(--shell)}
.gaps .gk{font-family:var(--mono);font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--flame);margin-bottom:10px}
.gap{display:flex;gap:10px;flex-wrap:wrap;padding:7px 0;border-top:1px solid var(--hair);font-size:13.5px}
.gap:first-of-type{border-top:none}
.gap{align-items:center}
.gap .q{font-style:italic;color:var(--ink)} .gap .r{font-family:var(--mono);font-size:11.5px;color:var(--sub)}
.gap .btn.tiny{margin-left:auto}
.gaps .gnote{font-family:var(--mono);font-size:11px;color:var(--mut);margin-top:10px}
.btn.tiny{font-size:11.5px;padding:6px 11px;border-radius:8px}
.assets{margin-top:32px}
.assub{font-size:13.5px;color:var(--sub);margin:-6px 0 14px}
.asset{border:1px solid var(--line);border-radius:12px;background:var(--card);padding:14px 16px;margin-bottom:10px}
.ahead{display:flex;align-items:center;gap:10px;cursor:pointer}
.ahead .at{font-family:var(--serif);font-size:18px;letter-spacing:-.005em;flex:1;min-width:0}
.ast{font-family:var(--mono);font-size:9.5px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;border-radius:100px;padding:3px 9px;border:1px solid var(--line);color:var(--sub)}
.ast.draft{color:var(--flame);border-color:#ffd9cc;background:#fff4f0}
.ast.published{color:var(--live);border-color:#cfe6cf;background:var(--greenBg)}
.aq{font-family:var(--mono);font-size:11.5px;color:var(--mut);margin-top:6px}
.abody{margin-top:12px;border-top:1px solid var(--hair);padding-top:12px}
.abody pre{white-space:pre-wrap;word-break:break-word;font-family:var(--ui);font-size:13.5px;line-height:1.6;color:var(--ink);background:var(--paper);border:1px solid var(--line);border-radius:10px;padding:14px 16px;max-height:420px;overflow-y:auto;margin:0}
.aact{display:flex;gap:8px;margin-top:10px}
.crawlbtns{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
.lead{font-family:var(--serif);font-size:23px;margin:30px 0 12px}
.tablehd{display:grid;gap:8px;padding:0 6px 8px;border-bottom:1px solid var(--line);font-family:var(--mono);font-size:9.5px;letter-spacing:.05em;text-transform:uppercase;color:var(--mut)}
.tablehd .eh{text-align:center}
.row{display:grid;gap:8px;align-items:center;padding:11px 6px;border-bottom:1px solid var(--hair);cursor:pointer}
.row:hover{background:var(--paper)}
.row .q{font-size:13.5px;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cell{text-align:center;font-family:var(--mono);font-size:14px;font-weight:700}
.cell.yes{color:var(--live)} .cell.no{color:var(--flame)} .cell.na{color:var(--mut)}
.detail{padding:6px 6px 14px;border-bottom:1px solid var(--hair);display:flex;flex-direction:column;gap:10px}
.ex{background:var(--paper);border:1px solid var(--line);border-radius:10px;padding:11px 13px}
.exh{display:flex;gap:7px;align-items:center;flex-wrap:wrap;font-size:12.5px}
.tag{font-family:var(--mono);font-size:9.5px;font-weight:600;letter-spacing:.03em;text-transform:uppercase;border-radius:100px;padding:2px 8px;border:1px solid var(--line);color:var(--sub)}
.tag.yes{color:var(--live);border-color:#cfe6cf;background:var(--greenBg)}
.tag.no{color:var(--flame);border-color:#ffd9cc;background:#fff4f0}
.tag.km{color:var(--mut)} .tag.riv{color:var(--sub)}
.exq{font-size:12.5px;color:var(--sub);line-height:1.5;margin-top:7px;font-style:italic}
.foot{margin-top:22px;font-family:var(--mono);font-size:11px;color:var(--mut);line-height:1.6}
@media(max-width:600px){.score .big .n{font-size:44px}}
`
