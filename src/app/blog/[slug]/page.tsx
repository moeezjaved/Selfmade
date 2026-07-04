/**
 * /blog/[slug] — a published post. Server-rendered, ISR, unique SEO metadata + Article JSON-LD,
 * beautiful prose typography. Unknown/unpublished slug → 404.
 */
import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { getPostBySlug, getPublishedPosts, renderMarkdown, readingTimeMin, SITE_URL } from '@/lib/blog'

export const revalidate = 300
const LIME = '#dffe95', INK = '#0e1b12'

const fmt = (d: string | null) => d ? new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : ''
function img(url: string, w = 1200) {
  if (!url) return ''
  if (/r2\.dev|r2\.cloudflarestorage|\/\/pub-|\/\/cdn\./.test(url)) return url
  return `https://images.weserv.nl/?url=${encodeURIComponent(url)}&w=${w}&q=75&output=webp`
}

export async function generateStaticParams() {
  const posts = await getPublishedPosts()
  return posts.slice(0, 200).map((p) => ({ slug: p.slug }))
}

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const post = await getPostBySlug(params.slug)
  if (!post) return { title: 'Post not found — Selfmade' }
  const desc = post.meta_description || post.excerpt || `${post.title} — from the Selfmade blog.`
  return {
    title: { absolute: `${post.title} | Selfmade Blog` },
    description: desc,
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: {
      type: 'article', title: post.title, description: desc, url: `${SITE_URL}/blog/${post.slug}`,
      images: post.cover_image_url ? [img(post.cover_image_url, 1200)] : undefined,
      publishedTime: post.published_at || undefined,
    },
    twitter: { card: 'summary_large_image', title: post.title, description: desc, images: post.cover_image_url ? [img(post.cover_image_url, 1200)] : undefined },
  }
}

export default async function BlogPost({ params }: { params: { slug: string } }) {
  const post = await getPostBySlug(params.slug)
  if (!post) notFound()

  const html = renderMarkdown(post.body_md)
  const mins = readingTimeMin(post.body_md)
  const related = (await getPublishedPosts()).filter((p) => p.slug !== post.slug).slice(0, 3)

  const ld = {
    '@context': 'https://schema.org', '@type': 'BlogPosting',
    headline: post.title, description: post.meta_description || post.excerpt || undefined,
    image: post.cover_image_url ? img(post.cover_image_url, 1200) : undefined,
    datePublished: post.published_at || undefined, dateModified: post.updated_at || undefined,
    author: { '@type': 'Organization', name: post.author || 'Selfmade' },
    publisher: { '@type': 'Organization', name: 'Selfmade', logo: { '@type': 'ImageObject', url: `${SITE_URL}/logo.png` } },
    mainEntityOfPage: `${SITE_URL}/blog/${post.slug}`,
  }

  return (
    <div style={{ fontFamily: "'Inter',-apple-system,sans-serif", background: '#fff', color: INK, minHeight: '100vh' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
      <style>{`
        .prose{font-size:18px;line-height:1.75;color:#1f2937}
        .prose h2{font-size:28px;font-weight:800;letter-spacing:-.02em;margin:40px 0 14px;color:${INK}}
        .prose h3{font-size:22px;font-weight:800;margin:32px 0 10px;color:${INK}}
        .prose h4{font-size:18px;font-weight:800;margin:26px 0 8px;color:${INK}}
        .prose p{margin:0 0 20px}
        .prose a{color:#16a34a;text-decoration:underline;text-underline-offset:2px}
        .prose ul,.prose ol{margin:0 0 20px;padding-left:24px}
        .prose li{margin:6px 0}
        .prose blockquote{margin:24px 0;padding:6px 20px;border-left:4px solid ${LIME};background:#fbfdfa;color:#374151;font-style:italic}
        .prose code{background:#f3f4f6;padding:2px 6px;border-radius:6px;font-size:.9em;font-family:ui-monospace,monospace}
        .prose pre{background:#0d120e;color:#e5e7eb;padding:18px 20px;border-radius:12px;overflow-x:auto;margin:0 0 22px}
        .prose pre code{background:none;padding:0;color:inherit}
        .prose img{max-width:100%;border-radius:14px;margin:8px 0}
        .prose figure{margin:24px 0}
        .prose figcaption{font-size:14px;color:#9ca3af;text-align:center;margin-top:8px}
        .prose hr{border:none;border-top:1px solid #eef0ee;margin:36px 0}
      `}</style>

      <nav style={{ borderBottom: '1px solid #f0f2ef' }}>
        <div style={{ maxWidth: 1120, margin: '0 auto', padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Link href="/home">{/* eslint-disable-next-line @next/next/no-img-element */}<img src="/logo.png" alt="Selfmade" style={{ height: 30, filter: 'brightness(0)' }} /></Link>
          <Link href="/signup" style={{ background: LIME, color: INK, padding: '9px 18px', borderRadius: 100, fontSize: 14, fontWeight: 800, textDecoration: 'none' }}>Start for free</Link>
        </div>
      </nav>

      <article style={{ maxWidth: 760, margin: '0 auto', padding: '48px 24px 20px' }}>
        <Link href="/blog" style={{ fontSize: 13.5, fontWeight: 700, color: '#16a34a', textDecoration: 'none' }}>← All posts</Link>
        <h1 style={{ fontSize: 'clamp(30px,4.5vw,46px)', fontWeight: 800, letterSpacing: '-.02em', lineHeight: 1.12, margin: '16px 0 14px' }}>{post.title}</h1>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', color: '#6b7280', fontSize: 14.5 }}>
          <span style={{ fontWeight: 600 }}>{post.author || 'Selfmade'}</span><span>·</span><span>{fmt(post.published_at)}</span><span>·</span><span>{mins} min read</span>
        </div>
      </article>

      {post.cover_image_url && (
        <div style={{ maxWidth: 980, margin: '10px auto 0', padding: '0 24px' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={img(post.cover_image_url, 1200)} alt={post.title} style={{ width: '100%', borderRadius: 20, aspectRatio: '16/9', objectFit: 'cover', background: '#0d120e' }} />
        </div>
      )}

      <div className="prose" style={{ maxWidth: 760, margin: '0 auto', padding: '36px 24px 24px' }} dangerouslySetInnerHTML={{ __html: html }} />

      {/* CTA */}
      <section style={{ maxWidth: 760, margin: '0 auto', padding: '20px 24px 40px' }}>
        <div style={{ background: `linear-gradient(135deg,${LIME},#a8e63d)`, borderRadius: 22, padding: '34px 30px', textAlign: 'center' }}>
          <h2 style={{ fontSize: 'clamp(22px,3.5vw,30px)', fontWeight: 800, letterSpacing: '-.02em', margin: '0 0 8px' }}>Put this into practice</h2>
          <p style={{ color: 'rgba(14,27,18,.72)', margin: '0 0 18px', fontSize: 16 }}>Find a proven winner in your niche and make it yours — free to start.</p>
          <Link href="/signup" style={{ background: INK, color: '#fff', padding: '13px 26px', borderRadius: 100, fontSize: 15, fontWeight: 800, textDecoration: 'none' }}>Start for free →</Link>
        </div>
      </section>

      {related.length > 0 && (
        <section style={{ maxWidth: 1120, margin: '0 auto', padding: '10px 24px 70px', borderTop: '1px solid #f0f2ef' }}>
          <div style={{ fontSize: 13, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.06em', color: '#9ca3af', margin: '28px 0 16px' }}>Keep reading</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 22 }}>
            {related.map((p) => (
              <Link key={p.slug} href={`/blog/${p.slug}`} style={{ textDecoration: 'none', color: 'inherit', border: '1px solid #eef0ee', borderRadius: 16, overflow: 'hidden', background: '#fff' }}>
                <div style={{ aspectRatio: '16/9', background: '#0d120e' }}>
                  {p.cover_image_url && /* eslint-disable-next-line @next/next/no-img-element */ <img src={img(p.cover_image_url, 560)} alt={p.title} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                </div>
                <div style={{ padding: '14px 16px 18px' }}>
                  <h3 style={{ fontSize: 17, fontWeight: 800, margin: 0, lineHeight: 1.25 }}>{p.title}</h3>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
