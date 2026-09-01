'use client'
import FeaturePage, { type FeatureConfig } from '../FeaturePage'

const config: FeatureConfig = {
  eyebrow: 'Websites',
  h1: 'A storefront that sells, built by AI.',
  sub: 'Describe your brand or paste your store — Selfmade designs a fast, on-brand, conversion-ready website in minutes.',
  capPlaceholder: 'Describe your brand — or paste your store…',
  chips: ['Homepage', 'Product page', 'Landing page', 'Collection'],
  steps: [
    { n: 1, t: 'Describe your brand or pick a template', d: 'Tell Mello what you sell, or paste your store. It reads your brand and starts from a proven layout.' },
    { n: 2, t: 'Mello designs & writes every page', d: 'On-brand design, copy and imagery — generated, then refined by chatting. Ask for a new section or style.' },
    { n: 3, t: 'Publish — or export to your platform', d: 'Go live in one click, or export clean code to Shopify or your host. Fast and mobile-first by default.' },
  ],
  galleryKicker: 'Start from proven layouts',
  galleryTitle: 'Page templates for every goal',
  cardCta: 'Use template →',
  cards: [
    { t: 'Homepage', d: 'Hero, proof, products, CTA', g: 'linear-gradient(135deg,#ffd9c2,#ff8a5a)' },
    { t: 'Product page', d: 'Gallery, benefits, reviews, buy', g: 'linear-gradient(135deg,#cfe8ff,#7db4f0)' },
    { t: 'Landing page', d: 'One offer, one action, high-convert', g: 'linear-gradient(135deg,#ffe6a3,#ff9f43)' },
    { t: 'Collection', d: 'Browse and filter that sells', g: 'linear-gradient(135deg,#e2d5ff,#a487f0)' },
    { t: 'About', d: 'Story and trust, done right', g: 'linear-gradient(135deg,#c8f0e0,#5bc9a0)' },
    { t: 'Bundle offer', d: 'Upsell and increase order value', g: 'linear-gradient(135deg,#ffd0d8,#f0879a)' },
  ],
  featuresTitle: 'The best features, designed for growth',
  features: [
    { t: 'On-brand automatically', d: 'Your logo, colours, fonts and voice applied to every page.' },
    { t: 'Fast by default', d: 'Lightweight, optimised pages that load in a blink.' },
    { t: 'Mobile-first', d: 'Looks right on every screen without extra work.' },
    { t: 'SEO-ready', d: 'Clean structure, meta and schema baked in from the start.' },
    { t: 'Editable by chat', d: 'Change anything by asking — no page builder to fight.' },
    { t: 'Conversion-tuned', d: 'Layouts shaped by what actually turns visitors into buyers.' },
  ],
  faqTitle: 'Questions, answered',
  faq: [
    { q: 'Do I need design skills?', a: 'No. Describe your brand or pick a template — Selfmade designs and writes every page for you.' },
    { q: 'Can I use my own domain?', a: 'Yes — publish to your domain, or export the code to Shopify or your host.' },
    { q: 'Is it really on-brand?', a: 'Selfmade reads your store for your logo, colours, fonts and tone and applies them everywhere.' },
    { q: 'Can I edit it later?', a: 'Anytime — just tell Mello what to change and it updates the page.' },
  ],
  ctaTitle: 'Ready for a storefront that sells?',
  ctaSub: 'Start free — describe your brand and Selfmade builds your first page in minutes.',
}

export default function WebsitesFeaturePage() { return <FeaturePage config={config} /> }
