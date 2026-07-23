/**
 * PLAYBOOK · the wall — "100 winning beauty ads. Continuously updated.
 * Watch. Understand. Remake."
 * A museum wall of real creatives (Pinterest/Netflix density, varied aspect
 * ratios); hover reveals the ad's story (▶ watch · running 46 days · hook) and
 * the two actions. Every ad opens its knowledge page (Watch + Understand), and
 * Remake routes into the logged-in app — the entire funnel on one page.
 */
import type { Metadata } from 'next'
import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/server'
import AdMedia from '@/app/discover/AdMedia'
import TrailRecorder from '@/components/knowledge/TrailRecorder'

export const revalidate = 900   // "continuously updated" stays visibly true

const INK = '#111514', MUTED = '#7a827c', FAINT = '#adb3ae', LINE = '#eef0ee', FOREST = '#17251c', LIME = '#dffe95'

const CSS = `
.ad{position:relative;display:block;overflow:hidden;background:#20241f;border-radius:12px}
.admedia-scrim{position:absolute;inset:0;background:linear-gradient(160deg,rgba(255,255,255,.07),rgba(0,0,0,.14));pointer-events:none}
.admedia-play{position:absolute;right:8px;bottom:7px;z-index:2;font-size:10px;color:#fff;background:rgba(0,0,0,.42);border-radius:6px;padding:2px 7px;font-weight:800}
.admedia-badge{position:absolute;left:8px;top:8px;z-index:2;font-size:9px;color:${LIME};background:#17251cd9;border-radius:7px;padding:3px 8px;font-weight:800}
.pbwall{column-count:4;column-gap:12px}
.pbcard{break-inside:avoid;margin-bottom:12px;position:relative;border-radius:12px;overflow:hidden;display:block}
.pbcard .ad{border-radius:12px}
.pbcard .meta{position:absolute;inset:auto 0 0 0;z-index:3;padding:34px 12px 10px;background:linear-gradient(180deg,transparent,rgba(8,12,9,.86));opacity:0;transition:opacity .25s ease;color:#fff;pointer-events:none}
.pbcard:hover .meta{opacity:1}
.pbcard .meta .b{font-size:12.5px;font-weight:800;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pbcard .meta .d{font-size:10.5px;font-weight:700;color:#cdd8cc;margin-top:2px}
.pbcard .acts{position:absolute;top:8px;right:8px;z-index:4;display:flex;gap:6px;opacity:0;transition:opacity .25s ease}
.pbcard:hover .acts{opacity:1}
.pbcard .acts a{font-size:10.5px;font-weight:800;border-radius:100px;padding:6px 11px;text-decoration:none;backdrop-filter:blur(4px)}
.pbcard .acts .watch{background:rgba(255,255,255,.92);color:${INK}}
.pbcard .acts .remake{background:${LIME};color:${FOREST}}
.pbcard:hover{transform:translateY(-3px)}
.pbcard{transition:transform .3s cubic-bezier(.2,.7,.2,1)}
.pbcard:nth-child(7n) .ad{aspect-ratio:1/1}
.pbcard:nth-child(5n) .ad{aspect-ratio:9/14}
@media(max-width:1000px){.pbwall{column-count:3}}
@media(max-width:680px){.pbwall{column-count:2}}
@media (prefers-reduced-motion: reduce){.pbcard,.pbcard:hover{transform:none}}
`

const ago = (iso: string) => {
  const h = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 3600e3))
  if (h < 1) return 'just now'
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`
  const d = Math.floor(h / 24)
  return d === 1 ? 'yesterday' : `${d} days ago`
}
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
  if (!book) return { book: null, ads: [] }
  const { data: links } = await admin.from('playbook_ads').select('ad_id, position, featured').eq('playbook_id', book.id).order('position').limit(200)
  const ids = (links || []).map((l: any) => l.ad_id)
  if (!ids.length) return { book, ads: [] }
  const { data: rows } = await admin.from('discovery_ads_index')
    .select('ad_id, page_name, hook_type, format_style, days_running, is_active, discovery_creatives(asset_type, r2_url, poster_url)')
    .in('ad_id', ids)
  const byId = new Map((rows || []).map((r: any) => [r.ad_id, r]))
  const ads = (links || []).map((l: any) => {
    const r: any = byId.get(l.ad_id); if (!r) return null
    const m = mediaOf(r); if (!m) return null
    return { adId: r.ad_id, brand: r.page_name, hook: r.hook_type, days: r.days_running, active: r.is_active, m }
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
  return (
    <div style={{ minHeight: '100vh', background: '#fff', fontFamily: "'Inter', -apple-system, sans-serif", color: INK }}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <TrailRecorder node={`playbook:${params.slug}`} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 28px', maxWidth: 1160, margin: '0 auto' }}>
        <Link href="/" style={{ fontWeight: 850, fontSize: 17, letterSpacing: '-.02em', color: INK, textDecoration: 'none' }}>Selfmade</Link>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <Link href="/playbooks" style={{ fontSize: 12.5, color: MUTED, textDecoration: 'none', fontWeight: 700 }}>All playbooks</Link>
          <Link href="/brief" style={{ fontSize: 12.5, fontWeight: 800, color: INK, textDecoration: 'none' }}>Open app →</Link>
        </div>
      </div>

      {/* hero */}
      <div style={{ maxWidth: 1160, margin: '0 auto', padding: '40px 26px 8px' }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.16em', textTransform: 'uppercase', color: FAINT }}>Playbook · updated {ago(book.updated_at)}</div>
        <h1 style={{ fontSize: 'clamp(32px,5vw,50px)', fontWeight: 800, letterSpacing: '-.034em', lineHeight: 1.04, margin: '10px 0 8px' }}>
          {book.emoji ? `${book.emoji} ` : ''}{book.title}
        </h1>
        <p style={{ fontSize: 16.5, color: MUTED, maxWidth: '54ch', lineHeight: 1.6 }}>
          {book.description || `${ads.length} winning ads. Continuously updated.`}
        </p>
        <div style={{ display: 'flex', gap: 20, marginTop: 14, fontSize: 13, fontWeight: 800, color: INK }}>
          <span>Watch.</span><span>Understand.</span><span style={{ color: '#2f7a3f' }}>Remake.</span>
        </div>
      </div>

      {/* the wall */}
      <div style={{ maxWidth: 1160, margin: '0 auto', padding: '28px 26px 60px' }}>
        {ads.length === 0 && <div style={{ color: MUTED, fontSize: 14.5 }}>This wall is being hung — check back shortly.</div>}
        <div className="pbwall">
          {ads.map((a: any) => (
            <div key={a.adId} className="pbcard">
              <AdMedia img={a.m.img} video={a.m.video} href={`/knowledge/ad/${a.adId}`} className="ad" badge={a.days >= 21 ? `${a.days}d · survivor` : undefined} />
              <div className="acts">
                <Link className="watch" href={`/knowledge/ad/${a.adId}`}>▶ Watch</Link>
                <Link className="remake" href={`/discovery/${a.adId}`}>✨ Remake</Link>
              </div>
              <div className="meta">
                <div className="b">{a.brand || '—'}</div>
                <div className="d">{[a.hook, a.days ? `running ${a.days} days` : null, a.active ? 'live now' : null].filter(Boolean).join(' · ')}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* the funnel close */}
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '0 26px 110px' }}>
        <div style={{ background: FOREST, borderRadius: 20, padding: '28px 30px', color: '#eef5eb' }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: '#fff' }}>Found one you&rsquo;d run?</div>
          <div style={{ fontSize: 13.5, color: '#b9c6b6', margin: '6px 0 16px', maxWidth: '52ch', lineHeight: 1.6 }}>
            Hit Remake on any ad and Mello rebuilds it around your product — your brand, your offer, minutes not weeks.
          </div>
          <Link href="/hire" style={{ display: 'inline-block', background: LIME, color: FOREST, fontSize: 13.5, fontWeight: 800, padding: '11px 20px', borderRadius: 100, textDecoration: 'none' }}>Hire Mello →</Link>
        </div>
      </div>
    </div>
  )
}
