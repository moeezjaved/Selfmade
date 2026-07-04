/**
 * /blog — public index of published posts. Server-rendered, ISR, SEO metadata. Renders a clean card
 * grid; empty state (no posts yet) stays noindex-friendly but never 404s.
 */
import Link from 'next/link'
import type { Metadata } from 'next'
import { getPublishedPosts, SITE_URL } from '@/lib/blog'

export const revalidate = 300
const LIME = '#dffe95', INK = '#0e1b12'

export const metadata: Metadata = {
  title: { absolute: 'Blog — Winning Meta Ad Strategies & Teardowns | Selfmade' },
  description: 'Playbooks, teardowns, and data on what makes Meta ads win — from the team behind Selfmade’s 3M+ ad library.',
  alternates: { canonical: '/blog' },
  openGraph: { title: 'Selfmade Blog — Winning Meta Ad Strategies', description: 'Playbooks, teardowns, and data on what makes Meta ads win.', url: `${SITE_URL}/blog`, type: 'website' },
}

const fmt = (d: string | null) => d ? new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : ''
function img(url: string, w = 800) {
  if (!url) return ''
  if (/r2\.dev|r2\.cloudflarestorage|\/\/pub-|\/\/cdn\./.test(url)) return url
  return `https://images.weserv.nl/?url=${encodeURIComponent(url)}&w=${w}&q=72&output=webp`
}

export default async function BlogIndex() {
  const posts = await getPublishedPosts()
  const [hero, ...rest] = posts

  const ld = posts.length > 0 ? {
    '@context': 'https://schema.org', '@type': 'Blog', '@id': `${SITE_URL}/blog`, name: 'Selfmade Blog', url: `${SITE_URL}/blog`,
    blogPost: posts.slice(0, 20).map((p) => ({ '@type': 'BlogPosting', headline: p.title, url: `${SITE_URL}/blog/${p.slug}`, datePublished: p.published_at })),
  } : null

  return (
    <div style={{ fontFamily: "'Inter',-apple-system,sans-serif", background: '#fff', color: INK, minHeight: '100vh' }}>
      {ld && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />}
      <nav style={{ borderBottom: '1px solid #f0f2ef' }}>
        <div style={{ maxWidth: 1120, margin: '0 auto', padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Link href="/home">{/* eslint-disable-next-line @next/next/no-img-element */}<img src="/logo.png" alt="Selfmade" style={{ height: 30, filter: 'brightness(0)' }} /></Link>
          <Link href="/signup" style={{ background: LIME, color: INK, padding: '9px 18px', borderRadius: 100, fontSize: 14, fontWeight: 800, textDecoration: 'none' }}>Start for free</Link>
        </div>
      </nav>

      <header style={{ maxWidth: 900, margin: '0 auto', padding: '56px 24px 24px' }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: '#16a34a', textTransform: 'uppercase', letterSpacing: '.08em' }}>The Selfmade Blog</div>
        <h1 style={{ fontSize: 'clamp(32px,5vw,50px)', fontWeight: 800, letterSpacing: '-.02em', margin: '10px 0 12px' }}>What makes Meta ads win</h1>
        <p style={{ fontSize: 18, color: '#4b5563', lineHeight: 1.6, maxWidth: 640 }}>Playbooks, teardowns, and data from inside a 3M+ ad library. Steal what works.</p>
      </header>

      {posts.length === 0 ? (
        <section style={{ maxWidth: 900, margin: '0 auto', padding: '10px 24px 80px' }}>
          <div style={{ background: '#fbfdfa', border: '1px solid #eef0ee', borderRadius: 16, padding: '28px', color: '#4b5563', fontSize: 16 }}>
            Fresh posts are on the way. In the meantime, <Link href="/signup" style={{ color: INK, fontWeight: 700 }}>start free</Link> and explore 3M+ winning ads yourself.
          </div>
        </section>
      ) : (
        <>
          {/* hero post */}
          <section style={{ maxWidth: 1120, margin: '0 auto', padding: '12px 24px 8px' }}>
            <Link href={`/blog/${hero.slug}`} style={{ textDecoration: 'none', color: 'inherit', display: 'grid', gridTemplateColumns: 'minmax(0,1.15fr) minmax(0,1fr)', gap: 28, alignItems: 'center', border: '1px solid #eef0ee', borderRadius: 22, overflow: 'hidden', background: '#fff' }}>
              <div style={{ aspectRatio: '16/10', background: '#0d120e' }}>
                {hero.cover_image_url && /* eslint-disable-next-line @next/next/no-img-element */ <img src={img(hero.cover_image_url, 900)} alt={hero.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
              </div>
              <div style={{ padding: '10px 28px 10px 4px' }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: '#16a34a', textTransform: 'uppercase', letterSpacing: '.06em' }}>Latest · {fmt(hero.published_at)}</div>
                <h2 style={{ fontSize: 'clamp(24px,3vw,34px)', fontWeight: 800, letterSpacing: '-.02em', margin: '10px 0 10px', lineHeight: 1.15 }}>{hero.title}</h2>
                <p style={{ fontSize: 16, color: '#4b5563', lineHeight: 1.6, margin: 0 }}>{hero.excerpt}</p>
              </div>
            </Link>
          </section>

          {/* grid */}
          <section style={{ maxWidth: 1120, margin: '0 auto', padding: '28px 24px 80px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(320px,1fr))', gap: 26 }}>
              {rest.map((p) => (
                <Link key={p.slug} href={`/blog/${p.slug}`} style={{ textDecoration: 'none', color: 'inherit', border: '1px solid #eef0ee', borderRadius: 18, overflow: 'hidden', background: '#fff', display: 'flex', flexDirection: 'column' }}>
                  <div style={{ aspectRatio: '16/9', background: '#0d120e' }}>
                    {p.cover_image_url && /* eslint-disable-next-line @next/next/no-img-element */ <img src={img(p.cover_image_url, 640)} alt={p.title} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                  </div>
                  <div style={{ padding: '16px 18px 20px' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.05em' }}>{fmt(p.published_at)}</div>
                    <h3 style={{ fontSize: 19, fontWeight: 800, letterSpacing: '-.01em', margin: '8px 0 8px', lineHeight: 1.25 }}>{p.title}</h3>
                    <p style={{ fontSize: 14.5, color: '#6b7280', lineHeight: 1.55, margin: 0, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.excerpt}</p>
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
