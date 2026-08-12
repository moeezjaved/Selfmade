/**
 * KNOWLEDGE · Brand entity page — the IMDb model: one living page per advertiser, public + SEO.
 * Top of page (public): identity, status, evidence counts, DNA mix, a taste of the live ads.
 * Depth (full catalog, timelines, Ask Mello) is account-gated — Wikipedia's openness, Bloomberg's
 * paywall depth. Server-rendered from brand_directory + discovery_ads_index + discovery_creatives.
 * This is Phase 1 of the knowledge graph: the entity layer the collections/concepts link into.
 */
import type { Metadata } from 'next'
import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/server'
import TrailRecorder from '@/components/knowledge/TrailRecorder'
import KnowledgeChrome from '@/components/app/KnowledgeChrome'
import WatchBrandButton from './WatchBrandButton'

export const revalidate = 3600   // pages stay fresh-ish without hammering the DB

const INK = '#161c17', MUTED = '#6f6d5a', LINE = '#efece2', LIME = '#ff5a2c', FOREST = '#141d15', GREEN = '#ef4a1e'

async function getBrand(pageId: string) {
  const admin = createAdminClient() as any
  const [dir, ads] = await Promise.all([
    admin.from('brand_directory').select('page_id, name, avatar_url, industry, country, website, source_ad_count').eq('page_id', pageId).maybeSingle().then((r: any) => r.data),
    admin.from('discovery_ads_index')
      .select('ad_id, page_name, performance_score, format_style, hook_type, topics, is_active, last_seen, start_date, days_running, targeted_countries, discovery_creatives(asset_type, r2_url, poster_url)')
      .eq('page_id', pageId).order('performance_score', { ascending: false, nullsFirst: false }).limit(60)
      .then((r: any) => r.data || []),
  ])
  return { dir, ads }
}

const mediaOf = (a: any) => {
  const cres = Array.isArray(a.discovery_creatives) ? a.discovery_creatives : (a.discovery_creatives ? [a.discovery_creatives] : [])
  const cre = cres.find((c: any) => (c.asset_type === 'video' ? c.poster_url : c.r2_url)) || cres[0]
  if (!cre) return null
  const isVid = cre.asset_type === 'video'
  return { image: isVid ? cre.poster_url : cre.r2_url, isVideo: isVid }
}
const tally = (rows: any[], key: string) => {
  const m = new Map<string, number>()
  for (const r of rows) { const v = r[key]; if (v) m.set(v, (m.get(v) || 0) + 1) }
  return Array.from(m.entries()).sort((a, b) => b[1] - a[1])
}

export async function generateMetadata({ params }: { params: { pageId: string } }): Promise<Metadata> {
  const { dir, ads } = await getBrand(params.pageId)
  const name = dir?.name || ads[0]?.page_name || 'Brand'
  const n = ads.length
  return {
    title: `${name} — ads, hooks & creative strategy | Selfmade Knowledge`,
    description: `${name}'s advertising, decoded: ${n ? `${n}+ tracked ads, ` : ''}winning formats, hooks and creative DNA — live from the Selfmade marketing knowledge graph.`,
    alternates: { canonical: `/knowledge/brand/${params.pageId}` },
  }
}

export default async function BrandKnowledgePage({ params }: { params: { pageId: string } }) {
  const { dir, ads } = await getBrand(params.pageId)
  const name = dir?.name || ads[0]?.page_name || `Brand ${params.pageId}`
  const active = ads.filter((a: any) => a.is_active).length
  const longest = Math.max(0, ...ads.map((a: any) => Number(a.days_running) || 0))
  const countries = new Set<string>()
  for (const a of ads) for (const c of (a.targeted_countries || [])) countries.add(c)
  const hooks = tally(ads, 'hook_type').slice(0, 3)
  const formats = tally(ads, 'format_style').slice(0, 3)
  const withMedia = ads.map((a: any) => ({ ...a, m: mediaOf(a) })).filter((a: any) => a.m?.image)
  const videoShare = ads.length ? Math.round((withMedia.filter((a: any) => a.m.isVideo).length / Math.max(1, withMedia.length)) * 100) : 0

  return (
    <KnowledgeChrome>
    <div style={{ minHeight: '100vh', background: '#f6f8f5', fontFamily: "'Inter', -apple-system, sans-serif", color: INK }}>
      <TrailRecorder node={`brand:${params.pageId}`} />

      <div style={{ maxWidth: 880, margin: '0 auto', padding: '34px 22px 90px' }}>
        {/* identity */}
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 8 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {dir?.avatar_url ? <img src={dir.avatar_url} alt="" style={{ width: 58, height: 58, borderRadius: 16, objectFit: 'cover', border: `1px solid ${LINE}` }} /> : <span style={{ width: 58, height: 58, borderRadius: 16, background: '#efece2', display: 'inline-block' }} />}
          <div>
            <h1 style={{ margin: 0, fontSize: 30, fontWeight: 800, letterSpacing: '-.025em' }}>{name}</h1>
            <div style={{ fontSize: 13, color: MUTED, fontWeight: 600 }}>
              {[dir?.industry, dir?.country, dir?.website?.replace(/^https?:\/\//, '')].filter(Boolean).join(' · ') || 'Advertiser'}
            </div>
          </div>
          <span style={{ marginLeft: 'auto', fontSize: 10.5, fontWeight: 900, letterSpacing: '.06em', borderRadius: 8, padding: '5px 10px', background: active ? '#f4fbe6' : '#f1f4f0', color: active ? '#2c4a1f' : MUTED }}>
            {active ? `ADVERTISING NOW · ${active} LIVE` : 'QUIET'}
          </span>
        </div>

        {/* evidence — the receipts row */}
        <div style={{ display: 'flex', gap: 26, flexWrap: 'wrap', margin: '20px 0 26px', background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16, padding: '16px 20px' }}>
          {[[`${(dir?.source_ad_count || ads.length).toLocaleString()}`, 'ads tracked'], [`${active}`, 'running now'], [`${longest || '—'}`, 'longest run (days)'], [`${countries.size || '—'}`, 'countries'], [`${videoShare}%`, 'video share']].map(([v, l]) => (
            <div key={l as string}><div style={{ fontSize: 21, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{v}</div><div style={{ fontSize: 11, color: MUTED, fontWeight: 700 }}>{l}</div></div>
          ))}
        </div>

        {/* creative DNA */}
        {(hooks.length > 0 || formats.length > 0) && (
          <div style={{ marginBottom: 26 }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.14em', color: MUTED, textTransform: 'uppercase', marginBottom: 10 }}>Creative DNA</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {hooks.map(([h, n]) => <span key={h} style={{ background: '#eef6ff', color: '#1e4f8f', fontSize: 12, fontWeight: 750, borderRadius: 100, padding: '7px 13px' }}>hook · {h} ×{n}</span>)}
              {formats.map(([f, n]) => <span key={f} style={{ background: '#fff7ed', color: '#9a3412', fontSize: 12, fontWeight: 750, borderRadius: 100, padding: '7px 13px' }}>format · {f} ×{n}</span>)}
            </div>
          </div>
        )}

        {/* the work — a public taste (12), depth gated */}
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.14em', color: MUTED, textTransform: 'uppercase', marginBottom: 10 }}>Top ads on record</div>
        {withMedia.length === 0 && <div style={{ color: MUTED, fontSize: 14 }}>We haven&rsquo;t decoded this brand&rsquo;s creatives yet — Mello can start watching it today.</div>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
          {withMedia.slice(0, 12).map((a: any) => (
            <Link key={a.ad_id} href={`/knowledge/ad/${a.ad_id}`} style={{ display: 'block', position: 'relative', aspectRatio: '3/4', borderRadius: 12, overflow: 'hidden', background: '#0d120e', border: `1px solid ${LINE}` }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={a.m.image} alt={`${name} ad`} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              {a.m.isVideo && <span style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#fff', fontSize: 20, textShadow: '0 2px 8px rgba(0,0,0,.5)' }}>▶</span>}
              {!!a.days_running && a.days_running >= 21 && <span style={{ position: 'absolute', top: 7, left: 7, background: '#141d15d9', color: LIME, fontSize: 9, fontWeight: 800, padding: '3px 7px', borderRadius: 8 }}>{a.days_running}d · survivor</span>}
            </Link>
          ))}
        </div>

        {/* depth gate */}
        <div style={{ marginTop: 28, background: FOREST, borderRadius: 18, padding: '24px 26px', color: '#f3eee3', display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#fff' }}>The full file goes deeper.</div>
            <div style={{ fontSize: 13, color: '#b9c6b6', marginTop: 4 }}>Every ad {name} has run, the full timeline, hook-by-hook breakdowns — and Mello watching them for you every night.</div>
          </div>
          <WatchBrandButton pageId={params.pageId} name={name} />
        </div>
      </div>
    </div>
    </KnowledgeChrome>
  )
}
