'use client'
/**
 * THE SCAN — the Morning Brief as the founder's operating system, not a dashboard (2026-07-28).
 *
 * The redesign laws (Chesky/PG/Jobs/Rams room):
 *   · ONE focal point — the hero card. It carries the page's only strong elevation; nothing
 *     competes with it visually. A screenshot of it alone should communicate the product.
 *   · 70/30 — everything that answers "what should I do next?" lives LEFT (hero → Mello's plan →
 *     competitors → playbook). Everything supporting lives RIGHT (Mello, plan, capabilities).
 *   · Borders down ~70% — whitespace, contrast and soft elevation carry separation. Hairlines
 *     survive only inside lists, where rows genuinely need a seam.
 *   · Sentence case everywhere. 20px section titles, 15px body. No uppercase, no mono kickers.
 *   · Green is spent on primary actions only.
 *
 * Every capability of the previous scan is preserved: hero approve + Why?, second item, Mello's
 * plan (MelloTasks), competitor rows w/ ad previews + add-competitor, capability menu, plan card /
 * top-up, credits, cross-competitor playbook with Mello's judgment. The thin status row replaces
 * the dark terminal strip. Responsive: ≥1060 two columns · below, sidebar stacks under the work.
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import MelloFace, { type MelloState } from '@/components/MelloFace'
import MelloTasks from './MelloTasks'
import FacebookAdsCard from '@/components/brief/FacebookAdsCard'
import BriefOpportunities from '@/components/brief/BriefOpportunities'
import StandupCard from '@/components/brief/StandupCard'
import { ChannelLogo } from '@/components/brand/logos'
import { planEntitlements } from '@/lib/plans'
import CompetitorCard from '@/components/brief/CompetitorCard'
import CreativeStrategistCard from '@/components/brief/CreativeStrategistCard'
import WatchingCompetitors from '@/components/brief/WatchingCompetitors'
import BrandGuardianCard from '@/components/brief/BrandGuardianCard'
import HoverScrubVideo from '@/components/discovery/HoverScrubVideo'

const INK = '#111111', MUTED = '#6b6b6b', LINE = '#ecede8', LIME = '#ff5a2c', FOREST = '#141d15', GREEN = '#ef4a1e'

type MetaCampaign = { name: string; roas: number; spend: number; conversions: number; dailyBudget: number | null }
type Item = { id?: string; kind: string; importance: number; title: string; body?: string; why?: string; cta_label?: string; cta_href?: string; thumbs?: string[]; media?: { image: string | null; videoUrl: string | null; adId?: string }[]; forBrand?: string; at?: string; playbook?: { totalAds: number; brandsCount: number; videoPct: number; formats: { label: string; count: number }[]; hooks: { label: string; count: number }[]; emotions: { label: string; count: number }[]; offers: { label: string; count: number }[]; judgment?: { winner: string; confidence: 'High' | 'Medium' | 'Low'; confidenceWhy: string; verdict: 'Adopt' | 'Test' | 'Watch'; verdictWhy: string } }; metaAudit?: { total: number; spend: number; avgRoas: number; currency?: string; accountName?: string | null; scale: MetaCampaign[]; watch: MetaCampaign[]; pause: MetaCampaign[]; opportunities?: { title: string; why: string; impact: string; level: number; href: string; cta: string; tone: string }[] } }
type Brief = {
  summary: { adsScanned: number; brandsWatched: number; spiedBrands: number; creativesReady: number }
  lastCycleAt?: string | null
  firstName: string | null
  headline: Item | null
  items: Item[]
  learning: Item | null
  quiet: boolean
}

const ago = (iso?: string | null): string | null => {
  if (!iso) return null
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (!isFinite(m) || m < 0) return null
  if (m < 60) return m <= 1 ? 'just now' : `${m}m ago`
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24); return d === 1 ? 'yesterday' : `${d}d ago`
}

/** Section title — 20px sentence case. The only heading device on the page besides the hero. */
const section: React.CSSProperties = { fontSize: 20, fontWeight: 750, letterSpacing: '-.02em', color: INK, margin: '0 0 4px' }
const sectionSub: React.CSSProperties = { fontSize: 13.5, color: MUTED, lineHeight: 1.5, margin: '0 0 18px' }
const body: React.CSSProperties = { fontSize: 15, color: MUTED, lineHeight: 1.6 }
/** A quiet card — white on the #F7F8F5 page, separation by elevation, not outline. */
const card: React.CSSProperties = { background: '#fff', borderRadius: 16, boxShadow: '0 1px 2px rgba(17,24,17,.04), 0 10px 30px -18px rgba(17,24,17,.10)' }

/** The overnight number, counted up on first paint — "Mello was reading while you slept", felt, not
 *  stated. The REAL value is server-rendered; the count-up is pure enhancement (no JS / reduced
 *  motion → the true figure simply shows). Same pattern as the standup's CountUp. */
function Count({ n }: { n: number }) {
  const [v, setV] = useState(n)
  useEffect(() => {
    if (typeof window === 'undefined' || !n) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    let raf = 0
    const start = performance.now(), DUR = 900
    setV(0)
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / DUR)
      setV(Math.round(n * (1 - Math.pow(1 - p, 3))))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [n])
  return <>{v.toLocaleString()}</>
}

/** A creative, shown. Video renders as poster + badge (never live) so clicks always reach the link. */
function Shot({ image, videoUrl, w, h }: { image?: string | null; videoUrl?: string | null; w: number; h: number }) {
  const box: React.CSSProperties = { width: w, height: h, borderRadius: 10, objectFit: 'contain', background: '#0d120e', display: 'block', pointerEvents: 'none' }
  // Mello's own video creatives arrive via `thumbs` (an r2 .mp4 URL) — an <img> with a video src
  // renders the broken-image glyph. Detect and show the video instead.
  const imgIsVideo = !!image && /\.(mp4|webm|mov|m4v)(\?|$)/i.test(image)
  if (image && !imgIsVideo && !videoUrl) return <span style={{ position: 'relative', display: 'inline-block' }}>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={image} alt="" style={box} /></span>
  const vsrc = imgIsVideo ? image! : videoUrl
  // Playable — the SAME Discovery player (hover-scrub, white line, lime play), so competitor videos on
  // the brief behave exactly like they do in Discovery instead of a dead first-frame.
  if (vsrc) return (
    <span style={{ position: 'relative', display: 'inline-block', width: w, height: h, borderRadius: 10, overflow: 'hidden', background: '#0d120e', verticalAlign: 'top' }}>
      <HoverScrubVideo src={vsrc} poster={!imgIsVideo && image ? image : undefined} />
    </span>
  )
  if (image) return <span style={{ position: 'relative', display: 'inline-block' }}>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={image} alt="" style={box} /></span>
  return null
}

const ARROW = <span className="bsx-a" style={{ color: '#c2ccc0', fontSize: 16, transition: 'color .15s, transform .15s', display: 'inline-block' }}>→</span>

/** One capability row — a verb and what it does. Hairline seams only inside the list. */
function Row({ href, onClick, title, desc, right, first }: {
  href?: string; onClick?: () => void; title: string; desc: string; right?: React.ReactNode; first?: boolean
}) {
  const inner = (
    <>
      {right && <span style={{ float: 'right', marginLeft: 10, marginTop: 2 }}>{right}</span>}
      <span className="bsx-t" style={{ display: 'block', fontSize: 15, fontWeight: 700, letterSpacing: '-.012em', color: INK, lineHeight: 1.35, transition: 'color .15s' }}>{title}</span>
      <span style={{ display: 'block', fontSize: 13, color: MUTED, lineHeight: 1.5, marginTop: 1 }}>{desc}</span>
    </>
  )
  const style: React.CSSProperties = {
    display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none',
    borderTop: first ? 'none' : `1px solid ${LINE}`, padding: first ? '0 0 12px' : '12px 0',
    cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'none',
  }
  if (href) return <Link href={href} onClick={onClick} className="bsx-row" style={style}>{inner}</Link>
  return <button onClick={onClick} className="bsx-row" style={style}>{inner}</button>
}

export default function BriefScan({ brief, melloState, onAct, onWhy, credits, plan, onGoFullTime, subscribing, onBuyCredits, activeBrandId, activeBrandName, onAddCompetitor }: {
  brief: Brief; melloState: MelloState; onAct: (it: Item) => void; onWhy: (it: Item) => void
  credits?: number | null; plan?: string | null; onGoFullTime?: () => void; subscribing?: boolean; onBuyCredits?: () => void
  activeBrandId?: string | null; activeBrandName?: string | null; onAddCompetitor?: () => void
}) {
  // Which Meta account the brief is scoped to. The Facebook card owns the switcher; when the founder
  // flips accounts, this lifts up so "What Mello would do" refetches for the SAME account — one
  // currency, one truth, across every card. null = the nightly-stored primary (no live call).
  const [acctScope, setAcctScope] = useState<string | null>(null)
  const isPaid = ['starter', 'pro', 'business', 'enterprise'].includes(String(plan || '').toLowerCase())
  const canLaunch = planEntitlements(plan).launch   // Meta = the `launch` entitlement (same gate as /m4, /connect/meta)
  const perDay = (49 / 30).toFixed(2)
  // Which FOUNDER brief channels are connected — so "Finish setup" (get your brief on Slack/WhatsApp)
  // drops the done ones. Only `kind:'founder'` counts: a CUSTOMER-inbox WhatsApp is a different channel
  // and must NOT hide the founder-brief prompt.
  const [connectedChannels, setConnectedChannels] = useState<string[]>([])
  useEffect(() => {
    fetch('/api/channels/unipile/connect').then(r => r.ok ? r.json() : null)
      // FINISH SETUP = the founder's OWN brief channels. Count ONLY founder-tool connections — a connected
      // CUSTOMER WhatsApp (e.g. Aura's inbox line) is NOT the founder's brief line, so it must not make
      // "Get your brief on WhatsApp" disappear as if it were already set up.
      .then(j => { if (Array.isArray(j?.connected)) setConnectedChannels(j.connected.filter((c: any) => c.kind === 'founder').map((c: any) => String(c.provider))) })
      .catch(() => {})
  }, [])
  // Is Meta actually connected FOR THIS BRAND? The promo card below shows when there's no audit yet — but
  // that's true both when nothing is connected AND when it's connected-but-not-audited. Read the real
  // per-brand connection (source of truth) so a not-connected user sees "Connect Meta", not "Run ads".
  const [metaConnected, setMetaConnected] = useState<boolean | null>(null)
  useEffect(() => {
    if (!canLaunch) { setMetaConnected(false); return }
    let cancelled = false
    fetch('/api/meta/accounts').then(r => r.ok ? r.json() : null).then(j => {
      if (cancelled) return
      const accts = Array.isArray(j?.accounts) ? j.accounts : (Array.isArray(j) ? j : [])
      setMetaConnected(accts.length > 0)
    }).catch(() => { if (!cancelled) setMetaConnected(null) })
    return () => { cancelled = true }
  }, [canLaunch, activeBrandId])
  const playbook = brief.items.find(i => i.kind === 'market_playbook' && i.playbook) || null
  const metaAds = brief.items.find(i => i.kind === 'meta_ads' && i.metaAudit) || null
  const hero = brief.headline || brief.items.find(i => i.kind !== 'market_playbook' && i.kind !== 'meta_ads') || null
  const competitors = brief.items.filter(i => i.kind === 'competitor_ads').slice(0, 4)
  const second = brief.items.find(i => i !== hero && i.kind !== 'competitor_ads' && i.kind !== 'market_playbook' && i.kind !== 'meta_ads') || null
  const worked = ago(brief.lastCycleAt)
  const stateWord = brief.quiet ? 'Resting' : melloState === 'delivered' ? 'Delivered' : 'Awake'

  return (
    <div className="bsx" style={{ marginTop: 20 }}>
      {/* ── ARRIVAL — the brief doesn't "load", it was PREPARED. One calm sequence: the status row
          states the night's work → the hero settles into place → the rest of the desk follows → the
          sidebar last. Pure CSS (runs without JS, honors prefers-reduced-motion); ~1s total, nothing
          blocks interaction, and every element is in the HTML from the first byte. ── */}
      {/* ── Thin status row — what the dark strip used to shout, said quietly. ── */}
      <div className="bsx-e" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 13, color: MUTED, paddingBottom: 22 }}>
        {worked && <><span>Updated {worked}</span><span style={{ color: '#d3d6cf' }}>·</span></>}
        <span><b style={{ color: INK, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{brief.summary.brandsWatched}</b> competitor{brief.summary.brandsWatched === 1 ? '' : 's'} tracked</span>
        <span style={{ color: '#d3d6cf' }}>·</span>
        <span><b style={{ color: INK, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}><Count n={brief.summary.adsScanned} /></b> ads read overnight</span>
        {brief.summary.creativesReady > 0 && <><span style={{ color: '#d3d6cf' }}>·</span><span><b style={{ color: GREEN, fontWeight: 700 }}>{brief.summary.creativesReady}</b> creative{brief.summary.creativesReady === 1 ? '' : 's'} ready</span></>}
      </div>

      <div className="bsx-grid bsx-dim">
        {/* ════ LEFT — the workspace. Everything that answers "what should I do next?" ════ */}
        <div style={{ minWidth: 0 }}>

          {/* ── The Morning Standup — one line from each department, the way you'd hear it walking in. ── */}
          <StandupCard key={`standup-${activeBrandId || 'all'}`} brandId={activeBrandId} />

          {/* ── The hero card — the one focal point. It GROWS gently into place; nothing competes. ── */}
          <div className="bsx-hero" style={{ ...card, borderRadius: 20, boxShadow: '0 1px 3px rgba(17,24,17,.05), 0 24px 60px -24px rgba(17,24,17,.18)', padding: 'clamp(24px, 3vw, 36px)', marginBottom: 24 }}>
            {brief.quiet || !hero ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                  <MelloFace size={24} state={melloState} />
                  <span style={{ fontSize: 13, fontWeight: 650, color: MUTED }}>Mello&rsquo;s call today</span>
                </div>
                <div style={{ fontSize: 'clamp(22px, 2.4vw, 28px)', fontWeight: 800, letterSpacing: '-.025em', color: INK, lineHeight: 1.15 }}>Nothing needs you today.</div>
                <p style={{ ...body, marginTop: 10, maxWidth: 520 }}>Routine rotation only — my honest read is don&rsquo;t spend. I&rsquo;ll break the quiet the moment something moves.</p>
              </>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                  <MelloFace size={24} state={melloState} />
                  <span style={{ fontSize: 13, fontWeight: 650, color: MUTED }}>Highest priority</span>
                  {hero.forBrand && <span style={{ fontSize: 12, fontWeight: 700, color: GREEN, background: '#eef6e4', borderRadius: 100, padding: '2px 10px' }}>for {hero.forBrand}</span>}
                </div>
                <div style={{ fontSize: 'clamp(22px, 2.4vw, 28px)', fontWeight: 800, letterSpacing: '-.025em', color: INK, lineHeight: 1.18, textWrap: 'balance' as any }}>
                  {hero.title.replace(/\.+$/, '')}
                </div>
                {(hero.why || hero.body) && <p style={{ ...body, marginTop: 10, maxWidth: 560 }}>{hero.why || hero.body}</p>}
                {/* the work itself — a document shows the rival's real ads; a creative shows its shot */}
                {hero.media && hero.media.length > 1 ? (
                  <div style={{ marginTop: 18, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    {hero.media.slice(0, 4).map((m, i) => (
                      <Shot key={i} image={m.image} videoUrl={m.videoUrl} w={96} h={120} />
                    ))}
                  </div>
                ) : (hero.thumbs?.[0] || hero.media?.[0]) ? (
                  <div style={{ marginTop: 18 }}>
                    <Shot image={hero.thumbs?.[0] || hero.media?.[0]?.image} videoUrl={hero.media?.[0]?.videoUrl} w={140} h={175} />
                  </div>
                ) : null}
                <div style={{ marginTop: 22, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                  {hero.cta_href && (
                    <Link href={hero.cta_href} onClick={() => onAct(hero)}
                      style={{ background: '#ef4a1e', color: '#fff', borderRadius: 100, padding: '13px 26px', fontSize: 14.5, fontWeight: 800, textDecoration: 'none', letterSpacing: '-.01em' }}>
                      {hero.cta_label || 'Review & approve'} →
                    </Link>
                  )}
                  <button onClick={() => onWhy(hero)} style={{ background: 'none', border: 'none', color: MUTED, fontSize: 13.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>Why this?</button>
                </div>
              </>
            )}
          </div>

          {/* ── Mello's plan — decisions ready to run (the CEO desk). ── */}
          <div className="bsx-e" style={{ animationDelay: '.3s' }}>
            <MelloTasks key={`tasks-${activeBrandId || 'all'}`} brandId={activeBrandId} />
          </div>

          {/* ── Facebook Ads — the money card (its own component: account switcher + spend today, fetched
              live). When connected + audited, show it; otherwise the connect-and-run promo. ── */}
          {metaAds?.metaAudit ? (
            // The audit CTA ALWAYS opens Reports (the full overnight debrief) — never M4. A stale
            // brief_event can still carry an old '/m4' href, so we pin it here.
            <FacebookAdsCard initial={metaAds.metaAudit as any} ctaHref="/reports" ctaLabel="See the full report" onAct={() => onAct(metaAds)} onAccountChange={(acctId) => setAcctScope(acctId)} brandId={activeBrandId} brandName={activeBrandName} />
          ) : (
            <div className="bsx-e" style={{ ...card, background: FOREST, padding: '20px 24px', marginBottom: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', animationDelay: '.34s' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 16.5, fontWeight: 800, letterSpacing: '-.015em', color: '#fff', lineHeight: 1.3 }}>{canLaunch && metaConnected === false ? 'Connect Meta to run your ads' : 'Run your ads on Meta'}</div>
                <div style={{ fontSize: 13.5, color: '#b8c4b4', lineHeight: 1.5, marginTop: 3 }}>{
                  !canLaunch ? 'Connecting a Meta ad account is a Creator feature — upgrade to launch, scale and get the morning audit.'
                  : metaConnected === false ? 'Connect your Meta ad account (60 seconds) — then Mello audits your campaigns every morning and tells you exactly what to scale or pause.'
                  : 'Launch, scale, and manage campaigns from here — Mello audits them every morning.'
                }</div>
              </div>
              {/* State-true CTA: Free → upgrade; Creator + not connected → connect; Creator + connected → run. */}
              <Link href={!canLaunch ? '/billing' : metaConnected === false ? '/connect/meta' : '/m4'} style={{ flexShrink: 0, background: '#ef4a1e', color: '#fff', borderRadius: 100, padding: '11px 22px', fontSize: 14, fontWeight: 800, textDecoration: 'none', whiteSpace: 'nowrap' }}>{!canLaunch ? 'Upgrade to Creator →' : metaConnected === false ? 'Connect Meta →' : 'Run ads →'}</Link>
            </div>
          )}

          {/* ── What Mello would do — ranked action cards. Pre-computed nightly (stored in the audit
              payload) so they auto-show with ZERO live calls; refresh pulls the latest on demand. ── */}
          <BriefOpportunities initial={metaAds?.metaAudit?.opportunities as any} accountId={acctScope} initialAccountId={(metaAds?.metaAudit as any)?.selected || null} scaleCampaign={(metaAds?.metaAudit as any)?.scale?.[0] || null} currency={(metaAds?.metaAudit as any)?.currency || 'USD'} />

          {/* ── Rivals' winning ad — competitor intelligence, a SEPARATE card from the own-account
              moves above (agreed split: account numbers never mix with rival inference). ── */}
          {/* key={brand} → full remount on brand switch, so a card can NEVER show the previous brand's
              data while the new brand loads (the recurring "Mars Men under Aura" stale-on-switch). */}
          <CompetitorCard key={`comp-${activeBrandId || 'all'}`} brandId={activeBrandId} />

          {/* ── What to make next — the Creative Strategist fuses your ad performance (winners + fatigue)
              with rivals' winning angles into concrete ideas, one click into the Studio. Self-hides on
              an empty account. ── */}
          <CreativeStrategistCard key={`strat-${activeBrandId || 'all'}`} brandId={activeBrandId} />

          {/* ── Brand Guardian — the defensive watch: rivals launching new ads (our crawl) + public
              chatter about you / shoppers leaving rivals (Reddit). Self-hides when quiet. ── */}
          <BrandGuardianCard key={`guard-${activeBrandId || 'all'}`} brandId={activeBrandId} />

          {/* ── Also today — the one runner-up, a quiet row. ── */}
          {second && (
            <div className="bsx-e" style={{ ...card, padding: '16px 22px', marginBottom: 24, animationDelay: '.38s' }}>
              <Link href={second.cta_href || '/discovery'} onClick={() => onAct(second)} className="bsx-row" style={{ display: 'block', textDecoration: 'none' }}>
                <span style={{ float: 'right', marginLeft: 10, marginTop: 4 }}>{ARROW}</span>
                <span className="bsx-t" style={{ display: 'block', fontSize: 15.5, fontWeight: 700, letterSpacing: '-.012em', color: INK, lineHeight: 1.35, transition: 'color .15s' }}>{second.title.replace(/\.+$/, '')}</span>
                <span style={{ display: 'block', fontSize: 13.5, color: MUTED, lineHeight: 1.5, marginTop: 2 }}>{second.why || second.body || 'Worth a look today.'}</span>
              </Link>
            </div>
          )}

          {/* ── Competitors — who moved overnight, as living rows that slide into place. ── */}
          <div className="bsx-e" style={{ marginTop: 32, animationDelay: '.46s' }}>
            <div style={section}>Competitors overnight</div>
            <div style={sectionSub}>
              {competitors.length === 0
                ? (brief.summary.brandsWatched === 0
                    ? (activeBrandName ? `You're not watching anyone for ${activeBrandName} yet.` : `You're not watching any competitors yet.`)
                    : 'No new launches in the last 48 hours.')
                : 'What they shipped while you slept.'}
            </div>

            {competitors.length > 0 && (
              <div style={{ ...card, padding: '6px 22px' }}>
                {competitors.map((c, i) => {
                  const name = c.title.replace(/\s+launched.*$/i, '').replace(/[.:]$/, '')
                  const activity = (c.title.match(/launched.*/i)?.[0] || 'New activity').replace(/\.$/, '')
                  const when = ago(c.at)
                  const fresh = c.at ? (Date.now() - new Date(c.at).getTime()) < 24 * 3600e3 : false
                  return (
                    <div key={c.id || i} className="bsx-e" style={{ borderTop: i === 0 ? 'none' : `1px solid ${LINE}`, padding: '15px 0', animationDelay: `${0.52 + i * 0.08}s` }}>
                      <Link href={c.cta_href?.replace('/knowledge/brand/', '/discovery/brand-spy/') || c.cta_href || '/discovery'}
                        onClick={() => onAct(c)} className="bsx-row" style={{ display: 'flex', alignItems: 'center', gap: 14, textDecoration: 'none' }}>
                        {/* brand mark — initial avatar; the ad previews are the real face */}
                        <span style={{ position: 'relative', flexShrink: 0 }}>
                          <span style={{ width: 40, height: 40, borderRadius: 12, background: '#ef4a1e', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 16, fontWeight: 800 }}>{name.charAt(0).toUpperCase()}</span>
                          {fresh && <span className="bsx-dot" title="Active in the last 24h" style={{ position: 'absolute', right: -2, top: -2, width: 10, height: 10, borderRadius: '50%', background: GREEN, border: '2px solid #fff' }} />}
                        </span>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span className="bsx-t" style={{ display: 'block', fontSize: 15.5, fontWeight: 700, letterSpacing: '-.012em', color: INK, transition: 'color .15s', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                          <span style={{ display: 'block', fontSize: 13, color: MUTED, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {activity}{when ? ` · ${when}` : ''}{c.forBrand ? ` · for ${c.forBrand}` : ''}
                          </span>
                        </span>
                        {/* what they actually launched */}
                        {!!c.media?.length && (
                          <span className="bsx-shots" style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                            {c.media.slice(0, 3).map((m, k) => (
                              <Shot key={k} image={m.image} videoUrl={m.videoUrl} w={42} h={53} />
                            ))}
                          </span>
                        )}
                        {ARROW}
                      </Link>
                    </div>
                  )
                })}
              </div>
            )}

            {onAddCompetitor && (
              competitors.length === 0 && brief.summary.brandsWatched === 0
                ? (
                  <button onClick={onAddCompetitor}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#ef4a1e', color: '#fff', border: 'none', borderRadius: 100, padding: '11px 20px', fontSize: 13.5, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>
                    + Add a competitor{activeBrandName ? ` for ${activeBrandName}` : ''}
                  </button>
                )
                : (
                  <button onClick={onAddCompetitor}
                    style={{ marginTop: 14, background: 'none', border: 'none', color: GREEN, fontSize: 13, fontWeight: 750, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
                    + Add a competitor{activeBrandName ? ` for ${activeBrandName}` : ''}
                  </button>
                )
            )}
            {/* Free plan tracks 1 competitor — nudge to upgrade to watch more, right where rivals live. */}
            {!isPaid && brief.summary.brandsWatched >= 1 && (
              <div style={{ marginTop: 10, fontSize: 12.5, color: MUTED }}>
                Free tracks <b style={{ color: INK }}>1 competitor</b>.{' '}
                {onGoFullTime
                  ? <button onClick={onGoFullTime} style={{ background: 'none', border: 'none', color: GREEN, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>Upgrade to watch them all →</button>
                  : <Link href="/billing" style={{ color: GREEN, fontWeight: 800, textDecoration: 'none' }}>Upgrade to watch them all →</Link>}
              </div>
            )}
            {/* Confirmation + progress: which competitors are being watched and whether their ads have loaded.
              This live-fetches the real per-brand list and is the SOURCE OF TRUTH for the watched count —
              the subtext above keys on the (assembled-once) brief.summary which can lag it. */}
            <WatchingCompetitors key={`watch-${activeBrandId || 'all'}`} brandId={activeBrandId} brandName={activeBrandName} />
          </div>

          {/* ── The playbook — what's working across every watched brand, with Mello's judgment. ── */}
          {playbook?.playbook && (
            <div className="bsx-e" style={{ marginTop: 40, animationDelay: '.6s' }}>
              <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
                <div>
                  <div style={section}>What&rsquo;s working across your {playbook.playbook.brandsCount} competitor{playbook.playbook.brandsCount === 1 ? '' : 's'}</div>
                  <div style={{ ...sectionSub, margin: 0 }}>Decoded from {playbook.playbook.totalAds} fresh ads — the formula to copy before it saturates.</div>
                </div>
                {/* "Make one like this" → Studio with the winning formula pre-seeded as the angle, so Mello
                    starts MAKING the ad (right format/hook/offer) instead of dropping the founder on a plain
                    followed-brands list that read as "why am I on a feed?". The label promises an ad. */}
                <Link href={`${playbook.cta_href || '/studio'}?angle=${encodeURIComponent(
                  'An ad like top competitors right now — ' +
                  ([playbook.playbook.formats[0]?.label && `${playbook.playbook.formats[0]?.label} format`,
                    playbook.playbook.hooks[0]?.label && `${playbook.playbook.hooks[0]?.label} hook`,
                    playbook.playbook.offers[0]?.label && `${playbook.playbook.offers[0]?.label} offer`].filter(Boolean).join(', ')
                    || `the winning formula across your ${playbook.playbook.brandsCount} competitors`)
                )}`} onClick={() => onAct(playbook)}
                  style={{ background: '#ef4a1e', color: '#fff', borderRadius: 100, padding: '10px 18px', fontSize: 13, fontWeight: 800, textDecoration: 'none', whiteSpace: 'nowrap' }}>
                  Make one like this →
                </Link>
              </div>

              {/* Plain-English insight FIRST — the whole playbook in one sentence, before any numbers. */}
              {(() => {
                const p = playbook.playbook!
                const topFmt = p.formats[0]?.label, topHook = p.hooks[0]?.label, topOffer = p.offers[0]?.label, topEmo = p.emotions[0]?.label
                const bold: React.CSSProperties = { fontWeight: 600 }
                return (
                  <div style={{ ...card, padding: '20px 24px', marginTop: 16 }}>
                    <div style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 21, color: INK, lineHeight: 1.4, letterSpacing: '-.005em' }}>
                      The winning formula right now: a <b style={bold}>{p.videoPct >= 50 ? 'video' : 'graphic'}</b> ad{topFmt ? <>, <b style={bold}>{topFmt}</b> style</> : ''}{topHook ? <>, opening on a <b style={bold}>“{topHook}”</b> hook</> : ''}{topOffer ? <>, with a <b style={bold}>{topOffer}</b> offer</> : ''}{topEmo ? <> — built to trigger <b style={bold}>{topEmo}</b></> : ''}.
                    </div>
                  </div>
                )
              })()}

              {playbook.playbook.judgment && (() => {
                const j = playbook.playbook.judgment!
                const tone = j.verdict === 'Adopt' ? { bg: '#eef7d6', fg: '#3f6a1e', dot: GREEN } : j.verdict === 'Test' ? { bg: '#fdf3d9', fg: '#8a6a12', dot: '#c99a1e' } : { bg: '#eef1ec', fg: '#5c6a5a', dot: '#9aa79a' }
                return (
                  <div style={{ ...card, padding: '20px 24px', marginTop: 18 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 26, alignItems: 'flex-start' }}>
                      <div style={{ flex: '2 1 240px', minWidth: 220 }}>
                        <div style={{ fontSize: 13, fontWeight: 650, color: MUTED, marginBottom: 6 }}>Mello&rsquo;s call</div>
                        <div style={{ fontSize: 18, fontWeight: 750, letterSpacing: '-.018em', color: INK, lineHeight: 1.3 }}>{j.winner}</div>
                        <div style={{ fontSize: 13, color: MUTED, marginTop: 4 }}>The one pattern to copy across the set.</div>
                      </div>
                      <div style={{ flex: '1 1 130px', minWidth: 120 }}>
                        <div style={{ fontSize: 13, fontWeight: 650, color: MUTED, marginBottom: 6 }}>Confidence</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: tone.dot, display: 'inline-block' }} />
                          <span style={{ fontSize: 15, fontWeight: 800, color: INK }}>{j.confidence}</span>
                        </div>
                        <div style={{ fontSize: 13, color: MUTED, marginTop: 4, lineHeight: 1.5 }}>{j.confidenceWhy}</div>
                      </div>
                      <div style={{ flex: '1 1 150px', minWidth: 140 }}>
                        <div style={{ fontSize: 13, fontWeight: 650, color: MUTED, marginBottom: 6 }}>Should you use it</div>
                        <div style={{ display: 'inline-block', background: tone.bg, color: tone.fg, borderRadius: 100, padding: '3px 11px', fontSize: 12.5, fontWeight: 800 }}>{j.verdict}</div>
                        <div style={{ fontSize: 13, color: MUTED, marginTop: 6, lineHeight: 1.5 }}>{j.verdictWhy}</div>
                      </div>
                    </div>
                  </div>
                )
              })()}

              {/* Visual bars — ranked, share-of-ads, so it reads at a glance instead of raw counts. */}
              {(() => {
                const p = playbook.playbook!
                const pct = (n: number) => Math.round((n / Math.max(p.totalAds, 1)) * 100)
                const Bars = ({ title, rows, tone }: { title: string; rows: { label: string; count: number }[]; tone: string }) => {
                  const max = Math.max(...rows.map(r => r.count), 1)
                  return (
                    <div style={{ ...card, padding: '18px 20px' }}>
                      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: MUTED, marginBottom: 12 }}>{title}</div>
                      {rows.length ? rows.slice(0, 4).map((r, i) => (
                        <div key={r.label} style={{ marginBottom: 9 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 3 }}>
                            <span style={{ fontWeight: 700, color: INK, textTransform: 'capitalize', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>
                            <span style={{ color: MUTED, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{pct(r.count)}%</span>
                          </div>
                          <div style={{ height: 8, background: '#eef1ec', borderRadius: 100 }}><div style={{ height: '100%', width: `${Math.round((r.count / max) * 100)}%`, background: i === 0 ? tone : `${tone}99`, borderRadius: 100 }} /></div>
                        </div>
                      )) : <div style={{ fontSize: 13, color: MUTED }}>Still decoding.</div>}
                    </div>
                  )
                }
                return (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(260px,100%), 1fr))', gap: 14, marginTop: 14 }}>
                    <Bars title="How they hook you" rows={p.hooks} tone={GREEN} />
                    <Bars title="What they offer" rows={p.offers} tone="#b7791f" />
                  </div>
                )
              })()}
            </div>
          )}
        </div>

        {/* ════ RIGHT — the supporting sidebar. Mello, plan, capabilities. ════ */}
        {/* The sidebar arrives LAST and quietly — it must never beat the decision. */}
        <aside className="bsx-side bsx-e" style={{ animationDelay: '.7s' }}>
          {/* Mello — who's working for you */}
          <div style={{ ...card, padding: '20px 22px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <MelloFace size={44} state={melloState} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 750, letterSpacing: '-.015em', color: INK }}>{stateWord}</div>
                <div style={{ fontSize: 13, color: MUTED, lineHeight: 1.45 }}>
                  {brief.quiet ? 'Nothing needs you today.' : brief.summary.creativesReady > 0 ? `${brief.summary.creativesReady} creative${brief.summary.creativesReady === 1 ? '' : 's'} waiting on your call` : 'Watching your competitors.'}
                </div>
              </div>
            </div>
            {typeof credits === 'number' && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, color: MUTED, marginTop: 16, paddingTop: 14, borderTop: `1px solid ${LINE}` }}>
                <span>Credits</span><b style={{ color: INK, fontWeight: 750, fontVariantNumeric: 'tabular-nums' }}>{credits.toLocaleString()}</b>
              </div>
            )}
          </div>

          {/* Plan — free users see the hire card; paid see a quiet top-up */}
          {!isPaid && onGoFullTime && (
            <div style={{ ...card, padding: '20px 22px' }}>
              <div style={{ fontSize: 16, fontWeight: 750, letterSpacing: '-.015em', color: INK }}>Hire Mello full-time</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, margin: '6px 0 2px' }}>
                <span style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-.02em', color: INK }}>${perDay}</span>
                <span style={{ fontSize: 12.5, color: MUTED }}>/ day</span>
              </div>
              <div style={{ fontSize: 13, color: MUTED, lineHeight: 1.5, marginBottom: 14 }}>$49/mo, billed monthly · works while you sleep.</div>
              <button onClick={onGoFullTime} disabled={subscribing}
                style={{ width: '100%', background: '#ef4a1e', color: '#fff', border: 'none', borderRadius: 100, padding: '12px', fontSize: 13.5, fontWeight: 800, cursor: subscribing ? 'default' : 'pointer', fontFamily: 'inherit' }}>
                {subscribing ? 'Opening…' : 'Go full-time →'}
              </button>
              {/* "or buy credits" removed 2026-07-30 — pay-as-you-go is retired as a public offer. */}
            </div>
          )}
          {isPaid && onBuyCredits && (
            <div style={{ ...card, padding: '20px 22px' }}>
              <div style={{ fontSize: 16, fontWeight: 750, letterSpacing: '-.015em', color: INK }}>Need more this month?</div>
              <div style={{ fontSize: 13, color: MUTED, lineHeight: 1.5, margin: '4px 0 14px' }}>Top up credits — pay as you go, and they never expire.</div>
              <button onClick={onBuyCredits}
                style={{ width: '100%', background: '#ef4a1e', color: '#fff', border: 'none', borderRadius: 100, padding: '12px', fontSize: 13.5, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>
                Buy credits →
              </button>
            </div>
          )}

          {/* What Mello can do — the capability menu, always visible */}
          <div style={{ ...card, padding: '20px 22px' }}>
            <div style={{ fontSize: 16, fontWeight: 750, letterSpacing: '-.015em', color: INK, marginBottom: 14 }}>What Mello can do</div>
            <Row first href="/discovery" title="Remake a winner" desc="Their proven ad, rebuilt around your product." right={ARROW} />
            <Row href="/studio" title="Create a fresh ad" desc="An original, on-brand, from your product photos." right={ARROW} />
            <Row href="/discovery?format=Video" title="Make a UGC video" desc="A creator-style video, in your language." right={ARROW} />
            <Row href="/discovery/brand-spy" title="Spy on a competitor" desc="I'll watch every ad they launch." right={ARROW} />
            <Row href="/settings?tab=autopilot" title="Make ads for me daily" desc="Pick how many — delivered every morning."
              right={<span style={{ fontSize: 11, fontWeight: 750, color: FOREST, background: '#f2f8ea', border: `1px solid #a8cf6f`, borderRadius: 100, padding: '2px 9px' }}>Auto</span>} />

            {/* Finish setup — only the steps NOT done yet. A channel that's already connected drops off
                (it was still showing "Connect" after WhatsApp was linked). */}
            {(() => {
              // Founder WhatsApp intentionally omitted — briefs are Slack-only (a shared WhatsApp sender
              // loops and never notifies a self-send). WhatsApp stays a CUSTOMER channel (Inbox), not a
              // founder-brief line.
              // Calendar connect removed for now (adds too much test surface pre-users) — re-add later.
              const steps = [
                { p: 'slack', label: 'Get your brief on Slack' },
              ].filter(x => !connectedChannels.includes(x.p))
              if (!steps.length) return null
              return (
                <>
                  <div style={{ height: 1, background: LINE, margin: '14px 0 10px' }} />
                  <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: '#9aa79a', marginBottom: 4 }}>Finish setup</div>
                  {steps.map(x => (
                    <Link key={x.p} href="/settings?tab=channels" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', textDecoration: 'none' }}>
                      <span style={{ display: 'inline-flex', flexShrink: 0 }}><ChannelLogo provider={x.p} size={18} /></span>
                      <span style={{ fontSize: 13, fontWeight: 650, color: INK, flex: 1, minWidth: 0 }}>{x.label}</span>
                      <span style={{ fontSize: 12, fontWeight: 800, color: '#ef4a1e', whiteSpace: 'nowrap' }}>Connect →</span>
                    </Link>
                  ))}
                </>
              )
            })()}
          </div>
        </aside>
      </div>

      <style>{`
        /* ── Arrival choreography — pure enhancement. Content is in the HTML from the first byte
           (opacity starts at .001, never display:none); reduced-motion turns it all off. ── */
        .bsx-e{animation:bsxIn .65s cubic-bezier(.2,.7,.2,1) both}
        @keyframes bsxIn{from{opacity:.001;transform:translateY(12px)}to{opacity:1;transform:none}}
        /* The hero settles with a whisper of scale — "grows into place", never bounces. */
        .bsx-hero{animation:bsxHero .8s cubic-bezier(.2,.7,.2,1) both;animation-delay:.12s}
        @keyframes bsxHero{from{opacity:.001;transform:translateY(14px) scale(.985)}to{opacity:1;transform:none}}
        /* Live pulse on a competitor active in the last 24h — a heartbeat, not a strobe. */
        .bsx-dot{animation:bsxPulse 2.6s ease-in-out infinite}
        @keyframes bsxPulse{0%,100%{box-shadow:0 0 0 0 rgba(63,143,79,.45)}50%{box-shadow:0 0 0 4px rgba(63,143,79,0)}}
        /* Ask-Mello focus: when the composer is active, the desk recedes and the conversation leads. */
        .bsx-dim{transition:opacity .35s ease}
        body:has(.brief-composer textarea:focus) .bsx-dim{opacity:.55}
        @media (prefers-reduced-motion: reduce){.bsx-e,.bsx-hero,.bsx-dot{animation:none}.bsx-dim{transition:none}body:has(.brief-composer textarea:focus) .bsx-dim{opacity:1}}
        .bsx-grid{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:32px;align-items:start}
        .bsx-side{display:flex;flex-direction:column;gap:16px;position:sticky;top:20px}
        .bsx-row:hover .bsx-t{color:${GREEN}}
        .bsx-row:hover .bsx-a{color:${GREEN};transform:translateX(3px)}
        .bsx-pb{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
        .bsx-pb-c{padding:16px 18px;min-width:0}
        @media(max-width:1220px){.bsx-pb{grid-template-columns:repeat(2,1fr)}}
        @media(max-width:1059px){
          .bsx-grid{grid-template-columns:1fr}
          .bsx-side{position:static;margin-top:8px}
        }
        @media(max-width:640px){.bsx-shots{display:none!important}}
      `}</style>
    </div>
  )
}
