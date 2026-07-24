/**
 * KNOWLEDGE · Ad entity page — every ad gets ONE living page (the IMDb model), public + SEO.
 * Media + brand + run status + creative DNA public; similar ads as a taste; remake/watch gated.
 * Server-rendered from discovery_ads_index + discovery_creatives. Linked from brand pages,
 * the Morning Brief's competitor thumbnails, and (next) collections.
 */
import type { Metadata } from 'next'
import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/server'
import TrailRecorder from '@/components/knowledge/TrailRecorder'
import Understand from '@/components/knowledge/Understand'
import KnowledgeChrome from '@/components/app/KnowledgeChrome'

export const revalidate = 3600

const INK = '#161c17', MUTED = '#68756b', LINE = '#e7ece7', LIME = '#dffe95', FOREST = '#17251c'

async function getAd(adId: string) {
  const admin = createAdminClient() as any
  const ad = await admin.from('discovery_ads_index')
    .select('ad_id, page_id, page_name, performance_score, performance_tier, format_style, hook_type, visual_style, topics, niche, is_active, last_seen, start_date, days_running, targeted_countries, discovery_creatives(asset_type, r2_url, poster_url, width, height)')
    .eq('ad_id', adId).maybeSingle().then((r: any) => r.data)
  if (!ad) return { ad: null, similar: [] }
  const similar = await admin.from('discovery_ads_index')
    .select('ad_id, page_name, days_running, discovery_creatives(asset_type, r2_url, poster_url)')
    .eq('page_id', ad.page_id).neq('ad_id', adId)
    .order('performance_score', { ascending: false, nullsFirst: false }).limit(6)
    .then((r: any) => r.data || [])
  return { ad, similar }
}

// "Next in this Playbook" — keep users inside the exhibition (YouTube/Netflix physics).
async function getPlaybookNext(slug: string, adId: string) {
  const admin = createAdminClient() as any
  const book = await admin.from('playbooks').select('id, title, slug, emoji').eq('slug', slug).maybeSingle().then((r: any) => r.data)
  if (!book) return null
  const { data: links } = await admin.from('playbook_ads').select('ad_id, position').eq('playbook_id', book.id).order('position').limit(200)
  const ids = (links || []).map((l: any) => l.ad_id).filter((id: string) => id !== adId)
  if (!ids.length) return { book, ads: [] }
  const idx = (links || []).findIndex((l: any) => l.ad_id === adId)
  const nextIds = [...ids.slice(Math.max(0, idx)), ...ids.slice(0, Math.max(0, idx))].slice(0, 8)
  const { data: rows } = await admin.from('discovery_ads_index')
    .select('ad_id, page_name, days_running, discovery_creatives(asset_type, r2_url, poster_url)')
    .in('ad_id', nextIds)
  const byId = new Map((rows || []).map((r: any) => [r.ad_id, r]))
  const ads = nextIds.map((id: string) => byId.get(id)).filter(Boolean)
  return { book, ads }
}

const mediaOf = (a: any) => {
  const cres = Array.isArray(a.discovery_creatives) ? a.discovery_creatives : (a.discovery_creatives ? [a.discovery_creatives] : [])
  const cre = cres.find((c: any) => (c.asset_type === 'video' ? c.poster_url : c.r2_url)) || cres[0]
  if (!cre) return null
  const isVid = cre.asset_type === 'video'
  return { image: isVid ? cre.poster_url : cre.r2_url, videoUrl: isVid ? cre.r2_url : null, isVideo: isVid }
}

export async function generateMetadata({ params }: { params: { adId: string } }): Promise<Metadata> {
  const { ad } = await getAd(params.adId)
  const brand = ad?.page_name || 'This brand'
  return {
    title: ad ? `${brand} ad — ${[ad.hook_type, ad.format_style].filter(Boolean).join(' · ') || 'creative'} breakdown | Selfmade Knowledge` : 'Ad | Selfmade Knowledge',
    description: ad ? `${brand}'s ad decoded: ${ad.days_running ? `running ${ad.days_running} days, ` : ''}hook, format and creative DNA — live from the Selfmade marketing knowledge graph.` : 'Ad breakdown from the Selfmade marketing knowledge graph.',
    alternates: { canonical: `/knowledge/ad/${params.adId}` },
  }
}

export default async function AdKnowledgePage({ params, searchParams }: { params: { adId: string }; searchParams: { pb?: string } }) {
  const { ad, similar } = await getAd(params.adId)
  const pbNext = searchParams?.pb ? await getPlaybookNext(searchParams.pb, params.adId) : null
  if (!ad) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#f6f8f5', fontFamily: "'Inter',sans-serif", color: MUTED }}>
        <div style={{ textAlign: 'center' }}>This ad isn&rsquo;t in the knowledge graph yet.<br /><Link href="/" style={{ color: '#2f7a3f', fontWeight: 700 }}>← Selfmade</Link></div>
      </div>
    )
  }
  const m = mediaOf(ad)
  const dna = [ad.hook_type && ['hook', ad.hook_type], ad.format_style && ['format', ad.format_style], ad.visual_style && ['visual', ad.visual_style], ad.niche && ['niche', ad.niche]].filter(Boolean) as [string, string][]
  const countries: string[] = (ad.targeted_countries || []).slice(0, 8)

  return (
    <KnowledgeChrome>
    <div style={{ minHeight: '100vh', background: '#f6f8f5', fontFamily: "'Inter', -apple-system, sans-serif", color: INK }}>
      <TrailRecorder node={`ad:${params.adId}`} />
      {pbNext?.book && (
        <div style={{ maxWidth: 880, margin: '0 auto', padding: '14px 22px 0' }}>
          <Link href={`/playbooks/${pbNext.book.slug}`} style={{ fontSize: 12.5, fontWeight: 700, color: MUTED, textDecoration: 'none' }}>← {pbNext.book.emoji || ''} {pbNext.book.title}</Link>
        </div>
      )}

      <div style={{ maxWidth: 880, margin: '0 auto', padding: '30px 22px 90px', display: 'grid', gridTemplateColumns: 'minmax(240px, 340px) 1fr', gap: 30, alignItems: 'start' }}>
        {/* media */}
        <div style={{ position: 'relative', borderRadius: 16, overflow: 'hidden', background: '#0d120e', border: `1px solid ${LINE}` }}>
          {m?.videoUrl
            /* WATCH — plays the moment you arrive (muted, per platform rules); controls for sound */
            ? <video src={m.videoUrl} poster={m.image || undefined} controls playsInline autoPlay muted loop style={{ width: '100%', display: 'block' }} />
            /* eslint-disable-next-line @next/next/no-img-element */
            : m?.image ? <img src={m.image} alt={`${ad.page_name} ad`} style={{ width: '100%', display: 'block' }} /> : <div style={{ aspectRatio: '3/4' }} />}
        </div>

        {/* the file */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.12em', color: MUTED, textTransform: 'uppercase' }}>Ad · on record</div>
          <h1 style={{ margin: '6px 0 4px', fontSize: 26, fontWeight: 800, letterSpacing: '-.02em' }}>
            <Link href={`/knowledge/brand/${ad.page_id}`} style={{ color: INK, textDecoration: 'none', borderBottom: `2px solid ${LIME}` }}>{ad.page_name || 'Unknown brand'}</Link>
          </h1>
          <div style={{ fontSize: 12.5, color: MUTED, fontWeight: 600, marginBottom: 16 }}>
            {ad.is_active ? '🟢 running now' : '⚪ not currently running'}{ad.days_running ? ` · ${ad.days_running} days${ad.days_running >= 21 ? ' — a survivor' : ''}` : ''}{ad.start_date ? ` · first seen ${new Date(ad.start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}
          </div>

          {dna.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.14em', color: MUTED, textTransform: 'uppercase', marginBottom: 8 }}>Creative DNA</div>
              <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                {dna.map(([k, v]) => <span key={k} style={{ background: '#fff', border: `1px solid ${LINE}`, fontSize: 12, fontWeight: 750, borderRadius: 100, padding: '7px 13px' }}><span style={{ color: MUTED }}>{k}</span> · {v}</span>)}
                {(ad.topics || []).slice(0, 4).map((t: string) => <span key={t} style={{ background: '#f4fbe6', color: '#2c4a1f', fontSize: 12, fontWeight: 750, borderRadius: 100, padding: '7px 13px' }}>{t}</span>)}
              </div>
            </div>
          )}

          {countries.length > 0 && (
            <div style={{ marginBottom: 4, fontSize: 13, color: MUTED }}><b style={{ color: INK }}>Where it runs:</b> {countries.join(', ')}{(ad.targeted_countries || []).length > 8 ? ` +${(ad.targeted_countries || []).length - 8} more` : ''}</div>
          )}

          {/* UNDERSTAND — Mello's why-this-works, generated on first visit, cached forever */}
          <Understand adId={params.adId} />

          {/* REMAKE — the entire business in one button; routes into the logged-in remake flow */}
          <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap', alignItems: 'center' }}>
            {/* Image ads → the two-pane studio; VIDEO ads → the existing video-clone flow (untouched) */}
            <Link href={m?.isVideo ? `/discovery/${params.adId}` : `/studio?ad=${encodeURIComponent(params.adId)}${m?.image ? `&img=${encodeURIComponent(m.image)}` : ''}${ad.page_name ? `&brand=${encodeURIComponent(ad.page_name)}` : ''}`} style={{ background: LIME, color: FOREST, fontSize: 14.5, fontWeight: 850, padding: '13px 24px', borderRadius: 100, textDecoration: 'none', boxShadow: '0 14px 30px -14px rgba(23,37,28,.45)' }}>✨ Remake for my brand</Link>
            <Link href={`/knowledge/brand/${ad.page_id}`} style={{ background: '#fff', border: `1.5px solid ${LINE}`, color: INK, fontSize: 13, fontWeight: 800, padding: '11px 18px', borderRadius: 100, textDecoration: 'none' }}>The brand&rsquo;s full file →</Link>
          </div>
        </div>
      </div>

      {/* Next in this playbook — keep exploring inside the exhibition */}
      {pbNext?.book && pbNext.ads.length > 0 && (
        <div style={{ maxWidth: 880, margin: '0 auto', padding: '0 22px 40px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.14em', color: MUTED, textTransform: 'uppercase' }}>Next in {pbNext.book.emoji || ''} {pbNext.book.title}</div>
            <Link href={`/playbooks/${pbNext.book.slug}`} style={{ fontSize: 12, color: '#2f7a3f', fontWeight: 750, textDecoration: 'none', marginLeft: 'auto' }}>See all →</Link>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10 }}>
            {pbNext.ads.map((s: any) => { const sm = mediaOf(s); if (!sm?.image) return null
              return (
                <Link key={s.ad_id} href={`/knowledge/ad/${s.ad_id}?pb=${pbNext.book.slug}`} style={{ display: 'block', position: 'relative', aspectRatio: '3/4', borderRadius: 12, overflow: 'hidden', background: '#0d120e', border: `1px solid ${LINE}` }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={sm.image} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  {sm.isVideo && <span style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#fff', fontSize: 17, textShadow: '0 2px 8px rgba(0,0,0,.5)' }}>▶</span>}
                </Link>
              )})}
          </div>
        </div>
      )}

      {/* similar — a taste */}
      {similar.length > 0 && (
        <div style={{ maxWidth: 880, margin: '0 auto', padding: '0 22px 80px' }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.14em', color: MUTED, textTransform: 'uppercase', marginBottom: 10 }}>More from {ad.page_name}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10 }}>
            {similar.map((s: any) => { const sm = mediaOf(s); if (!sm?.image) return null
              return (
                <Link key={s.ad_id} href={`/knowledge/ad/${s.ad_id}`} style={{ display: 'block', position: 'relative', aspectRatio: '3/4', borderRadius: 12, overflow: 'hidden', background: '#0d120e', border: `1px solid ${LINE}` }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={sm.image} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  {sm.isVideo && <span style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#fff', fontSize: 17, textShadow: '0 2px 8px rgba(0,0,0,.5)' }}>▶</span>}
                </Link>
              )})}
          </div>
        </div>
      )}
    </div>
    </KnowledgeChrome>
  )
}
