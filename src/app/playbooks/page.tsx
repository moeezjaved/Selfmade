/**
 * PLAYBOOKS · the entrance — Spotify, not Wikipedia.
 * A wall of curated playbooks ("Beauty Playbook · 100 winning beauty ads ·
 * updated today"), each cover a collage of the real ads inside. Public + SEO:
 * every playbook is an acquisition entrance that funnels Google → watch →
 * understand → Remake → app.
 */
import type { Metadata } from 'next'
import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/server'
import KnowledgeChrome from '@/components/app/KnowledgeChrome'

export const revalidate = 1800

const INK = '#111514', MUTED = '#7a827c', FAINT = '#adb3ae', LINE = '#eef0ee', FOREST = '#141d15', LIME = '#ff5a2c'

export const metadata: Metadata = {
  title: 'Marketing Playbooks — walls of winning ads, continuously updated | Selfmade',
  description: 'Explore curated playbooks of winning Facebook & Instagram ads by niche, hook and format. Watch them, understand why they work, remake them for your brand.',
  alternates: { canonical: '/playbooks' },
}

const ago = (iso: string) => {
  const h = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 3600e3))
  if (h < 1) return 'updated just now'
  if (h < 24) return `updated ${h} hour${h === 1 ? '' : 's'} ago`
  const d = Math.floor(h / 24)
  return d === 1 ? 'updated yesterday' : `updated ${d} days ago`
}

async function getPlaybooks() {
  const admin = createAdminClient() as any
  const { data: books } = await admin.from('playbooks').select('*').order('featured', { ascending: false }).order('sort_order').order('created_at')
  const out: any[] = []
  for (const b of books || []) {
    const { data: links } = await admin.from('playbook_ads').select('ad_id').eq('playbook_id', b.id).order('position').limit(5)
    const ids = (links || []).map((l: any) => l.ad_id)
    let covers: string[] = []
    let count = 0
    if (ids.length) {
      const [{ data: rows }, { count: c }] = await Promise.all([
        admin.from('discovery_ads_index').select('ad_id, discovery_creatives(asset_type, r2_url, poster_url)').in('ad_id', ids),
        admin.from('playbook_ads').select('ad_id', { count: 'exact', head: true }).eq('playbook_id', b.id),
      ])
      count = c || ids.length
      const byId = new Map((rows || []).map((r: any) => [r.ad_id, r]))
      covers = ids.map((id: string) => {
        const r: any = byId.get(id); if (!r) return null
        const cres = Array.isArray(r.discovery_creatives) ? r.discovery_creatives : (r.discovery_creatives ? [r.discovery_creatives] : [])
        const cre = cres.find((c2: any) => (c2.asset_type === 'video' ? c2.poster_url : c2.r2_url)) || cres[0]
        return cre ? (cre.asset_type === 'video' ? cre.poster_url : cre.r2_url) : null
      }).filter(Boolean) as string[]
    }
    if (covers.length >= 3) out.push({ ...b, covers, count })
  }
  return out
}

export default async function PlaybooksPage() {
  const books = await getPlaybooks()
  return (
    <KnowledgeChrome>
    <div style={{ minHeight: '100vh', background: '#fff', fontFamily: "'Inter', -apple-system, sans-serif", color: INK }}>

      <div style={{ maxWidth: 1060, margin: '0 auto', padding: '48px 26px 120px' }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.16em', textTransform: 'uppercase', color: FAINT }}>The library, curated</div>
        <h1 style={{ fontSize: 'clamp(30px,4.6vw,44px)', fontWeight: 800, letterSpacing: '-.033em', lineHeight: 1.06, margin: '10px 0 8px', maxWidth: '18ch' }}>Marketing Playbooks</h1>
        <p style={{ fontSize: 16, color: MUTED, maxWidth: '52ch', lineHeight: 1.6 }}>Walls of winning ads, continuously updated. Watch them. Understand why they work. Remake them for your brand.</p>

        {books.length === 0 && (
          <div style={{ marginTop: 40, color: MUTED, fontSize: 14.5 }}>The first playbooks are being hung — check back shortly.</div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 26, marginTop: 36 }}>
          {books.map((b: any) => (
            <Link key={b.id} href={`/playbooks/${b.slug}`} style={{ display: 'block', textDecoration: 'none', color: INK, borderRadius: 18, overflow: 'hidden', border: `1px solid ${LINE}`, background: '#fff', boxShadow: '0 30px 60px -42px rgba(10,20,12,.45)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gridAutoRows: 92, gap: 3, padding: 3 }}>
                {b.covers.slice(0, 5).map((u: string, i: number) => (
                  <span key={i} style={{ position: 'relative', overflow: 'hidden', borderRadius: 8, background: '#20241f', display: 'block', gridRow: i === 0 ? 'span 2' : undefined }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={u} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  </span>
                ))}
              </div>
              <div style={{ padding: '16px 20px 18px' }}>
                <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: '-.018em' }}>{b.emoji ? `${b.emoji} ` : ''}{b.title}</div>
                <div style={{ fontSize: 12.5, color: MUTED, fontWeight: 650, marginTop: 4 }}>{b.count} winning ads · {ago(b.updated_at)}</div>
              </div>
            </Link>
          ))}
        </div>

        <div style={{ marginTop: 60, background: FOREST, borderRadius: 20, padding: '26px 28px', color: '#f3eee3', maxWidth: 640 }}>
          <div style={{ fontSize: 16.5, fontWeight: 800, color: '#fff' }}>See one you&rsquo;d run?</div>
          <div style={{ fontSize: 13.5, color: '#b9c6b6', margin: '6px 0 15px', lineHeight: 1.6 }}>Every ad in every playbook has a Remake button — Mello rebuilds it around your product in minutes.</div>
          <Link href="/hire" style={{ display: 'inline-block', background: '#ef4a1e', color: '#fff', fontSize: 13.5, fontWeight: 800, padding: '11px 20px', borderRadius: 100, textDecoration: 'none' }}>Hire Mello →</Link>
        </div>
      </div>
    </div>
    </KnowledgeChrome>
  )
}
