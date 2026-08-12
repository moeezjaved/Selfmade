/**
 * PLAYBOOK · the exhibition — "100 winning ads. Continuously updated. Watch.
 * Understand. Remake." Not one grid: Netflix-style CHAPTERS (Highest Performing,
 * Founder & Story, UGC Winners, Studio & Premium, Proof That Sells, Long-Runners),
 * each a horizontal rail of premium cards, then the full wall for completeness/SEO.
 * Every card → the ad's Watch/Understand/Remake page; the whole funnel on one page.
 */
import type { Metadata } from 'next'
import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/server'
import AdMedia from '@/app/discover/AdMedia'
import TrailRecorder from '@/components/knowledge/TrailRecorder'
import { agoLabel } from '@/lib/playbooks/featured'
import KnowledgeChrome from '@/components/app/KnowledgeChrome'

export const revalidate = 900

const INK = '#111514', MUTED = '#7a827c', FAINT = '#adb3ae', LINE = '#eef0ee', FOREST = '#141d15', LIME = '#ff5a2c'

const CSS = `
.ad{position:relative;display:block;overflow:hidden;background:#20241f;border-radius:12px}
.admedia-scrim{position:absolute;inset:0;background:linear-gradient(160deg,rgba(255,255,255,.07),rgba(0,0,0,.14));pointer-events:none}
.admedia-play{position:absolute;right:8px;bottom:7px;z-index:2;font-size:10px;color:#fff;background:rgba(0,0,0,.42);border-radius:6px;padding:2px 7px;font-weight:800}
.admedia-badge{position:absolute;left:8px;top:8px;z-index:2;font-size:9px;color:${LIME};background:#141d15d9;border-radius:7px;padding:3px 8px;font-weight:800}
/* Netflix rail */
.rail{display:flex;gap:14px;overflow-x:auto;scroll-snap-type:x mandatory;padding:6px 2px 16px;scrollbar-width:none}
.rail::-webkit-scrollbar{display:none}
.pbcard{flex:0 0 auto;width:190px;position:relative;scroll-snap-align:start;transition:transform .3s cubic-bezier(.2,.7,.2,1)}
.pbcard .ad{aspect-ratio:3/4}
.pbcard:hover{transform:translateY(-4px)}
.pbcard .meta{position:absolute;inset:auto 0 0 0;z-index:3;padding:32px 11px 10px;background:linear-gradient(180deg,transparent,rgba(8,12,9,.88));opacity:0;transition:opacity .25s ease;color:#fff;pointer-events:none;border-radius:0 0 12px 12px}
.pbcard:hover .meta{opacity:1}
.pbcard .meta .b{font-size:12.5px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pbcard .meta .d{font-size:10.5px;font-weight:700;color:#cdd8cc;margin-top:2px}
.pbcard .acts{position:absolute;top:8px;right:8px;z-index:4;display:flex;gap:6px;opacity:0;transition:opacity .25s ease}
.pbcard:hover .acts{opacity:1}
.pbcard .acts a{font-size:10.5px;font-weight:800;border-radius:100px;padding:6px 11px;text-decoration:none}
.pbcard .acts .watch{background:rgba(255,255,255,.94);color:${INK}}
.pbcard .acts .remake{background:${LIME};color:${FOREST}}
/* full wall */
.pbwall{column-count:5;column-gap:12px}
.wcard{break-inside:avoid;margin-bottom:12px;position:relative;transition:transform .3s ease}
.wcard .ad{aspect-ratio:4/5}
.wcard:nth-child(7n) .ad{aspect-ratio:1/1}
.wcard:nth-child(5n) .ad{aspect-ratio:9/14}
.wcard:hover{transform:translateY(-3px)}
.wcard .acts{position:absolute;top:7px;right:7px;z-index:4;display:flex;gap:5px;opacity:0;transition:opacity .25s ease}
.wcard:hover .acts{opacity:1}
.wcard .acts a{font-size:10px;font-weight:800;border-radius:100px;padding:5px 9px;text-decoration:none}
.wcard .acts .remake{background:${LIME};color:${FOREST}}
@media(max-width:1000px){.pbwall{column-count:3}}
@media(max-width:680px){.pbwall{column-count:2}.pbcard{width:150px}}
@media (prefers-reduced-motion: reduce){.pbcard,.pbcard:hover,.wcard,.wcard:hover{transform:none}}
`

const mediaOf = (a: any) => {
  const cres = Array.isArray(a.discovery_creatives) ? a.discovery_creatives : (a.discovery_creatives ? [a.discovery_creatives] : [])
  const cre = cres.find((c: any) => (c.asset_type === 'video' ? c.poster_url : c.r2_url)) || cres[0]
  if (!cre) return null
  const isVid = cre.asset_type === 'video'
  const img = isVid ? cre.poster_url : cre.r2_url
  return img ? { img, video: isVid ? (cre.r2_url || undefined) : undefined } : null
}

async function getPlaybook(slug: string) {
  const admin = createAdminClient() as any
  const { data: book } = await admin.from('playbooks').select('*').eq('slug', slug).maybeSingle()
  if (!book) return { book: null, ads: [] as any[] }
  const { data: links } = await admin.from('playbook_ads').select('ad_id, position').eq('playbook_id', book.id).order('position').limit(200)
  const ids = (links || []).map((l: any) => l.ad_id)
  if (!ids.length) return { book, ads: [] as any[] }
  const { data: rows } = await admin.from('discovery_ads_index')
    .select('ad_id, page_name, hook_type, format_style, days_running, is_active, performance_score, cta_style, discovery_creatives(asset_type, r2_url, poster_url)')
    .in('ad_id', ids)
  const byId = new Map((rows || []).map((r: any) => [r.ad_id, r]))
  const ads = (links || []).map((l: any) => {
    const r: any = byId.get(l.ad_id); if (!r) return null
    const m = mediaOf(r); if (!m) return null
    return { adId: r.ad_id, brand: r.page_name, hook: r.hook_type, format: r.format_style, days: r.days_running, active: r.is_active, score: r.performance_score, cta: r.cta_style, m }
  }).filter(Boolean)
  return { book, ads }
}

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const { book, ads } = await getPlaybook(params.slug)
  if (!book) return { title: 'Playbook | Selfmade' }
  return {
    title: `${book.title} — ${ads.length} winning ads, continuously updated | Selfmade`,
    description: book.description || `${ads.length} winning ads, curated and continuously updated. Watch them, understand why they work, remake them for your brand.`,
    alternates: { canonical: `/playbooks/${params.slug}` },
  }
}

export default async function PlaybookPage({ params }: { params: { slug: string } }) {
  const { book, ads } = await getPlaybook(params.slug)
  if (!book) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#fff', fontFamily: "'Inter',sans-serif", color: MUTED }}>
        <div style={{ textAlign: 'center' }}>This playbook doesn&rsquo;t exist yet.<br /><Link href="/playbooks" style={{ color: '#2f7a3f', fontWeight: 700 }}>← All playbooks</Link></div>
      </div>
    )
  }

  // Chapters — the 100 become ~6 mini-exhibitions, derived from the ads' DNA.
  const byScore = [...ads].sort((a, b) => (b.score || 0) - (a.score || 0))
  const chapters: { title: string; sub: string; ads: any[] }[] = [
    { title: 'Highest performing', sub: 'the strongest signals in this playbook', ads: byScore.slice(0, 14) },
    { title: 'Founder & story', sub: 'narrative-led — a person, not a product', ads: ads.filter((a: any) => a.hook === 'Story') },
    { title: 'UGC winners', sub: 'creator-style, native to the feed', ads: ads.filter((a: any) => a.format === 'UGC') },
    { title: 'Studio & premium', sub: 'produced, polished, brand-forward', ads: ads.filter((a: any) => a.format === 'Studio / Produced') },
    { title: 'Proof that sells', sub: 'testimonial & social-proof hooks', ads: ads.filter((a: any) => a.hook === 'Testimonial' || a.hook === 'Social Proof') },
    { title: 'Best offers', sub: 'discount & announcement-led', ads: ads.filter((a: any) => a.hook === 'Discount' || a.hook === 'Announcement' || a.cta === 'hard') },
    { title: 'Long-runners', sub: 'still live after 60+ days — proven', ads: ads.filter((a: any) => (a.days || 0) >= 60) },
  ].filter((c) => c.ads.length >= 4)

  // Remake → the two-pane studio, winner pre-loaded (video carries type=video + mp4).
  const studioHref = (a: any) => `/studio?ad=${encodeURIComponent(a.adId)}${a.m?.video ? `&type=video&vid=${encodeURIComponent(a.m.video)}` : ''}${a.m?.img ? `&img=${encodeURIComponent(a.m.img)}` : ''}${a.brand ? `&brand=${encodeURIComponent(a.brand)}` : ''}`
  const Card = ({ a }: { a: any }) => (
    <div className="pbcard">
      <AdMedia img={a.m.img} video={a.m.video} href={`/knowledge/ad/${a.adId}?pb=${book.slug}`} className="ad" badge={a.days >= 21 ? `${a.days}d` : undefined} />
      <div className="acts">
        <Link className="watch" href={`/knowledge/ad/${a.adId}?pb=${book.slug}`}>▶ Watch</Link>
        <Link className="remake" href={studioHref(a)}>✨ Remake</Link>
      </div>
      <div className="meta"><div className="b">{a.brand || '—'}</div><div className="d">{[a.hook, a.days ? `${a.days}d` : null, a.active ? 'live' : null].filter(Boolean).join(' · ')}</div></div>
    </div>
  )

  return (
    <KnowledgeChrome>
    <div style={{ minHeight: '100vh', background: '#fff', fontFamily: "'Inter', -apple-system, sans-serif", color: INK }}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <TrailRecorder node={`playbook:${params.slug}`} />

      {/* hero */}
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '40px 26px 8px' }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.16em', textTransform: 'uppercase', color: FAINT }}>Playbook · {agoLabel(book.updated_at).replace('updated ', 'updated ')}</div>
        <h1 style={{ fontSize: 'clamp(32px,5vw,52px)', fontWeight: 800, letterSpacing: '-.034em', lineHeight: 1.03, margin: '10px 0 8px' }}>{book.emoji ? `${book.emoji} ` : ''}{book.title}</h1>
        <p style={{ fontSize: 16.5, color: MUTED, maxWidth: '54ch', lineHeight: 1.6 }}>{book.description || `${ads.length} winning ads. Continuously updated by Mello.`}</p>
        <div style={{ display: 'flex', gap: 20, marginTop: 14, fontSize: 13, fontWeight: 800 }}>
          <span>Watch.</span><span>Understand.</span><span style={{ color: '#2f7a3f' }}>Remake.</span>
        </div>
      </div>

      {/* chapters */}
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 26px 20px' }}>
        {ads.length === 0 && <div style={{ color: MUTED, fontSize: 14.5 }}>This wall is being hung — check back shortly.</div>}
        {chapters.map((c) => (
          <div key={c.title} style={{ marginBottom: 30 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
              <h2 style={{ fontSize: 19, fontWeight: 800, letterSpacing: '-.018em', margin: 0 }}>{c.title}</h2>
              <span style={{ fontSize: 12.5, color: MUTED, fontWeight: 600 }}>{c.sub}</span>
              <span style={{ fontSize: 11.5, color: FAINT, fontWeight: 700, marginLeft: 'auto' }}>{c.ads.length}</span>
            </div>
            <div className="rail">{c.ads.slice(0, 18).map((a) => <Card key={a.adId} a={a} />)}</div>
          </div>
        ))}
      </div>

      {/* the full wall — every ad, for completeness + SEO */}
      {ads.length > 0 && (
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '10px 26px 40px' }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.16em', textTransform: 'uppercase', color: FAINT, marginBottom: 14 }}>Every ad · {ads.length}</div>
          <div className="pbwall">
            {ads.map((a: any) => (
              <div key={a.adId} className="wcard">
                <AdMedia img={a.m.img} video={a.m.video} href={`/knowledge/ad/${a.adId}?pb=${book.slug}`} className="ad" badge={a.days >= 21 ? `${a.days}d · survivor` : undefined} />
                <div className="acts"><Link className="remake" href={studioHref(a)}>✨ Remake</Link></div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* funnel close */}
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '20px 26px 110px' }}>
        <div style={{ background: FOREST, borderRadius: 20, padding: '28px 30px', color: '#f3eee3' }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: '#fff' }}>Found one you&rsquo;d run?</div>
          <div style={{ fontSize: 13.5, color: '#b9c6b6', margin: '6px 0 16px', maxWidth: '52ch', lineHeight: 1.6 }}>Hit Remake on any ad and Mello rebuilds it around your product — your brand, your offer, minutes not weeks.</div>
          <Link href="/hire" style={{ display: 'inline-block', background: '#ef4a1e', color: '#fff', fontSize: 13.5, fontWeight: 800, padding: '11px 20px', borderRadius: 100, textDecoration: 'none' }}>Hire Mello →</Link>
        </div>
      </div>
    </div>
    </KnowledgeChrome>
  )
}
