/**
 * Shared blog visual helpers (server-safe, no imports). Vox-style vibrant gradient thumbnails +
 * category tags, keyed by slug so each post gets a stable, distinct color. Used by /blog and
 * /blog/[slug]. `_`-prefixed folder → never routed.
 */
import type { CSSProperties } from 'react'

// Bold, editorial gradient pairs (Vox palette). [accent(light), deep].
const GRADS: [string, string][] = [
  ['#ff9ec4', '#a855f7'], // pink → purple
  ['#6ee7d7', '#0ea5e9'], // teal → blue
  ['#fca5a5', '#f97316'], // coral → orange
  ['#c4b5fd', '#6366f1'], // lavender → indigo
  ['#ff5a2c', '#22c55e'], // lime → green
  ['#fde68a', '#f59e0b'], // yellow → amber
  ['#f9a8d4', '#db2777'], // pink → magenta
  ['#93c5fd', '#3b82f6'], // sky → blue
]

function hash(s: string): number { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h) }
function grad(post: any): [string, string] { return GRADS[hash(post?.slug || post?.title || '') % GRADS.length] }

function img(url: string, w = 900) {
  if (!url) return ''
  // Pass through same-origin paths, SVGs, and R2/CDN URLs unchanged; only proxy remote rasters.
  if (url.startsWith('/') || /\.svg($|\?)/i.test(url) || /r2\.dev|r2\.cloudflarestorage|\/\/pub-|\/\/cdn\./.test(url)) return url
  return `https://images.weserv.nl/?url=${encodeURIComponent(url)}&w=${w}&q=75&output=webp`
}

export function coverStyle(post: any): CSSProperties {
  if (post?.cover_image_url) return { backgroundImage: `url(${img(post.cover_image_url, 1000)})`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundColor: '#0d120e' }
  const [a, b] = grad(post)
  return { background: `linear-gradient(135deg, ${a}, ${b})` }
}

export function categoryOf(post: any): string {
  const t = Array.isArray(post?.tags) && post.tags[0] ? String(post.tags[0]) : 'Playbook'
  return t.toUpperCase()
}

export function catStyle(post: any): CSSProperties {
  const [a] = grad(post)
  return { display: 'inline-block', fontSize: 11.5, fontWeight: 800, letterSpacing: '.08em', color: a, textTransform: 'uppercase' }
}
