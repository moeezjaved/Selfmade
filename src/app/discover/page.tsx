/**
 * DISCOVER · The Museum — the ads ARE the interface.
 * "Every morning, Selfmade tells you what changed in your market while you were
 * sleeping." Public + SEO, museum-white, ~80% advertising / ~20% type. The evidence
 * IS the exhibit: the lead is a wall of the creatives that changed a truth; each
 * change is a film strip of its ads; a brand's burst is a swarm of its ads; a
 * question is a diptych. It is finite — it ends, and tomorrow's is hung.
 *
 * Every number degrades gracefully to its sentence when a section lacks media, so a
 * quiet-corpus night never shows an empty wall (museum law 5).
 */
import type { Metadata } from 'next'
import Link from 'next/link'
import { computeEdition, editionNumber } from '@/lib/edition/compute'
import ForYou from './ForYou'
import AdMedia from './AdMedia'
import TrailRecorder from '@/components/knowledge/TrailRecorder'

export const revalidate = 1800   // recomputes from the live corpus every 30 min; turns over daily on its own

const INK = '#111514', MUTED = '#7a827c', FAINT = '#adb3ae', LINE = '#eef0ee', FOREST = '#17251c', LIME = '#dffe95', GREEN = '#2f7a3f', AMBER = '#9a3412'

const CSS = `
.ad{position:relative;display:block;overflow:hidden;background:#20241f;border-radius:10px}
.admedia-scrim{position:absolute;inset:0;background:linear-gradient(160deg,rgba(255,255,255,.10),rgba(0,0,0,.16));pointer-events:none}
.admedia-play{position:absolute;right:8px;bottom:7px;z-index:2;font-size:10px;color:#fff;background:rgba(0,0,0,.42);border-radius:6px;padding:2px 7px;font-weight:800;letter-spacing:.04em}
.admedia-badge{position:absolute;left:8px;top:8px;z-index:2;font-size:9px;color:${LIME};background:#17251cd9;border-radius:7px;padding:3px 8px;font-weight:800;letter-spacing:.04em}
.wall{display:grid;grid-template-columns:repeat(6,1fr);grid-auto-rows:88px;gap:6px}
.wall .ad:nth-child(1){grid-column:span 2;grid-row:span 2}
.wall .ad:nth-child(4){grid-row:span 2}
.wall .ad:nth-child(7){grid-column:span 2}
.roll{display:grid;grid-template-columns:repeat(6,1fr);gap:6px;margin-top:11px}
.roll .ad{aspect-ratio:3/4}
.swarm{display:grid;grid-template-columns:repeat(24,1fr);gap:3px;margin-top:11px}
.swarm .cell{position:relative;aspect-ratio:1;border-radius:3px;overflow:hidden;background:#20241f}
.swarm .cell img{width:100%;height:100%;object-fit:cover;display:block}
.albums{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:14px}
.album{border-radius:16px;overflow:hidden;border:1px solid ${LINE};background:#fafbfa;text-decoration:none;color:${INK};display:block}
.album .cover{display:grid;grid-template-columns:2fr 1fr 1fr;grid-auto-rows:66px;gap:3px;padding:3px}
.album .cover span{position:relative;overflow:hidden;border-radius:6px;background:#20241f;display:block}
.album .cover span:first-child{grid-row:span 2}
.album .cover span img{width:100%;height:100%;object-fit:cover;display:block}
.album .meta{padding:14px 16px 15px}
.album .meta b{font-size:16px;font-weight:800;letter-spacing:-.015em;display:block;line-height:1.3}
.album .meta em{font-size:11.5px;color:${MUTED};font-weight:650;font-style:normal;display:block;margin-top:3px}
.diptych{display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-top:12px;border-radius:14px;overflow:hidden}
.diptych .ad{aspect-ratio:16/10;border-radius:0}
@media(max-width:680px){
  .wall{grid-template-columns:repeat(4,1fr);grid-auto-rows:74px}
  .roll{grid-template-columns:repeat(3,1fr)}
  .roll .ad:nth-child(n+4){display:none}
  .swarm{grid-template-columns:repeat(12,1fr)}
  .albums{grid-template-columns:1fr}
}
`

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: `Today's Market Intelligence — Edition №${editionNumber()} | Selfmade Discover`,
    description: 'What changed in the ad market overnight, shown as the ads themselves: rising hooks, cooling formats, brands making moves — read from the live marketing knowledge graph, published every morning.',
    alternates: { canonical: '/discover' },
  }
}

export default async function DiscoverPage() {
  const ed = await computeEdition()
  const isLead = (m: any) => ed.lead && m.kind === ed.lead.kind && m.name === ed.lead.name
  const strips = ed.movers.filter((m) => m.kind !== 'BRAND' && !isLead(m))
  const brands = ed.movers.filter((m) => m.kind === 'BRAND' && !isLead(m))
  const leadHasWall = !!(ed.lead && ed.lead.media.length >= 3)

  return (
    <div style={{ minHeight: '100vh', background: '#fff', fontFamily: "'Inter', -apple-system, sans-serif", color: INK }}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <TrailRecorder node="edition" />

      {/* whisper-quiet entrance */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 28px', maxWidth: 940, margin: '0 auto' }}>
        <Link href="/" style={{ fontWeight: 850, fontSize: 17, letterSpacing: '-.02em', color: INK, textDecoration: 'none' }}>Selfmade</Link>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <Link href="/search" style={{ fontSize: 12.5, color: MUTED, textDecoration: 'none', border: `1px solid ${LINE}`, borderRadius: 100, padding: '7px 16px', fontWeight: 600 }}>Search knowledge…</Link>
          <Link href="/brief" style={{ fontSize: 12.5, fontWeight: 800, color: INK, textDecoration: 'none' }}>Open app →</Link>
        </div>
      </div>

      <div style={{ maxWidth: 760, margin: '0 auto', padding: '44px 26px 120px' }}>
        {/* masthead */}
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.18em', textTransform: 'uppercase', color: FAINT }}>
          {ed.dateLabel} · Edition №{ed.no}
        </div>

        {/* Mello's morning note — the editor signs the edition */}
        <div style={{ fontSize: 17, lineHeight: 1.72, color: '#3a423c', maxWidth: '52ch', marginTop: 16 }}>
          Good morning. I read <b style={{ color: INK }}>{ed.adsRead.toLocaleString()} new ads</b> from {ed.brandsTouched.toLocaleString()} brands {ed.windowLabel}. Most of it was noise. These weren&rsquo;t.
          <div style={{ fontFamily: "'Snell Roundhand','Segoe Script',cursive", fontSize: 21, color: '#232b24', marginTop: 8 }}>— Mello</div>
        </div>

        {/* finite contents — the edition ends, and says so up front */}
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', margin: '20px 0 4px', fontSize: 12.5, fontWeight: 700, color: MUTED }}>
          <span><b style={{ color: INK, fontVariantNumeric: 'tabular-nums' }}>{ed.contents.changed}</b> things changed</span>
          {ed.contents.collections > 0 && <span><b style={{ color: INK, fontVariantNumeric: 'tabular-nums' }}>{ed.contents.collections}</b> collections</span>}
          {ed.contents.questions > 0 && <span><b style={{ color: INK }}>1</b> open question</span>}
        </div>

        {/* FOR YOU — logged-in readers only; the 20% personal, between note and lead */}
        <ForYou />

        {/* ── 1 · TODAY'S LEAD as a HERO EXHIBIT — a wall of the actual ads ── */}
        {ed.lead && (
          <div style={{ margin: '46px -6px 0' }}>
            <div style={{ padding: '0 6px' }}>
              <div style={{ fontSize: 10.5, fontWeight: 900, letterSpacing: '.16em', color: ed.lead.dir === 'up' ? GREEN : AMBER }}>
                {ed.lead.kind === 'BRAND'
                  ? `TODAY’S LEAD · ${ed.lead.now} ADS IN 48 HOURS`
                  : `TODAY’S LEAD · THESE ADS CHANGED WHAT’S ${ed.lead.dir === 'up' ? 'RISING' : 'FADING'}`}
              </div>
              <div style={{ fontSize: 'clamp(27px,4.8vw,38px)', fontWeight: 800, letterSpacing: '-.03em', lineHeight: 1.06, margin: '9px 0 4px', maxWidth: '20ch' }}>
                {ed.lead.kind === 'BRAND' ? `${ed.lead.name} is making a move.` : `${ed.lead.name} ${ed.lead.dir === 'up' ? 'is accelerating.' : 'is cooling off.'}`}
              </div>
            </div>

            {leadHasWall && (
              <div className="wall" style={{ margin: '16px 0 0', padding: '0 6px' }}>
                {ed.lead.media.slice(0, 10).map((m, i) => (
                  <AdMedia key={i} img={m.img} video={m.video} href={ed.lead!.href} />
                ))}
              </div>
            )}

            <div style={{ padding: '0 6px' }}>
              {/* the delta stays — as a caption now, not a headline */}
              {ed.lead.kind === 'BRAND' ? (
                <div style={{ fontSize: 13.5, fontWeight: 700, marginTop: 14 }}>
                  <span style={{ color: GREEN, fontWeight: 800 }}>{ed.lead.now} new ads</span>
                  <span style={{ color: FAINT }}> in the last 48 hours — every tile above is one of them</span>
                </div>
              ) : (
                <div style={{ fontSize: 13.5, fontWeight: 700, marginTop: 14, color: FAINT }}>
                  last week {ed.lead.prev} → <span style={{ color: ed.lead.dir === 'up' ? GREEN : AMBER, fontWeight: 800 }}>this week {ed.lead.now}</span>
                </div>
              )}
              <p style={{ fontSize: 15, lineHeight: 1.6, color: '#3a423c', maxWidth: '54ch', margin: '9px 0 14px' }}>{ed.leadBody}</p>
              <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
                <Link href={ed.lead.href} style={{ fontSize: 13.5, fontWeight: 800, color: INK, textDecoration: 'none', borderBottom: `2px solid ${LIME}`, paddingBottom: 2 }}>
                  Walk through all {ed.lead.now} ads behind this →
                </Link>
                <Link href="/brief" style={{ fontSize: 12.5, fontWeight: 700, color: MUTED, textDecoration: 'none' }}>
                  Ask Mello how your brand can use this
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* ── 2 · WHAT CHANGED OVERNIGHT — film strips (concepts) + swarms (brands) ── */}
        {(strips.length > 0 || brands.length > 0) && (
          <div style={{ marginTop: 54 }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.16em', textTransform: 'uppercase', color: FAINT, marginBottom: 6 }}>
              What changed {ed.windowLabel === 'overnight' ? 'overnight' : 'this week'}
            </div>

            {strips.map((m) => (
              <div key={`${m.kind}:${m.name}`} style={{ marginTop: 30 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 9, fontWeight: 900, letterSpacing: '.1em', color: FAINT }}>{m.kind} · {m.dir === 'up' ? 'RISING' : 'COOLING'}</span>
                  <span style={{ fontSize: 17, fontWeight: 750, letterSpacing: '-.012em' }}>
                    {m.name} {m.dir === 'up' ? 'is on the rise.' : 'is losing ground.'}
                  </span>
                  <Link href={m.href} style={{ fontSize: 12, color: MUTED, fontWeight: 700, textDecoration: 'none', marginLeft: 'auto' }}>
                    {m.dir === 'up' ? 'the newest' : 'the holdouts'} →
                  </Link>
                </div>
                {m.media.length >= 3 ? (
                  <div className="roll">
                    {m.media.slice(0, 6).map((mm, i) => <AdMedia key={i} img={mm.img} video={mm.video} href={m.href} />)}
                  </div>
                ) : (
                  <div style={{ fontSize: 12.5, color: MUTED, fontWeight: 600, marginTop: 6 }}>{m.why}</div>
                )}
              </div>
            ))}

            {brands.map((m) => (
              <div key={`brand:${m.pid}`} style={{ marginTop: 34 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 9, fontWeight: 900, letterSpacing: '.1em', color: FAINT }}>BRAND · MAKING A MOVE</span>
                  <span style={{ fontSize: 17, fontWeight: 750, letterSpacing: '-.012em' }}>{m.name} launched all of this in 48 hours.</span>
                  <Link href={m.href} style={{ fontSize: 12, color: MUTED, fontWeight: 700, textDecoration: 'none', marginLeft: 'auto' }}>their file →</Link>
                </div>
                {m.media.length >= 6 ? (
                  <Link href={m.href} className="swarm" style={{ textDecoration: 'none' }}>
                    {m.media.slice(0, 72).map((mm, i) => (
                      <span className="cell" key={i}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={mm.img} alt="" loading="lazy" />
                      </span>
                    ))}
                  </Link>
                ) : (
                  <div style={{ fontSize: 12.5, color: MUTED, fontWeight: 600, marginTop: 6 }}>{m.why}</div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── 3 · WORTH EXPLORING — collections as album covers ── */}
        {ed.collections.length > 0 && (
          <div style={{ marginTop: 56 }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.16em', textTransform: 'uppercase', color: FAINT, marginBottom: 4 }}>Worth exploring</div>
            <div className="albums">
              {ed.collections.map((c) => (
                <Link key={c.name} href={c.href} className="album">
                  <div className="cover">
                    {c.covers.slice(0, 5).map((u, i) => (
                      <span key={i}>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={u} alt="" loading="lazy" /></span>
                    ))}
                  </div>
                  <div className="meta"><b>{c.name}</b><em>{c.sub}</em></div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* ── 4 · OPEN QUESTION — a diptych you watch before you read ── */}
        {ed.question && (
          <div style={{ marginTop: 56 }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.16em', textTransform: 'uppercase', color: FAINT, marginBottom: 4 }}>Open question</div>
            {ed.question.media.length >= 2 && (
              <div className="diptych">
                <AdMedia img={ed.question.media[0].img} video={ed.question.media[0].video} />
                <AdMedia img={ed.question.media[1].img} video={ed.question.media[1].video} />
              </div>
            )}
            <Link href="/brief" style={{ display: 'block', textDecoration: 'none', color: INK, marginTop: 12 }}>
              <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: '-.015em', maxWidth: '32ch', lineHeight: 1.35 }}>{ed.question.title}</div>
              <div style={{ fontSize: 12.5, color: MUTED, fontWeight: 600, marginTop: 4 }}>{ed.question.sub}</div>
            </Link>
          </div>
        )}

        {/* ── 5 · THE LOGIN MOMENT — knowledge is global; the application is yours ── */}
        <div style={{ marginTop: 64, background: FOREST, borderRadius: 20, padding: '28px 30px', color: '#eef5eb' }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: '#fff', letterSpacing: '-.01em' }}>This is the world&rsquo;s edition. Yours is different.</div>
          <div style={{ fontSize: 13.5, color: '#b9c6b6', margin: '6px 0 16px', maxWidth: '52ch', lineHeight: 1.6 }}>
            Hire Mello and every morning this page is rewritten around your brand — your competitors, your niche, your next ad. It reads the market while you sleep.
          </div>
          <Link href="/hire" style={{ display: 'inline-block', background: LIME, color: FOREST, fontSize: 13.5, fontWeight: 800, padding: '11px 20px', borderRadius: 100, textDecoration: 'none' }}>Hire Mello →</Link>
        </div>

        {/* ── 6 · THE END — editions end; feeds don't ── */}
        <div style={{ marginTop: 54, textAlign: 'center', fontSize: 12, color: FAINT, fontWeight: 600 }}>
          — End of today&rsquo;s edition. Tomorrow&rsquo;s is already being hung. —
        </div>
      </div>
    </div>
  )
}
