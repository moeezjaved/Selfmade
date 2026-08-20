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
const BG = '#1c1611', LIME = '#ef4a1e', CARD = '#ffffff'

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
    <div style={{ fontFamily: "'Inter',-apple-system,sans-serif", backgroundColor: '#faf7f1', backgroundImage: `radial-gradient(1100px 520px at 8% -10%, rgba(239,74,30,.06), transparent 55%), radial-gradient(820px 420px at 100% -4%, rgba(239,74,30,.045), transparent 55%)`, backgroundRepeat: 'no-repeat, no-repeat', color: '#1c1611', minHeight: '100vh' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=Newsreader:opsz,ital,wght@6..72,0,400;6..72,0,500;6..72,0,600;6..72,1,400&family=JetBrains+Mono:wght@500&display=swap" />
      <div className="sf-progress" aria-hidden />
      <style>{`
        /* Scroll progress — pure CSS, no JS. Hidden where scroll-timeline is unsupported. */
        @keyframes sf-prog{from{transform:scaleX(0)}to{transform:scaleX(1)}}
        .sf-progress{position:fixed;top:0;left:0;height:3px;width:100%;transform:scaleX(0);transform-origin:0 50%;background:linear-gradient(90deg,${LIME},#ffb08a);z-index:60;animation:sf-prog auto linear;animation-timeline:scroll(root)}
        @supports not (animation-timeline:scroll()){.sf-progress{display:none}}

        /* Editorial body: dark serif on warm paper — high contrast, easy to read. */
        .prose{font-family:'Newsreader',Georgia,'Times New Roman',serif;font-size:20px;line-height:1.75;color:#2c2419;letter-spacing:.002em}
        .prose>p:first-of-type{font-size:22px;color:#1c1611}
        .prose>p:first-of-type::first-letter{float:left;font-family:'Fraunces',Georgia,serif;font-weight:700;font-size:80px;line-height:.72;padding:8px 14px 0 0;color:${LIME}}
        .prose h2{font-family:'Fraunces',Georgia,serif;font-size:32px;font-weight:700;letter-spacing:-.01em;line-height:1.15;margin:56px 0 16px;color:#1c1611}
        .prose h3{font-family:'Fraunces',Georgia,serif;font-size:24px;font-weight:600;margin:40px 0 10px;color:#1c1611}
        .prose h4{font-size:20px;font-weight:700;margin:28px 0 8px;color:#1c1611}
        .prose p{margin:0 0 24px}
        .prose a{color:${LIME};text-decoration:none;border-bottom:1px solid rgba(239,74,30,.4);transition:border-color .15s}
        .prose a:hover{border-color:${LIME}}
        .prose ul,.prose ol{margin:0 0 24px;padding-left:26px}
        .prose li{margin:9px 0}
        .prose li::marker{color:${LIME}}
        .prose strong{color:#1c1611;font-weight:600}
        .prose em{color:#1c1611}
        /* blockquote → pull-quote callout */
        .prose blockquote{margin:34px 0;padding:24px 28px 22px;border:1px solid rgba(239,74,30,.22);background:linear-gradient(180deg,rgba(239,74,30,.06),rgba(239,74,30,.02));color:#1c1611;font-family:'Fraunces',Georgia,serif;font-style:normal;font-size:23px;line-height:1.42;border-radius:16px;position:relative}
        .prose blockquote::before{content:'\\201C';position:absolute;top:2px;left:16px;font-family:'Fraunces',serif;font-size:56px;color:rgba(239,74,30,.32);line-height:1}
        .prose blockquote p{margin:0}
        .prose code{font-family:'JetBrains Mono',ui-monospace,monospace;background:#f1ebe1;padding:2px 7px;border-radius:6px;font-size:.8em;color:#c0390f}
        .prose pre{background:#211a13;border:1px solid rgba(28,22,17,.14);color:#f0ece4;padding:18px 20px;border-radius:14px;overflow-x:auto;margin:0 0 24px;font-size:14.5px}
        .prose pre code{background:none;padding:0;color:inherit;font-size:inherit}
        /* SCREENSHOT FRAME — light browser chrome + a soft lifted shadow so product captures pop off the page. */
        .prose figure{margin:40px 0;border-radius:16px;overflow:hidden;border:1px solid rgba(28,22,17,.12);background:#fff;box-shadow:0 34px 80px -34px rgba(28,22,17,.4),0 2px 10px rgba(28,22,17,.06);padding-top:40px;position:relative}
        .prose figure::before{content:'';position:absolute;top:0;left:0;right:0;height:40px;background:#f1ece4;border-bottom:1px solid rgba(28,22,17,.08)}
        .prose figure::after{content:'';position:absolute;top:16px;left:20px;width:10px;height:10px;border-radius:50%;background:#ff5f57;box-shadow:18px 0 0 #febc2e,36px 0 0 #28c840}
        .prose figure img{display:block;width:100%;margin:0;border-radius:0}
        .prose figcaption{font-family:'Newsreader',Georgia,serif;font-style:italic;font-size:15px;color:#8a7f73;text-align:center;padding:13px 18px;background:#fff;margin:0}
        /* inline (non-figure) images stay simple */
        .prose img{max-width:100%;border-radius:12px;margin:10px 0}
        .prose hr{border:none;height:1px;background:linear-gradient(90deg,transparent,rgba(28,22,17,.16),transparent);margin:48px 0}
      `}</style>

      <nav style={{ borderBottom: '1px solid rgba(28,22,17,.08)' }}>
        <div style={{ maxWidth: 1160, margin: '0 auto', padding: '15px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Link href="/">{/* eslint-disable-next-line @next/next/no-img-element */}<img src="/logo.png" alt="Selfmade" style={{ height: 30, filter: 'brightness(0)' }} /></Link>
          <Link href="/signup" style={{ background: LIME, color: BG, padding: '9px 18px', borderRadius: 100, fontSize: 14, fontWeight: 800, textDecoration: 'none' }}>Start for free</Link>
        </div>
      </nav>

      <article style={{ maxWidth: 760, margin: '0 auto', padding: '46px 24px 20px' }}>
        <Link href="/blog" style={{ fontSize: 13.5, fontWeight: 700, color: LIME, textDecoration: 'none' }}>← All posts</Link>
        <div style={{ margin: '18px 0 0' }}><span style={catStyle(post)}>{categoryOf(post)}</span></div>
        <h1 style={{ fontFamily: "'Fraunces',Georgia,serif", fontSize: 'clamp(32px,4.8vw,52px)', fontWeight: 700, letterSpacing: '-.02em', lineHeight: 1.06, margin: '12px 0 16px', color: '#1c1611' }}>{post.title}</h1>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', color: '#8a7f73', fontSize: 14.5 }}>
          <span style={{ fontWeight: 600, color: '#574f47' }}>{post.author || 'Selfmade'}</span><span>·</span><span>{fmt(post.published_at)}</span><span>·</span><span>{mins} min read</span>
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
        <div style={{ background: `linear-gradient(135deg,${LIME},#ff8a4d)`, borderRadius: 22, padding: '34px 30px', textAlign: 'center', boxShadow: '0 24px 60px -28px rgba(239,74,30,.6)' }}>
          <h2 style={{ fontFamily: "'Fraunces',Georgia,serif", fontSize: 'clamp(22px,3.5vw,30px)', fontWeight: 700, letterSpacing: '-.01em', margin: '0 0 8px', color: '#fff' }}>Put this into practice</h2>
          <p style={{ color: 'rgba(255,255,255,.9)', margin: '0 0 18px', fontSize: 16 }}>Find a proven winner in your niche and make it yours — free to start.</p>
          <Link href="/signup" style={{ background: '#1c1611', color: '#fff', padding: '13px 26px', borderRadius: 100, fontSize: 15, fontWeight: 800, textDecoration: 'none' }}>Start for free →</Link>
        </div>
      </section>

      {related.length > 0 && (
        <section style={{ maxWidth: 1160, margin: '0 auto', padding: '10px 24px 80px', borderTop: '1px solid rgba(28,22,17,.08)' }}>
          <div style={{ fontSize: 13, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.08em', color: '#8a7f73', margin: '30px 0 18px' }}>Continue reading</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 24 }}>
            {related.map((p) => (
              <Link key={p.slug} href={`/blog/${p.slug}`} style={{ textDecoration: 'none', color: 'inherit', border: '1px solid rgba(28,22,17,.10)', borderRadius: 16, overflow: 'hidden', background: CARD, boxShadow: '0 1px 2px rgba(28,22,17,.04), 0 12px 30px -22px rgba(28,22,17,.25)' }}>
                <div style={{ position: 'relative', aspectRatio: '16/9', ...coverStyle(p) }}>
                  {!p.cover_image_url && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-end', padding: 16 }}><span style={{ color: '#0a0d0c', fontWeight: 800, fontSize: 19, lineHeight: 1.1 }}>{p.title}</span></div>}
                </div>
                <div style={{ padding: '14px 16px 18px' }}>
                  <span style={catStyle(p)}>{categoryOf(p)}</span>
                  <h3 style={{ fontSize: 17, fontWeight: 800, margin: '8px 0 0', lineHeight: 1.28, color: '#1c1611' }}>{p.title}</h3>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
