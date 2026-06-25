'use client'
/**
 * Top Picks — directory of expert-curated ad packs (Atria/Foreplay style). Lists published experts
 * and their packs; each pack opens a detail page with the favorite ads + Canva "Edit in template".
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Star, ImageIcon, LayoutTemplate, Sparkles, ArrowRight } from 'lucide-react'

const LIME = '#dffe95'
const DARK = '#1a3a1a'
const dollars = (cents: number) => (cents / 100)

interface Pack {
  id: string; title: string; description: string | null; cover_url: string | null
  price_cents: number; original_price_cents: number | null; is_early_bird: boolean
  gate: 'free' | 'core' | 'paid'; ad_count: number
  expert: { id: string; name: string; handle: string | null; avatar_url: string | null }
}
interface Expert {
  id: string; name: string; handle: string | null; avatar_url: string | null; bio: string | null
  packs: { id: string }[]
}

function PriceTag({ p }: { p: Pack }) {
  if (p.gate === 'free' || p.price_cents === 0) return <span style={{ fontWeight: 800, color: DARK }}>Free</span>
  if (p.gate === 'core') return <span style={{ fontWeight: 700, color: '#9333ea', fontSize: 13 }}>Core</span>
  return (
    <span style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
      <span style={{ fontWeight: 800, color: DARK }}>${dollars(p.price_cents).toFixed(0)}</span>
      {p.original_price_cents ? <span style={{ fontSize: 12, color: '#9ca3af', textDecoration: 'line-through' }}>${dollars(p.original_price_cents).toFixed(0)}</span> : null}
    </span>
  )
}

function Avatar({ url, name, size = 28 }: { url: string | null; name: string; size?: number }) {
  if (url) return <img src={url} alt={name} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: DARK, color: LIME, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.42, fontWeight: 700, flexShrink: 0 }}>
      {name.slice(0, 1).toUpperCase()}
    </div>
  )
}

export default function TopPicksPage() {
  const [experts, setExperts] = useState<Expert[]>([])
  const [packs, setPacks] = useState<Pack[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      try {
        const r = await fetch('/api/discovery/top-picks')
        const d = await r.json()
        if (!r.ok) throw new Error(d.error || 'failed')
        setExperts(d.experts || []); setPacks(d.packs || [])
      } catch (e) { setError(e instanceof Error ? e.message : 'failed to load') }
      finally { setLoading(false) }
    })()
  }, [])

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <Star size={24} style={{ color: DARK, fill: LIME }} />
        <h1 style={{ fontSize: 26, fontWeight: 800, color: '#111', margin: 0 }}>Top Picks</h1>
      </div>
      <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 18, maxWidth: 640 }}>
        Hand-picked winning ads from top media buyers — each with a ready-to-edit Canva template.
        Find an ad you love, open its template, and make it yours in minutes.
      </p>

      {/* Flow banner (Atria-style) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', background: '#f8faf0', border: `1px solid ${LIME}`, borderRadius: 12, padding: '12px 18px', marginBottom: 28 }}>
        <Step icon={<ImageIcon size={16} />} text="Pick an ad you like" />
        <ArrowRight size={15} style={{ color: '#9ca3af' }} />
        <Step icon={<LayoutTemplate size={16} />} text='Click "Edit in template" → open in Canva' />
        <ArrowRight size={15} style={{ color: '#9ca3af' }} />
        <Step icon={<Sparkles size={16} />} text='Click "Make ad copy" to rewrite with AI' />
      </div>

      {error && <div style={{ background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 16 }}>{error}</div>}

      {loading ? (
        <div style={{ color: '#9ca3af', fontSize: 14 }}>Loading…</div>
      ) : packs.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: '#9ca3af' }}>
          <Star size={36} style={{ color: '#d1d5db', marginBottom: 10 }} />
          <p style={{ fontSize: 15, fontWeight: 600, color: '#6b7280' }}>No expert packs published yet.</p>
          <p style={{ fontSize: 13 }}>Add experts and packs in the admin to populate this page.</p>
        </div>
      ) : (
        <>
          {/* Experts strip */}
          {experts.length > 0 && (
            <div style={{ marginBottom: 30 }}>
              <h2 style={{ fontSize: 13, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>Experts</h2>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {experts.map(e => (
                  <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '10px 16px 10px 12px' }}>
                    <Avatar url={e.avatar_url} name={e.name} size={36} />
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#111' }}>{e.name}</div>
                      <div style={{ fontSize: 12, color: '#9ca3af' }}>{e.handle ? `@${e.handle.replace(/^@/, '')} · ` : ''}{e.packs.length} pack{e.packs.length === 1 ? '' : 's'}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Packs grid */}
          <h2 style={{ fontSize: 13, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>Packs</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 18 }}>
            {packs.map(p => (
              <Link key={p.id} href={`/discovery/top-picks/${p.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, overflow: 'hidden', transition: 'box-shadow .15s, transform .15s', height: '100%', display: 'flex', flexDirection: 'column' }}
                  onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.08)'; e.currentTarget.style.transform = 'translateY(-2px)' }}
                  onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'none' }}>
                  {/* Cover */}
                  <div style={{ position: 'relative', height: 150, background: p.cover_url ? `center/cover no-repeat url(${p.cover_url})` : `linear-gradient(135deg, ${DARK}, #2d5a2d)` }}>
                    {p.is_early_bird && (
                      <span style={{ position: 'absolute', top: 10, right: 10, background: LIME, color: DARK, fontSize: 11, fontWeight: 800, padding: '3px 9px', borderRadius: 20, display: 'flex', alignItems: 'center', gap: 4 }}>
                        ⚡ EARLY BIRD
                      </span>
                    )}
                    {!p.cover_url && <Star size={34} style={{ color: LIME, position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', opacity: 0.5 }} />}
                  </div>
                  {/* Body */}
                  <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Avatar url={p.expert.avatar_url} name={p.expert.name} size={22} />
                      <span style={{ fontSize: 12, color: '#6b7280', fontWeight: 600 }}>{p.expert.name}</span>
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: '#111', lineHeight: 1.25 }}>{p.title}</div>
                    <div style={{ fontSize: 12, color: '#9ca3af', fontWeight: 600 }}>{p.ad_count} Ads · {p.ad_count} Templates</div>
                    {p.description && <div style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.description}</div>}
                    <div style={{ marginTop: 'auto', paddingTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <PriceTag p={p} />
                      <span style={{ fontSize: 13, fontWeight: 700, color: DARK, display: 'flex', alignItems: 'center', gap: 4 }}>View <ArrowRight size={14} /></span>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function Step({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: DARK, fontWeight: 600 }}>
      <span style={{ color: DARK }}>{icon}</span>{text}
    </span>
  )
}
