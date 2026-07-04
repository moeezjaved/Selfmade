/**
 * /blog — public index. Dark, Vox/Motion-style editorial layout in Selfmade's palette: near-black
 * green-tinted background, lime accents, bold category tags, vibrant gradient thumbnail fallbacks
 * (so cards look designed even before a real Vox-style cover is uploaded). Server-rendered, ISR, SEO.
 */
import Link from 'next/link'
import type { Metadata } from 'next'
import { getPublishedPosts, SITE_URL } from '@/lib/blog'
import { coverStyle, catStyle, categoryOf } from './_style'

export const revalidate = 300
const BG = '#0a0d0c', LIME = '#dffe95', CARD = '#121614'

export const metadata: Metadata = {
  title: { absolute: 'Blog — Winning Meta Ad Strategies & Teardowns | Selfmade' },
  description: 'Playbooks, teardowns, and data on what makes Meta ads win — from the team behind Selfmade’s 3M+ ad library.',
  alternates: { canonical: '/blog' },
  openGraph: { title: 'Selfmade Blog — Winning Meta Ad Strategies', description: 'Playbooks, teardowns, and data on what makes Meta ads win.', url: `${SITE_URL}/blog`, type: 'website' },
}

const fmt = (d: string | null) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''

export default async function BlogIndex() {
  const posts = await getPublishedPosts()
  const [hero, ...rest] = posts

  const ld = posts.length > 0 ? {
    '@context': 'https://schema.org', '@type': 'Blog', '@id': `${SITE_URL}/blog`, name: 'Selfmade Blog', url: `${SITE_URL}/blog`,
    blogPost: posts.slice(0, 20).map((p) => ({ '@type': 'BlogPosting', headline: p.title, url: `${SITE_URL}/blog/${p.slug}`, datePublished: p.published_at })),
  } : null

  return (
    <div style={{ fontFamily: "'Inter',-apple-system,sans-serif", background: BG, color: '#f4f7f4', minHeight: '100vh' }}>
      {ld && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />}
      <nav style={{ borderBottom: '1px solid rgba(255,255,255,.07)', position: 'sticky', top: 0, background: 'rgba(10,13,12,.8)', backdropFilter: 'blur(12px)', zIndex: 50 }}>
        <div style={{ maxWidth: 1160, margin: '0 auto', padding: '15px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Link href="/home">{/* eslint-disable-next-line @next/next/no-img-element */}<img src="/logo.png" alt="Selfmade" style={{ height: 30, filter: 'brightness(0) invert(1)' }} /></Link>
          <Link href="/signup" style={{ background: LIME, color: '#0a0d0c', padding: '9px 18px', borderRadius: 100, fontSize: 14, fontWeight: 800, textDecoration: 'none' }}>Start for free</Link>
        </div>
      </nav>

      <header style={{ maxWidth: 1160, margin: '0 auto', padding: '54px 24px 30px' }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: LIME, textTransform: 'uppercase', letterSpacing: '.1em' }}>The Selfmade Blog</div>
        <h1 style={{ fontSize: 'clamp(34px,5.5vw,56px)', fontWeight: 800, letterSpacing: '-.03em', margin: '12px 0 10px', lineHeight: 1.05 }}>What makes Meta ads win</h1>
        <p style={{ fontSize: 18, color: '#9aa39c', lineHeight: 1.6, maxWidth: 620 }}>Playbooks, teardowns, and data from inside a 3M+ ad library. Steal what works.</p>
      </header>

      {posts.length === 0 ? (
        <section style={{ maxWidth: 1160, margin: '0 auto', padding: '10px 24px 90px' }}>
          <div style={{ background: CARD, border: '1px solid rgba(255,255,255,.07)', borderRadius: 18, padding: 28, color: '#9aa39c', fontSize: 16 }}>
            Fresh posts are on the way. In the meantime, <Link href="/signup" style={{ color: LIME, fontWeight: 700 }}>start free</Link> and explore 3M+ winning ads yourself.
          </div>
        </section>
      ) : (
        <>
          {/* hero */}
          <section style={{ maxWidth: 1160, margin: '0 auto', padding: '4px 24px 8px' }}>
            <Link href={`/blog/${hero.slug}`} style={{ textDecoration: 'none', color: 'inherit', display: 'grid', gridTemplateColumns: 'minmax(0,1.25fr) minmax(0,1fr)', gap: 30, alignItems: 'center', border: '1px solid rgba(255,255,255,.08)', borderRadius: 22, overflow: 'hidden', background: CARD }}>
              <div style={{ position: 'relative', aspectRatio: '16/10', ...coverStyle(hero) }}>{!hero.cover_image_url && <CoverText title={hero.title} />}</div>
              <div style={{ padding: '10px 30px 12px 4px' }}>
                <span style={catStyle(hero)}>{categoryOf(hero)}</span>
                <h2 style={{ fontSize: 'clamp(24px,3vw,34px)', fontWeight: 800, letterSpacing: '-.02em', margin: '12px 0 10px', lineHeight: 1.14 }}>{hero.title}</h2>
                <p style={{ fontSize: 16, color: '#9aa39c', lineHeight: 1.6, margin: '0 0 12px' }}>{hero.excerpt}</p>
                <div style={{ fontSize: 13, color: '#6b746c' }}>{hero.author || 'Selfmade'} · {fmt(hero.published_at)}</div>
              </div>
            </Link>
          </section>

          {/* grid */}
          <section style={{ maxWidth: 1160, margin: '0 auto', padding: '30px 24px 90px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(310px,1fr))', gap: 26 }}>
              {rest.map((p) => (
                <Link key={p.slug} href={`/blog/${p.slug}`} style={{ textDecoration: 'none', color: 'inherit', border: '1px solid rgba(255,255,255,.08)', borderRadius: 18, overflow: 'hidden', background: CARD, display: 'flex', flexDirection: 'column' }}>
                  <div style={{ position: 'relative', aspectRatio: '16/9', ...coverStyle(p) }}>{!p.cover_image_url && <CoverText title={p.title} small />}</div>
                  <div style={{ padding: '15px 17px 19px', flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <span style={catStyle(p)}>{categoryOf(p)}</span>
                    <h3 style={{ fontSize: 18.5, fontWeight: 800, letterSpacing: '-.01em', margin: '10px 0 auto', lineHeight: 1.28 }}>{p.title}</h3>
                    <div style={{ fontSize: 12.5, color: '#6b746c', marginTop: 12 }}>{fmt(p.published_at)}</div>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  )
}

// Big title overlaid on a gradient — the Vox-style fallback when no cover image is set.
function CoverText({ title, small }: { title: string; small?: boolean }) {
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-end', padding: small ? 18 : 28 }}>
      <span style={{ color: '#0a0d0c', fontWeight: 800, letterSpacing: '-.02em', lineHeight: 1.08, fontSize: small ? 22 : 32, textShadow: '0 1px 0 rgba(255,255,255,.25)' }}>{title}</span>
    </div>
  )
}
