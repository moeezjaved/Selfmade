/**
 * DISCOVER · The Museum — seven rooms, not seven sections.
 * Art-direction pass: every viewport is its own composition — different scale,
 * rhythm, alignment, emotion — so scrolling feels like walking an exhibition, not
 * reading a page. Content, data, IA, typography and the finite ending are unchanged;
 * only the presentation varies. Each morning it should feel art-directed overnight —
 * except no human did it. Mello did.
 *
 * ISR revalidate 1800 → recomputes from the live corpus every 30 min; turns over daily.
 */
import type { Metadata } from 'next'
import Link from 'next/link'
import { computeEdition, editionNumber } from '@/lib/edition/compute'
import { getFeaturedPlaybooks, agoLabel } from '@/lib/playbooks/featured'
import ForYou from './ForYou'
import AdMedia from './AdMedia'
import Reveal from './Reveal'
import TrailRecorder from '@/components/knowledge/TrailRecorder'

export const revalidate = 1800

const INK = '#111514', MUTED = '#7a827c', FAINT = '#adb3ae', LINE = '#eef0ee', FOREST = '#17251c', LIME = '#dffe95', GREEN = '#2f7a3f', AMBER = '#9a3412'

const CSS = `
.disc-root{overflow-x:hidden}
.wrap{margin:0 auto;padding-left:26px;padding-right:26px}
.w-narrow{max-width:640px}.w-read{max-width:780px}.w-wide{max-width:1060px}.w-xwide{max-width:1200px}
.band{width:100vw;position:relative;left:50%;margin-left:-50vw;background:#faf9f7}
@media (prefers-color-scheme: dark){.band{background:#12160f}}

/* ── the exhibited creative ── */
.ad{position:relative;display:block;overflow:hidden;background:#20241f;border-radius:10px}
.admedia-scrim{position:absolute;inset:0;background:linear-gradient(160deg,rgba(255,255,255,.08),rgba(0,0,0,.16));pointer-events:none}
.admedia-play{position:absolute;right:8px;bottom:7px;z-index:2;font-size:10px;color:#fff;background:rgba(0,0,0,.42);border-radius:6px;padding:2px 7px;font-weight:800;letter-spacing:.04em}
.admedia-badge{position:absolute;left:8px;top:8px;z-index:2;font-size:9px;color:${LIME};background:#17251cd9;border-radius:7px;padding:3px 8px;font-weight:800}
.lift{transition:transform .35s cubic-bezier(.2,.7,.2,1),box-shadow .35s ease}
.lift:hover{transform:translateY(-4px)}

/* ROOM 2 · HERO — dominant creative beside the copy, then a masonry surrounds it */
.hero-lead{display:grid;grid-template-columns:minmax(0,0.9fr) minmax(0,1.1fr);gap:34px;align-items:center}
.hero-dom{aspect-ratio:4/5;border-radius:16px;box-shadow:0 40px 80px -46px rgba(10,20,12,.55)}
.hero-rest{column-count:4;column-gap:10px;margin-top:16px}
.hero-rest .ad{width:100%;margin-bottom:10px;aspect-ratio:4/5;break-inside:avoid}
.hero-rest .ad:nth-child(3n){aspect-ratio:1/1}
.hero-rest .ad:nth-child(4n){aspect-ratio:9/16}
.hero-rest .ad:nth-child(5n){aspect-ratio:16/11}
@media(max-width:760px){.hero-lead{grid-template-columns:1fr;gap:18px}.hero-rest{column-count:2}}

/* ROOM 3 · WHAT CHANGED — horizontal film strips */
.filmstrip{display:flex;gap:9px;overflow-x:auto;scroll-snap-type:x mandatory;padding:13px 0;border-top:1px solid ${LINE};border-bottom:1px solid ${LINE};scrollbar-width:none}
.filmstrip::-webkit-scrollbar{display:none}
.filmstrip .ad{flex:0 0 auto;width:150px;aspect-ratio:4/5;scroll-snap-align:start}

/* ROOM 4 · SWARM — density, emotional volume, a fade that says "there's more" */
.swarm2{display:grid;grid-template-columns:repeat(auto-fill,minmax(46px,1fr));gap:3px;-webkit-mask-image:linear-gradient(180deg,#000 78%,transparent);mask-image:linear-gradient(180deg,#000 78%,transparent)}
.swarm2 .cell{position:relative;aspect-ratio:1;border-radius:4px;overflow:hidden;background:#20241f}
.swarm2 .cell img{width:100%;height:100%;object-fit:cover;display:block}
.swarm2 .cell:nth-child(9n){grid-column:span 2;grid-row:span 2}
.swarm2 .cell:nth-child(13n){grid-column:span 2;grid-row:span 2;outline:3px solid ${LIME};outline-offset:-3px;z-index:2}

/* ROOM 5 · WORTH EXPLORING — Spotify-scale album covers */
.albums2{display:grid;grid-template-columns:1fr 1fr;gap:26px}
.album2{border-radius:18px;overflow:hidden;background:#fff;text-decoration:none;color:${INK};display:block;box-shadow:0 34px 70px -40px rgba(10,20,12,.5);border:1px solid ${LINE}}
@media (prefers-color-scheme: dark){.album2{background:#161c18}}
.album2 .cover{display:grid;grid-template-columns:2fr 1fr 1fr;grid-auto-rows:96px;gap:4px;padding:4px}
.album2 .cover span{position:relative;overflow:hidden;border-radius:8px;background:#20241f;display:block}
.album2 .cover span:first-child{grid-row:span 2}
.album2 .cover span img{width:100%;height:100%;object-fit:cover;display:block}
.album2 .meta{padding:18px 22px 20px}
.album2 .meta b{font-size:19px;font-weight:800;letter-spacing:-.017em;display:block;line-height:1.25}
.album2 .meta em{font-size:12.5px;color:${MUTED};font-weight:600;font-style:normal;display:block;margin-top:5px}
@media(max-width:760px){.albums2{grid-template-columns:1fr;gap:18px}.album2 .cover{grid-auto-rows:80px}}

/* ROOM 6 · OPEN QUESTION — the emotional room, a dramatic face-off */
.faceoff{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:20px}
.faceoff .ad{aspect-ratio:3/4;border-radius:14px;box-shadow:0 40px 80px -50px rgba(10,20,12,.6)}
.faceoff .vs{font-size:30px;font-weight:800;letter-spacing:-.03em;color:${FAINT}}
@media(max-width:760px){.faceoff{grid-template-columns:1fr 1fr;gap:10px}.faceoff .vs{grid-column:span 2;order:-1;font-size:22px}}

/* ROOM 7 · MELLO'S WATCH — typography-forward, almost no imagery */
.watch{display:grid;grid-template-columns:1fr 168px;gap:30px;align-items:center}
.watch .sup{aspect-ratio:4/5;border-radius:12px;box-shadow:0 30px 60px -40px rgba(10,20,12,.5)}
@media(max-width:640px){.watch{grid-template-columns:1fr}.watch .sup{max-width:200px}}

/* motion — fail-open: only armed once JS runs */
.rv-armed{opacity:0;transform:translateY(14px);transition:opacity .8s cubic-bezier(.2,.7,.2,1),transform .8s cubic-bezier(.2,.7,.2,1)}
.rv-armed.rv-in{opacity:1;transform:none}
@media (prefers-reduced-motion: reduce){.rv-armed{opacity:1!important;transform:none!important}.lift:hover{transform:none}}
`

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: `Today's Market Intelligence — Edition №${editionNumber()} | Selfmade Discover`,
    description: 'What changed in the ad market overnight, shown as the ads themselves — art-directed nightly by Mello from the live marketing knowledge graph.',
    alternates: { canonical: '/discover' },
  }
}

// eyebrow label shared across rooms — same type system, different room each time
const Eyebrow = ({ children, color = FAINT }: { children: React.ReactNode; color?: string }) => (
  <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.16em', textTransform: 'uppercase', color }}>{children}</div>
)

export default async function DiscoverPage() {
  const [ed, playbooks] = await Promise.all([computeEdition(), getFeaturedPlaybooks({ featuredOnly: true, limit: 8 })])
  const isLead = (m: any) => ed.lead && m.kind === ed.lead.kind && m.name === ed.lead.name
  const strips = ed.movers.filter((m) => m.kind !== 'BRAND' && !isLead(m))
  const brands = ed.movers.filter((m) => m.kind === 'BRAND' && !isLead(m))
  const leadHasWall = !!(ed.lead && ed.lead.media.length >= 3)
  // Room 7 — a light momentum-watch derived from the strongest rising concept (honest
  // extrapolation, graded by time; NOT the parked Ledger predictions engine).
  const watch = ed.movers.find((m) => m.kind !== 'BRAND' && m.dir === 'up' && m.media.length && !isLead(m))
    || (ed.lead && ed.lead.kind !== 'BRAND' && ed.lead.dir === 'up' && ed.lead.media.length ? ed.lead : null)
  const watchConf = watch ? Math.min(85, 55 + Math.round(((watch.now - watch.prev) / Math.max(1, watch.prev)) * 24)) : 0
  const resolveBy = new Date(Date.now() + 14 * 86400e3).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })

  return (
    <div className="disc-root" style={{ minHeight: '100vh', background: '#fff', fontFamily: "'Inter', -apple-system, sans-serif", color: INK }}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <TrailRecorder node="edition" />
      <Reveal />

      {/* whisper-quiet entrance */}
      <div className="wrap w-wide" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 26px' }}>
        <Link href="/" style={{ fontWeight: 850, fontSize: 17, letterSpacing: '-.02em', color: INK, textDecoration: 'none' }}>Selfmade</Link>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <Link href="/search" style={{ fontSize: 12.5, color: MUTED, textDecoration: 'none', border: `1px solid ${LINE}`, borderRadius: 100, padding: '7px 16px', fontWeight: 600 }}>Search knowledge…</Link>
          <Link href="/brief" style={{ fontSize: 12.5, fontWeight: 800, color: INK, textDecoration: 'none' }}>Open app →</Link>
        </div>
      </div>

      {/* ══ ROOM 1 · MORNING NOTE — opening the newspaper. Narrow, airy, nothing competes. ══ */}
      <section data-reveal className="wrap w-narrow" style={{ padding: '70px 26px 20px' }}>
        <Eyebrow>{ed.dateLabel} · Edition №{ed.no}</Eyebrow>
        <div style={{ fontSize: 'clamp(19px,2.6vw,23px)', lineHeight: 1.62, color: '#31382f', maxWidth: '26ch', marginTop: 20, fontWeight: 450, letterSpacing: '-.01em' }}>
          Good morning. I read <b style={{ color: INK, fontWeight: 700 }}>{ed.adsRead.toLocaleString()} new ads</b> from {ed.brandsTouched.toLocaleString()} brands {ed.windowLabel}. Most of it was noise. These weren&rsquo;t.
        </div>
        <div style={{ fontFamily: "'Snell Roundhand','Segoe Script',cursive", fontSize: 26, color: '#232b24', marginTop: 14 }}>— Mello</div>
        <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', marginTop: 26, fontSize: 12.5, fontWeight: 700, color: MUTED }}>
          <span><b style={{ color: INK, fontVariantNumeric: 'tabular-nums' }}>{ed.contents.changed}</b> things changed</span>
          {ed.contents.collections > 0 && <span><b style={{ color: INK, fontVariantNumeric: 'tabular-nums' }}>{ed.contents.collections}</b> collections</span>}
          {ed.contents.questions > 0 && <span><b style={{ color: INK }}>1</b> open question</span>}
        </div>
        <ForYou />
      </section>

      {/* ══ RECOMMENDED BY MELLO — the playbooks shelf, the doorway into the workflow ══ */}
      {playbooks.length > 0 && (
        <section data-reveal className="wrap w-wide" style={{ padding: '52px 26px 8px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 16 }}>
            <Eyebrow color={GREEN}>Recommended by Mello</Eyebrow>
            <Link href="/playbooks" style={{ fontSize: 12.5, color: MUTED, fontWeight: 700, textDecoration: 'none', marginLeft: 'auto' }}>All playbooks →</Link>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 20 }}>
            {playbooks.map((p) => (
              <Link key={p.id} href={`/playbooks/${p.slug}`} style={{ display: 'block', textDecoration: 'none', color: INK, borderRadius: 16, overflow: 'hidden', border: `1px solid ${LINE}`, background: '#fff', boxShadow: '0 30px 60px -44px rgba(10,20,12,.5)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gridAutoRows: 78, gap: 3, padding: 3 }}>
                  {p.covers.slice(0, 5).map((u, i) => (
                    <span key={i} style={{ position: 'relative', overflow: 'hidden', borderRadius: 7, background: '#20241f', display: 'block', gridRow: i === 0 ? 'span 2' : undefined }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={u} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    </span>
                  ))}
                </div>
                <div style={{ padding: '13px 16px 15px' }}>
                  <div style={{ fontSize: 16.5, fontWeight: 800, letterSpacing: '-.017em' }}>{p.emoji ? `${p.emoji} ` : ''}{p.title}</div>
                  <div style={{ fontSize: 12, color: MUTED, fontWeight: 650, marginTop: 3 }}>{p.count} winning ads · {agoLabel(p.updated_at).replace('updated ', '')}</div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ══ ROOM 2 · HERO EXHIBITION — dominant creative beside a towering headline, masonry surrounds ══ */}
      {ed.lead && (
        <section data-reveal className="wrap w-wide" style={{ padding: '64px 26px 30px' }}>
          {leadHasWall ? (
            <>
              <div className="hero-lead">
                <AdMedia img={ed.lead.media[0].img} video={ed.lead.media[0].video} href={ed.lead.href} className="hero-dom lift" />
                <div>
                  <Eyebrow color={ed.lead.dir === 'up' ? GREEN : AMBER}>
                    {ed.lead.kind === 'BRAND' ? `Today’s lead · ${ed.lead.now} ads in 48 hours` : `Today’s lead · what’s ${ed.lead.dir === 'up' ? 'rising' : 'fading'}`}
                  </Eyebrow>
                  <h1 style={{ fontSize: 'clamp(34px,5.4vw,58px)', fontWeight: 800, letterSpacing: '-.035em', lineHeight: 1.02, margin: '12px 0 16px', maxWidth: '13ch' }}>
                    {ed.lead.kind === 'BRAND' ? `${ed.lead.name} exploded overnight.` : `${ed.lead.name} ${ed.lead.dir === 'up' ? 'is accelerating.' : 'is cooling off.'}`}
                  </h1>
                  <p style={{ fontSize: 15.5, lineHeight: 1.62, color: '#3a423c', maxWidth: '46ch' }}>{ed.leadBody}</p>
                  <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap', marginTop: 16 }}>
                    <Link href={ed.lead.href} style={{ fontSize: 13.5, fontWeight: 800, color: INK, textDecoration: 'none', borderBottom: `2px solid ${LIME}`, paddingBottom: 2 }}>
                      Walk through all {ed.lead.now} ads →
                    </Link>
                    <Link href="/brief" style={{ fontSize: 12.5, fontWeight: 700, color: MUTED, textDecoration: 'none' }}>Ask Mello how your brand can use this</Link>
                  </div>
                </div>
              </div>
              {ed.lead.media.length > 1 && (
                <div className="hero-rest">
                  {ed.lead.media.slice(1, 13).map((m, i) => <AdMedia key={i} img={m.img} video={m.video} href={ed.lead!.href} />)}
                </div>
              )}
            </>
          ) : (
            // graceful degrade — no wall of media, keep the headline + caption
            <div style={{ maxWidth: 640 }}>
              <Eyebrow color={ed.lead.dir === 'up' ? GREEN : AMBER}>Today’s lead</Eyebrow>
              <h1 style={{ fontSize: 'clamp(30px,5vw,46px)', fontWeight: 800, letterSpacing: '-.032em', lineHeight: 1.05, margin: '12px 0 10px' }}>
                {ed.lead.name} {ed.lead.dir === 'up' ? 'is accelerating.' : 'is cooling off.'}
              </h1>
              <p style={{ fontSize: 15.5, lineHeight: 1.6, color: '#3a423c', maxWidth: '52ch' }}>{ed.leadBody}</p>
              <Link href={ed.lead.href} style={{ display: 'inline-block', marginTop: 14, fontSize: 13.5, fontWeight: 800, color: INK, textDecoration: 'none', borderBottom: `2px solid ${LIME}`, paddingBottom: 2 }}>Open the evidence →</Link>
            </div>
          )}
        </section>
      )}

      {/* ══ ROOM 3 · WHAT CHANGED — film strips, frames from a movie ══ */}
      {strips.length > 0 && (
        <section data-reveal className="wrap w-wide" style={{ padding: '48px 26px 20px' }}>
          <Eyebrow>What changed {ed.windowLabel === 'overnight' ? 'overnight' : 'this week'}</Eyebrow>
          {strips.map((m) => (
            <div key={`${m.kind}:${m.name}`} style={{ marginTop: 30 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 2 }}>
                <span style={{ fontSize: 18, fontWeight: 750, letterSpacing: '-.014em' }}>{m.name} {m.dir === 'up' ? 'is on the rise.' : 'is losing ground.'}</span>
                <span style={{ fontSize: 9.5, fontWeight: 900, letterSpacing: '.1em', color: m.dir === 'up' ? GREEN : AMBER, border: `1px solid ${m.dir === 'up' ? '#cfe9a4' : '#f0d3c0'}`, borderRadius: 100, padding: '3px 9px' }}>{m.kind} · {m.dir === 'up' ? 'RISING' : 'COOLING'}</span>
                <Link href={m.href} style={{ fontSize: 12, color: MUTED, fontWeight: 700, textDecoration: 'none', marginLeft: 'auto' }}>{m.dir === 'up' ? 'the newest' : 'the holdouts'} →</Link>
              </div>
              {m.media.length >= 3
                ? <div className="filmstrip">{m.media.slice(0, 14).map((mm, i) => <AdMedia key={i} img={mm.img} video={mm.video} href={m.href} />)}</div>
                : <div style={{ fontSize: 12.5, color: MUTED, fontWeight: 600, marginTop: 6 }}>{m.why}</div>}
            </div>
          ))}
        </section>
      )}

      {/* ══ ROOM 4 · BRAND SWARMS — full-bleed density, volume you FEEL ══ */}
      {brands.length > 0 && (
        <div className="band" data-reveal style={{ marginTop: 44 }}>
          <section className="wrap w-xwide" style={{ padding: '56px 26px 60px' }}>
            <Eyebrow>Someone made a move</Eyebrow>
            {brands.map((m) => (
              <div key={`brand:${m.pid}`} style={{ marginTop: 26 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
                  <span style={{ fontSize: 'clamp(20px,2.6vw,26px)', fontWeight: 800, letterSpacing: '-.02em' }}>{m.name} launched {m.now} ads in 48 hours.</span>
                  <Link href={m.href} style={{ fontSize: 12.5, color: MUTED, fontWeight: 700, textDecoration: 'none', marginLeft: 'auto' }}>their file →</Link>
                </div>
                {m.media.length >= 6
                  ? <Link href={m.href} className="swarm2" style={{ textDecoration: 'none' }}>
                      {m.media.slice(0, 72).map((mm, i) => (
                        <span className="cell" key={i}>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={mm.img} alt="" loading="lazy" /></span>
                      ))}
                    </Link>
                  : <div style={{ fontSize: 12.5, color: MUTED, fontWeight: 600 }}>{m.why}</div>}
              </div>
            ))}
          </section>
        </div>
      )}

      {/* ══ ROOM 5 · WORTH EXPLORING — album covers, room to breathe ══ */}
      {ed.collections.length > 0 && (
        <section data-reveal className="wrap w-wide" style={{ padding: '66px 26px 20px' }}>
          <Eyebrow>Worth exploring</Eyebrow>
          <div className="albums2" style={{ marginTop: 18 }}>
            {ed.collections.map((c) => (
              <Link key={c.name} href={c.href} className="album2 lift">
                <div className="cover">
                  {c.covers.slice(0, 5).map((u, i) => (
                    <span key={i}>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={u} alt="" loading="lazy" /></span>
                  ))}
                </div>
                <div className="meta"><b>{c.name}</b><em>{c.sub}</em></div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ══ ROOM 6 · OPEN QUESTION — the emotional room, a face-off, almost no copy ══ */}
      {ed.question && ed.question.media.length >= 2 && (
        <section data-reveal className="wrap w-wide" style={{ padding: '80px 26px 20px', textAlign: 'center' }}>
          <Eyebrow>Open question</Eyebrow>
          <div className="faceoff" style={{ margin: '22px 0 26px' }}>
            <AdMedia img={ed.question.media[0].img} video={ed.question.media[0].video} />
            <span className="vs">vs</span>
            <AdMedia img={ed.question.media[1].img} video={ed.question.media[1].video} />
          </div>
          <Link href="/brief" style={{ textDecoration: 'none', color: INK }}>
            <div style={{ fontSize: 'clamp(22px,3.4vw,32px)', fontWeight: 800, letterSpacing: '-.02em', maxWidth: '24ch', margin: '0 auto', lineHeight: 1.2 }}>{ed.question.title}</div>
            <div style={{ fontSize: 12.5, color: MUTED, fontWeight: 600, marginTop: 8 }}>{ed.question.sub}</div>
          </Link>
        </section>
      )}

      {/* ══ ROOM 7 · MELLO'S WATCH — typography-forward, one supporting creative ══ */}
      {watch && (
        <section data-reveal className="wrap w-read" style={{ padding: '72px 26px 20px' }}>
          <Eyebrow color={GREEN}>Mello&rsquo;s watch · a call, graded {resolveBy}</Eyebrow>
          <div className="watch" style={{ marginTop: 16 }}>
            <div>
              <div style={{ fontSize: 'clamp(22px,3vw,29px)', fontWeight: 800, letterSpacing: '-.022em', lineHeight: 1.22, maxWidth: '20ch' }}>
                {watch.name} keeps climbing — I expect it to lead its lane by {resolveBy}.
              </div>
              <div style={{ display: 'flex', gap: 24, marginTop: 18, fontSize: 12.5, fontWeight: 700, color: MUTED, flexWrap: 'wrap' }}>
                <span><b style={{ color: GREEN, fontSize: 17, fontVariantNumeric: 'tabular-nums' }}>{watchConf}%</b><br />confidence</span>
                <span><b style={{ color: INK, fontSize: 17 }}>{resolveBy}</b><br />resolves</span>
                <span><b style={{ color: INK, fontSize: 17, fontVariantNumeric: 'tabular-nums' }}>{watch.now}</b><br />ads this week</span>
              </div>
              <div style={{ fontSize: 11.5, color: FAINT, fontWeight: 600, marginTop: 14, maxWidth: '48ch' }}>A momentum call from the corpus — I&rsquo;ll grade myself on it, in public, when it resolves.</div>
            </div>
            <AdMedia img={watch.media[0].img} video={watch.media[0].video} href={watch.href} className="sup lift" />
          </div>
        </section>
      )}

      {/* ══ THE LOGIN MOMENT ══ */}
      <section data-reveal className="wrap w-read" style={{ padding: '70px 26px 0' }}>
        <div style={{ background: FOREST, borderRadius: 22, padding: '30px 32px', color: '#eef5eb' }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#fff', letterSpacing: '-.012em' }}>This is the world&rsquo;s edition. Yours is different.</div>
          <div style={{ fontSize: 13.5, color: '#b9c6b6', margin: '7px 0 17px', maxWidth: '52ch', lineHeight: 1.6 }}>
            Hire Mello and every morning this page is rewritten around your brand — your competitors, your niche, your next ad. It reads the market while you sleep.
          </div>
          <Link href="/hire" style={{ display: 'inline-block', background: LIME, color: FOREST, fontSize: 13.5, fontWeight: 800, padding: '11px 20px', borderRadius: 100, textDecoration: 'none' }}>Hire Mello →</Link>
        </div>
      </section>

      {/* ══ THE END — editions end ══ */}
      <div className="wrap w-read" style={{ padding: '52px 26px 120px', textAlign: 'center', fontSize: 12, color: FAINT, fontWeight: 600 }}>
        — End of today&rsquo;s edition. Tomorrow&rsquo;s is already being hung. —
      </div>
    </div>
  )
}
