/**
 * KNOWLEDGE · shared creative-DNA taxonomy — the vocabulary of the graph.
 * Mirrors the filter options in DiscoveryClient (source of truth for values stored
 * on discovery_ads_index by the E-classify pipeline). Used by universal Search and
 * the Edition to turn concept names into deep-links.
 */

export const HOOKS = ['Pain Point', 'Testimonial', 'Social Proof', 'Before & After', 'Question', 'Story', 'Announcement', 'Educational', 'Urgency', 'Discount', 'Unboxing', 'Us vs Them']
export const FORMAT_STYLES = ['UGC', 'Studio / Produced', 'Graphic / Text', 'Mixed']
export const VISUAL_STYLES = ['Selfie / Handheld', 'Bathroom / Mirror', 'Kitchen / Home', 'Outdoor / Lifestyle', 'Studio Product Shot', 'Before & After', 'Text Overlay Graphic', 'Unboxing', 'Talking Head', 'Demo / How-to', 'Flat Lay', 'Lifestyle Person', 'Other']
export const EMOTIONS = ['fear', 'curiosity', 'desire', 'trust', 'urgency', 'hope', 'excitement', 'relatability', 'aspiration', 'guilt', 'pride']
export const ANGLES = ['Pain Point', 'Aspiration', 'Social Proof', 'Authority', 'Scarcity', 'Curiosity', 'Value', 'Story', 'Comparison']

/** Code-defined auto-collections — saved queries the Edition and Search both surface.
 *  Each is a live query over discovery_ads_index; `href` opens the existing /discovery
 *  grid pre-filtered (the grid is the graph's raw library). */
export const COLLECTIONS = [
  { slug: 'survivors-60', name: 'Hooks that survived 60 days', sub: 'ads still running after two months — the market voted', href: '/discovery?run_time=60&sort=recommended' },
  { slug: 'best-ugc', name: 'The best UGC right now', sub: 'top-performing UGC creative, last 30 days', href: '/discovery?format_style=UGC&days=30&sort=recommended' },
  { slug: 'proof-that-sells', name: 'Proof that sells', sub: 'testimonial + social-proof hooks, ranked', href: `/discovery?hook=${encodeURIComponent('Testimonial')},${encodeURIComponent('Social Proof')}&sort=recommended` },
] as const

export const hookHref = (h: string) => `/discovery?hook=${encodeURIComponent(h)}&sort=recommended`
export const formatHref = (f: string) => `/discovery?format_style=${encodeURIComponent(f)}&sort=recommended`
