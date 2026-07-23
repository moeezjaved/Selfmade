/**
 * DISCOVER · The Edition — "every morning, Selfmade tells you what changed in your
 * market while you were sleeping." Public + SEO; the beautiful proof that Mello
 * worked overnight. Deliberately a DIFFERENT world from the Brief: white, editorial,
 * museum-calm — Apple News × Arc × Notion, not a dashboard, not a feed. It is finite:
 * a lead, what changed, worth exploring, one question, then it ends.
 *
 * Mello is Editor-in-Chief: the market wrote today's edition; Mello curated it.
 */
import type { Metadata } from 'next'
import Link from 'next/link'
import { computeEdition, editionNumber } from '@/lib/edition/compute'
import ForYou from './ForYou'
import TrailRecorder from '@/components/knowledge/TrailRecorder'

export const revalidate = 1800   // the edition refreshes itself; readers never wait on it

const INK = '#14181a', MUTED = '#7a827c', FAINT = '#aab0ab', LINE = '#eceeec', FOREST = '#17251c', LIME = '#dffe95', GREEN = '#2f7a3f', AMBER = '#9a3412'

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: `Today's Market Intelligence — Edition №${editionNumber()} | Selfmade Discover`,
    description: 'What changed in the ad market overnight: rising hooks, cooling formats, brands making moves — read from the live marketing knowledge graph, published every morning.',
    alternates: { canonical: '/discover' },
  }
}

export default async function DiscoverPage() {
  const ed = await computeEdition()
  const secondary = ed.movers.filter((m) => m !== ed.lead)

  return (
    <div style={{ minHeight: '100vh', background: '#fff', fontFamily: "'Inter', -apple-system, sans-serif", color: INK }}>
      <TrailRecorder node="edition" />
      {/* whisper-quiet top bar — the museum entrance */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 28px', maxWidth: 860, margin: '0 auto' }}>
        <Link href="/" style={{ fontWeight: 850, fontSize: 17, letterSpacing: '-.02em', color: INK, textDecoration: 'none' }}>Selfmade</Link>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <Link href="/search" style={{ fontSize: 12.5, color: MUTED, textDecoration: 'none', border: `1px solid ${LINE}`, borderRadius: 100, padding: '7px 16px', fontWeight: 600 }}>Search knowledge…</Link>
          <Link href="/brief" style={{ fontSize: 12.5, fontWeight: 800, color: INK, textDecoration: 'none' }}>Open app →</Link>
        </div>
      </div>

      <div style={{ maxWidth: 660, margin: '0 auto', padding: '46px 26px 110px' }}>
        {/* masthead */}
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.18em', textTransform: 'uppercase', color: FAINT }}>
          {ed.dateLabel} · Edition №{ed.no}
        </div>
        <h1 style={{ fontSize: 'clamp(30px,5vw,40px)', fontWeight: 800, letterSpacing: '-.03em', lineHeight: 1.08, margin: '10px 0 22px' }}>
          Today&rsquo;s Market Intelligence
        </h1>

        {/* the editor's note — Mello signs the edition */}
        <div style={{ fontSize: 16.5, lineHeight: 1.75, color: '#3a423c', maxWidth: '52ch' }}>
          Good morning. I read <b style={{ color: INK }}>{ed.adsRead.toLocaleString()} new ads</b> from {ed.brandsTouched.toLocaleString()} brands {ed.windowLabel}. Most of it was noise. These things weren&rsquo;t.
          <div style={{ fontFamily: "'Snell Roundhand','Segoe Script',cursive", fontSize: 21, color: '#232b24', marginTop: 8 }}>— Mello</div>
        </div>

        {/* finite contents — the edition ends, and says so up front */}
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', margin: '22px 0 6px', fontSize: 12.5, fontWeight: 700, color: MUTED }}>
          <span><b style={{ color: INK, fontVariantNumeric: 'tabular-nums' }}>{ed.contents.changed}</b> things changed</span>
          <span><b style={{ color: INK, fontVariantNumeric: 'tabular-nums' }}>{ed.contents.collections}</b> collections updated</span>
          {ed.contents.questions > 0 && <span><b style={{ color: INK }}>1</b> open question</span>}
        </div>

        {/* FOR YOU — only renders for a logged-in reader; sits between the note and the lead */}
        <ForYou />

        {/* today's lead — the biggest move, floating in whitespace */}
        {ed.lead && (
          <div style={{ margin: '44px 0 6px' }}>
            <div style={{ fontSize: 10.5, fontWeight: 900, letterSpacing: '.16em', color: ed.lead.dir === 'up' ? GREEN : AMBER }}>
              TODAY&rsquo;S LEAD · {ed.lead.kind} · KNOWLEDGE CHANGED
            </div>
            <div style={{ fontSize: 'clamp(26px,4.4vw,34px)', fontWeight: 800, letterSpacing: '-.028em', lineHeight: 1.1, margin: '10px 0 12px' }}>
              {ed.lead.name} {ed.lead.dir === 'up' ? 'is accelerating.' : 'is cooling off.'}
            </div>
            {/* the delta — knowledge that visibly changed today (brand moves are a 48h burst, not a week compare) */}
            {ed.lead.kind === 'BRAND' ? (
              <div style={{ fontSize: 13.5, fontWeight: 700 }}>
                <span style={{ color: GREEN, fontSize: 17, fontWeight: 800 }}>{ed.lead.now} new ads</span>
                <span style={{ color: FAINT }}> in the last 48 hours</span>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, fontSize: 13.5, fontWeight: 700, flexWrap: 'wrap' }}>
                <span style={{ color: FAINT }}>last week {ed.lead.prev} new ads</span>
                <span style={{ color: FAINT }}>→</span>
                <span style={{ color: ed.lead.dir === 'up' ? GREEN : AMBER, fontSize: 17, fontWeight: 800 }}>this week {ed.lead.now}</span>
              </div>
            )}
            <p style={{ fontSize: 15.5, lineHeight: 1.65, color: '#3a423c', maxWidth: '54ch', margin: '12px 0 16px' }}>{ed.leadBody}</p>
            <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
              <Link href={ed.lead.href} style={{ fontSize: 13.5, fontWeight: 800, color: INK, textDecoration: 'none', borderBottom: `2px solid ${LIME}`, paddingBottom: 2 }}>
                Open the evidence — every ad behind this →
              </Link>
              <Link href="/brief" style={{ fontSize: 12.5, fontWeight: 700, color: MUTED, textDecoration: 'none' }}>
                Ask Mello how your brand can use this
              </Link>
            </div>
          </div>
        )}

        {/* what changed overnight — typographic index, every line carries its why */}
        {secondary.length > 0 && (
          <div style={{ marginTop: 52 }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.16em', textTransform: 'uppercase', color: FAINT, marginBottom: 4 }}>What changed {ed.windowLabel === 'overnight' ? 'overnight' : 'this week'}</div>
            {secondary.map((m) => (
              <Link key={`${m.kind}:${m.name}`} href={m.href} style={{ display: 'flex', alignItems: 'baseline', gap: 14, padding: '15px 2px', borderBottom: `1px solid #f2f4f2`, textDecoration: 'none', color: INK }}>
                <span style={{ fontSize: 9.5, fontWeight: 900, letterSpacing: '.1em', color: FAINT, width: 66, flexShrink: 0 }}>{m.kind}</span>
                <span style={{ fontWeight: 750, letterSpacing: '-.01em', fontSize: 15.5 }}>{m.name}</span>
                <span style={{ color: MUTED, fontSize: 13, flex: 1, minWidth: 120 }}>{m.why}</span>
                <span style={{ color: m.dir === 'up' ? GREEN : AMBER, fontWeight: 800, fontSize: 12.5, whiteSpace: 'nowrap' }}>
                  {m.kind === 'BRAND' ? 'making a move' : m.dir === 'up' ? '▲ rising' : '▼ cooling'}
                </span>
              </Link>
            ))}
          </div>
        )}

        {/* worth exploring — living collections, covers made of the ads themselves */}
        {ed.collections.length > 0 && (
          <div style={{ marginTop: 52 }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.16em', textTransform: 'uppercase', color: FAINT, marginBottom: 14 }}>Worth exploring</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 14 }}>
              {ed.collections.map((c) => (
                <Link key={c.name} href={c.href} style={{ display: 'block', textDecoration: 'none', color: INK, border: `1px solid ${LINE}`, borderRadius: 14, overflow: 'hidden', background: '#fff' }}>
                  <div style={{ height: 96, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 2, padding: 2 }}>
                    {c.covers.slice(0, 6).map((u, i) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={i} src={u} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 4, background: '#f2f4f2' }} />
                    ))}
                  </div>
                  <div style={{ padding: '11px 14px' }}>
                    <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: '-.01em', lineHeight: 1.35 }}>{c.name}</div>
                    <div style={{ fontSize: 11, color: MUTED, fontWeight: 600, marginTop: 3 }}>{c.sub}</div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* one open question */}
        {ed.question && (
          <div style={{ marginTop: 52 }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.16em', textTransform: 'uppercase', color: FAINT, marginBottom: 4 }}>Open question</div>
            <Link href="/brief" style={{ display: 'block', padding: '15px 2px', textDecoration: 'none', color: INK }}>
              <div style={{ fontSize: 16.5, fontWeight: 750, letterSpacing: '-.01em', lineHeight: 1.4 }}>{ed.question.title}</div>
              <div style={{ fontSize: 12.5, color: MUTED, fontWeight: 600, marginTop: 4 }}>{ed.question.sub}</div>
            </Link>
          </div>
        )}

        {/* the login moment — knowledge is global; the application of it is yours */}
        <div style={{ marginTop: 60, background: FOREST, borderRadius: 18, padding: '26px 28px', color: '#eef5eb' }}>
          <div style={{ fontSize: 16.5, fontWeight: 800, color: '#fff', letterSpacing: '-.01em' }}>This is the world&rsquo;s edition. Yours is different.</div>
          <div style={{ fontSize: 13.5, color: '#b9c6b6', margin: '6px 0 16px', maxWidth: '52ch', lineHeight: 1.6 }}>
            Hire Mello and every morning this page is rewritten around your brand — your competitors, your niche, your next ad. It reads the market while you sleep.
          </div>
          <Link href="/hire" style={{ display: 'inline-block', background: LIME, color: FOREST, fontSize: 13.5, fontWeight: 800, padding: '11px 20px', borderRadius: 100, textDecoration: 'none' }}>Hire Mello →</Link>
        </div>

        {/* the end — editions end; feeds don't */}
        <div style={{ marginTop: 54, textAlign: 'center', fontSize: 12, color: FAINT, fontWeight: 600 }}>
          — End of today&rsquo;s edition. Tomorrow&rsquo;s is already being written. —
        </div>
      </div>
    </div>
  )
}
