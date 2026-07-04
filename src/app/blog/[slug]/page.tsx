/**
 * /blog/[slug] — a published post. Dark Motion-style reading page in Selfmade's palette: near-black
 * background, off-white prose, colorful Vox-style hero, lime accents. Full SEO (Article JSON-LD,
 * canonical, OG/Twitter). Unknown/unpublished slug → 404.
 */
import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { getPostBySlug, getPublishedPosts, renderMarkdown, readingTimeMin, SITE_URL } from '@/lib/blog'
import { coverStyle, catStyle, categoryOf } from '../_style'

export const revalidate = 300
const BG = '#0a0d0c', LIME = '#dffe95', CARD = '#121614'

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
    title: { absolute: `${post.title} | Selfmade Blog` }, description: desc,
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: { type: 'article', title: post.title, description: desc, url: `${SITE_URL}/blog/${post.slug}`, images: post.cover_image_url ? [img(post.cover_image_url, 1200)] : undefined, publishedTime: post.published_at || undefined },
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
    '@context': 'https://schema.org', '@type': 'BlogPosting', headline: post.title,
    description: post.meta_description || post.excerpt || undefined,
    image: post.cover_image_url ? img(post.cover_image_url, 1200) : undefined,
    datePublished: post.published_at || undefined, dateModified: post.updated_at || undefined,
    author: { '@type': 'Organization', name: post.author || 'Selfmade' },
    publisher: { '@type': 'Organization', name: 'Selfmade', logo: { '@type': 'ImageObject', url: `${SITE_URL}/logo.png` } },
    mainEntityOfPage: `${SITE_URL}/blog/${post.slug}`,
  }

  return (
    <div style={{ fontFamily: "'Inter',-apple-system,sans-serif", background: BG, color: '#e8ece7', minHeight: '100vh' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
      <style>{`
        .prose{font-size:18px;line-height:1.8;color:#c7cdc6}
        .prose h2{font-size:28px;font-weight:800;letter-spacing:-.02em;margin:42px 0 14px;color:#f4f7f4}
        .prose h3{font-size:22px;font-weight:800;margin:32px 0 10px;color:#f4f7f4}
        .prose h4{font-size:18px;font-weight:800;margin:26px 0 8px;color:#f4f7f4}
        .prose p{margin:0 0 22px}
        .prose a{color:${LIME};text-decoration:underline;text-underline-offset:2px}
        .prose ul,.prose ol{margin:0 0 22px;padding-left:24px}
        .prose li{margin:7px 0}
        .prose strong{color:#f4f7f4}
        .prose blockquote{margin:26px 0;padding:10px 22px;border-left:4px solid ${LIME};background:#121614;color:#e8ece7;font-style:italic;font-size:20px;border-radius:0 10px 10px 0}
        .prose code{background:#1a201d;padding:2px 6px;border-radius:6px;font-size:.9em;font-family:ui-monospace,monospace;color:#dffe95}
        .prose pre{background:#050706;border:1px solid rgba(255,255,255,.08);color:#e5e7eb;padding:18px 20px;border-radius:12px;overflow-x:auto;margin:0 0 22px}
        .prose pre code{background:none;padding:0;color:inherit}
        .prose img{max-width:100%;border-radius:14px;margin:8px 0}
        .prose figure{margin:26px 0}
        .prose figcaption{font-size:14px;color:#6b746c;text-align:center;margin-top:8px}
        .prose hr{border:none;border-top:1px solid rgba(255,255,255,.08);margin:38px 0}
      `}</style>

      <nav style={{ borderBottom: '1px solid rgba(255,255,255,.07)' }}>
        <div style={{ maxWidth: 1160, margin: '0 auto', padding: '15px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Link href="/">{/* eslint-disable-next-line @next/next/no-img-element */}<img src="/logo.png" alt="Selfmade" style={{ height: 30, filter: 'brightness(0) invert(1)' }} /></Link>
          <Link href="/signup" style={{ background: LIME, color: BG, padding: '9px 18px', borderRadius: 100, fontSize: 14, fontWeight: 800, textDecoration: 'none' }}>Start for free</Link>
        </div>
      </nav>

      <article style={{ maxWidth: 760, margin: '0 auto', padding: '46px 24px 20px' }}>
        <Link href="/blog" style={{ fontSize: 13.5, fontWeight: 700, color: LIME, textDecoration: 'none' }}>← All posts</Link>
        <div style={{ margin: '18px 0 0' }}><span style={catStyle(post)}>{categoryOf(post)}</span></div>
        <h1 style={{ fontSize: 'clamp(30px,4.6vw,48px)', fontWeight: 800, letterSpacing: '-.03em', lineHeight: 1.1, margin: '12px 0 14px', color: '#f7faf6' }}>{post.title}</h1>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', color: '#8a938c', fontSize: 14.5 }}>
          <span style={{ fontWeight: 600, color: '#c7cdc6' }}>{post.author || 'Selfmade'}</span><span>·</span><span>{fmt(post.published_at)}</span><span>·</span><span>{mins} min read</span>
        </div>
      </article>

      <div style={{ maxWidth: 980, margin: '14px auto 0', padding: '0 24px' }}>
        <div style={{ position: 'relative', width: '100%', aspectRatio: '16/9', borderRadius: 20, overflow: 'hidden', ...coverStyle(post) }}>
          {!post.cover_image_url && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-end', padding: 36 }}>
              <span style={{ color: '#0a0d0c', fontWeight: 800, letterSpacing: '-.02em', fontSize: 'clamp(24px,4vw,44px)', lineHeight: 1.05 }}>{post.title}</span>
            </div>
          )}
        </div>
      </div>

      <div className="prose" style={{ maxWidth: 760, margin: '0 auto', padding: '38px 24px 24px' }} dangerouslySetInnerHTML={{ __html: html }} />

      <section style={{ maxWidth: 760, margin: '0 auto', padding: '20px 24px 44px' }}>
        <div style={{ background: `linear-gradient(135deg,${LIME},#a8e63d)`, borderRadius: 22, padding: '34px 30px', textAlign: 'center' }}>
          <h2 style={{ fontSize: 'clamp(22px,3.5vw,30px)', fontWeight: 800, letterSpacing: '-.02em', margin: '0 0 8px', color: '#0a0d0c' }}>Put this into practice</h2>
          <p style={{ color: 'rgba(10,13,12,.72)', margin: '0 0 18px', fontSize: 16 }}>Find a proven winner in your niche and make it yours — free to start.</p>
          <Link href="/signup" style={{ background: '#0a0d0c', color: '#fff', padding: '13px 26px', borderRadius: 100, fontSize: 15, fontWeight: 800, textDecoration: 'none' }}>Start for free →</Link>
        </div>
      </section>

      {related.length > 0 && (
        <section style={{ maxWidth: 1160, margin: '0 auto', padding: '10px 24px 80px', borderTop: '1px solid rgba(255,255,255,.07)' }}>
          <div style={{ fontSize: 13, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.08em', color: '#6b746c', margin: '30px 0 18px' }}>Continue reading</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 24 }}>
            {related.map((p) => (
              <Link key={p.slug} href={`/blog/${p.slug}`} style={{ textDecoration: 'none', color: 'inherit', border: '1px solid rgba(255,255,255,.08)', borderRadius: 16, overflow: 'hidden', background: CARD }}>
                <div style={{ position: 'relative', aspectRatio: '16/9', ...coverStyle(p) }}>
                  {!p.cover_image_url && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-end', padding: 16 }}><span style={{ color: '#0a0d0c', fontWeight: 800, fontSize: 19, lineHeight: 1.1 }}>{p.title}</span></div>}
                </div>
                <div style={{ padding: '14px 16px 18px' }}>
                  <span style={catStyle(p)}>{categoryOf(p)}</span>
                  <h3 style={{ fontSize: 17, fontWeight: 800, margin: '8px 0 0', lineHeight: 1.28, color: '#f4f7f4' }}>{p.title}</h3>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
