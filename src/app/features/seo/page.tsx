'use client'
import FeaturePage, { type FeatureConfig } from '../FeaturePage'

const config: FeatureConfig = {
  eyebrow: 'SEO',
  h1: 'Rank on Google. Automatically.',
  sub: 'Selfmade crawls every page, fixes what’s broken, and writes buyer-intent content — so your store climbs the rankings while you sleep.',
  capPlaceholder: 'Paste your store — Selfmade will audit its SEO…',
  chips: ['Technical audit', 'Content', 'Rankings', 'Competitor gaps'],
  steps: [
    { n: 1, t: 'Crawl & audit every page', d: 'Selfmade reads your whole store and finds what’s holding it back — titles, speed, structure, thin content.' },
    { n: 2, t: 'Fix titles, meta, structure & speed', d: 'Approve the fixes and they’re applied automatically, page by page. No developer, no plugins to wrangle.' },
    { n: 3, t: 'Publish buyer-intent content', d: 'It writes and publishes the blogs and pages your buyers actually search for — targeted to real keywords.' },
  ],
  galleryKicker: 'What Selfmade fixes',
  galleryTitle: 'Everything that moves rankings',
  cardCta: 'See how →',
  cards: [
    { t: 'Technical audit', d: 'Crawl, index & Core Web Vitals', g: 'linear-gradient(135deg,#ffd9c2,#ff8a5a)' , ic: 'search' },
    { t: 'Title & meta rewrites', d: 'Every page, keyword-optimised', g: 'linear-gradient(135deg,#cfe8ff,#7db4f0)' , ic: 'tag' },
    { t: 'Internal links', d: 'Link equity where it counts', g: 'linear-gradient(135deg,#ffe6a3,#ff9f43)' , ic: 'link' },
    { t: 'Buyer-intent blogs', d: 'Content that ranks and converts', g: 'linear-gradient(135deg,#e2d5ff,#a487f0)' , ic: 'doc' },
    { t: 'Product SEO', d: 'Descriptions & schema that win', g: 'linear-gradient(135deg,#c8f0e0,#5bc9a0)' , ic: 'cart' },
    { t: 'Schema markup', d: 'Rich results, more clicks', g: 'linear-gradient(135deg,#ffd0d8,#f0879a)' , ic: 'code' },
  ],
  featuresTitle: 'The best features, designed for growth',
  features: [
    { t: 'Full-site crawl', d: 'Reads every page and surfaces exactly what to fix, ranked by impact.' },
    { t: 'One-click fixes', d: 'Approve and Selfmade applies the change — no code, no plugins.' },
    { t: 'Content engine', d: 'Auto-writes and publishes buyer-intent blogs and pages on a schedule.' },
    { t: 'Keyword targeting', d: 'Every fix and article is aimed at terms your buyers actually search.' },
    { t: 'Competitor gaps', d: 'See the keywords rivals rank for that you don’t — then take them.' },
    { t: 'Rank tracking', d: 'Watch positions climb and prove the work paid off.' },
  ],
  faqTitle: 'Questions, answered',
  faq: [
    { q: 'Do I need to touch code?', a: 'No. Selfmade finds the issues and applies the fixes for you — you just approve.' },
    { q: 'Will it write the content too?', a: 'Yes — buyer-intent blogs and pages, on brand, published on a schedule you control.' },
    { q: 'How fast will I see results?', a: 'Technical fixes land immediately; content and rankings compound over the following weeks.' },
    { q: 'Does it work with my platform?', a: 'Yes — it reads any live site, and connects directly to Shopify for deeper fixes.' },
  ],
  ctaTitle: 'Ready to climb the rankings?',
  ctaSub: 'Start free — Selfmade audits your store’s SEO and shows you exactly what to fix first.',
}

export default function SeoFeaturePage() { return <FeaturePage config={config} /> }
