'use client'
import FeaturePage, { type FeatureConfig } from '../FeaturePage'

const config: FeatureConfig = {
  eyebrow: 'Shopify Autopilot',
  h1: 'Your Shopify store, run on autopilot.',
  sub: 'Connect Shopify and Selfmade runs the whole growth engine — ads, SEO, content and conversion — from your real store data.',
  capPlaceholder: 'Paste your Shopify store to connect…',
  chips: ['Ads', 'SEO', 'Content', 'CRO'],
  steps: [
    { n: 1, t: 'Connect your Shopify store', d: 'One secure connection. Selfmade reads your products, orders and traffic — nothing changes without your yes.' },
    { n: 2, t: 'It learns what actually sells', d: 'Real revenue, best-sellers and buyer behaviour become the brain behind every decision.' },
    { n: 3, t: 'It runs growth — you approve', d: 'Ads, SEO fixes, content and conversion tweaks, proposed and shipped on autopilot with your sign-off.' },
  ],
  galleryKicker: 'What it runs for you',
  galleryTitle: 'A full growth team on autopilot',
  cardCta: 'See how →',
  cards: [
    { t: 'Catalog SEO', d: 'Every product page, optimised', g: 'linear-gradient(135deg,#c8f0e0,#5bc9a0)' },
    { t: 'Ad campaigns', d: 'Built from your best-sellers', g: 'linear-gradient(135deg,#ffd9c2,#ff8a5a)' },
    { t: 'Blog engine', d: 'Buyer-intent content, published', g: 'linear-gradient(135deg,#cfe8ff,#7db4f0)' },
    { t: 'CRO fixes', d: 'Storefront tweaks that convert', g: 'linear-gradient(135deg,#ffe6a3,#ff9f43)' },
    { t: 'Email flows', d: 'Win-backs and nurtures, automated', g: 'linear-gradient(135deg,#e2d5ff,#a487f0)' },
    { t: 'Competitor intel', d: 'Track and out-run your rivals', g: 'linear-gradient(135deg,#ffd0d8,#f0879a)' },
  ],
  featuresTitle: 'The best features, designed for growth',
  features: [
    { t: 'Real revenue data', d: 'Decisions grounded in what actually sells, not guesses.' },
    { t: 'One-click connect', d: 'A secure Shopify connection — set up in under a minute.' },
    { t: 'Always optimising', d: 'Runs ads, SEO and CRO continuously, not once and forgotten.' },
    { t: 'Approval-gated', d: 'Nothing goes live without your yes. You stay in control.' },
    { t: 'Multi-channel', d: 'Meta, Google, TikTok, search and AI — from one place.' },
    { t: 'Daily briefs', d: 'A morning report of what shipped, what won, and what’s next.' },
  ],
  faqTitle: 'Questions, answered',
  faq: [
    { q: 'Is connecting Shopify safe?', a: 'Yes — a standard, read-first connection. Selfmade never changes anything without your approval.' },
    { q: 'What does it actually do?', a: 'Runs ads, SEO, content and conversion work from your real store data, proposing every action for your sign-off.' },
    { q: 'Do I lose control?', a: 'No. Everything is approval-gated — Selfmade drafts and stages, you decide what ships.' },
    { q: 'What if I’m not on Shopify?', a: 'Most features work on any live site; Shopify unlocks the deepest automation and real-revenue data.' },
  ],
  ctaTitle: 'Ready to put growth on autopilot?',
  ctaSub: 'Start free — connect your store and Selfmade shows you the first wins it would ship.',
}

export default function ShopifyFeaturePage() { return <FeaturePage config={config} /> }
