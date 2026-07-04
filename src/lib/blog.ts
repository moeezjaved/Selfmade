/**
 * Blog data layer + a dependency-free, XSS-safe Markdown→HTML renderer.
 *
 * Posts are authored in /admin/blog (stored in blog_posts) and served at /blog + /blog/[slug].
 * We render Markdown server-side into sanitized HTML (escape first, then apply a small, well-scoped
 * set of block/inline rules) — no client markdown lib, no runtime cost, and no injection surface even
 * though authors are admins.
 */
import { unstable_cache } from 'next/cache'
import { createReadClient } from '@/lib/supabase/server'
export { slugify, readingTimeMin, renderMarkdown } from '@/lib/blog-markdown'

export const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://tryselfmade.ai').replace(/\/$/, '')

export type BlogPost = {
  id: string; slug: string; title: string; excerpt: string | null; cover_image_url: string | null
  body_md: string; author: string | null; tags: string[] | null; meta_description: string | null
  status: string; published_at: string | null; created_at: string; updated_at: string
}
export type BlogCard = Pick<BlogPost, 'slug' | 'title' | 'excerpt' | 'cover_image_url' | 'author' | 'published_at' | 'tags'>

function readClientSafe(): ReturnType<typeof createReadClient> | null {
  if (!(process.env.SUPABASE_READ_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null
  try { return createReadClient() } catch { return null }
}

// ── Public reads (cached; blog_posts table absent → empty, so the build never fails) ──
export const getPublishedPosts = unstable_cache(
  async (): Promise<BlogCard[]> => {
    const db = readClientSafe(); if (!db) return []
    try {
      const { data, error } = await db.from('blog_posts')
        .select('slug, title, excerpt, cover_image_url, author, published_at, tags')
        .eq('status', 'published').order('published_at', { ascending: false }).limit(500)
      if (error) return []
      return (data || []) as BlogCard[]
    } catch { return [] }
  },
  ['blog-published-v1'], { revalidate: 300, tags: ['blog'] },
)

export async function getPostBySlug(slug: string): Promise<BlogPost | null> {
  const db = readClientSafe(); if (!db) return null
  try {
    const { data, error } = await db.from('blog_posts').select('*').eq('slug', slug).eq('status', 'published').maybeSingle()
    if (error || !data) return null
    return data as BlogPost
  } catch { return null }
}

