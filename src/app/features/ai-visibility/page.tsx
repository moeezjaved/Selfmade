'use client'
import FeaturePage, { type FeatureConfig } from '../FeaturePage'

const config: FeatureConfig = {
  eyebrow: 'AI Visibility',
  h1: 'Get recommended by ChatGPT & Gemini.',
  sub: 'When shoppers ask AI what to buy, Selfmade makes sure your store is the answer — cited, recommended, and linked.',
  capPlaceholder: 'Paste your store — see if AI recommends you…',
  chips: ['ChatGPT', 'Gemini', 'Perplexity', 'Citations'],
  steps: [
    { n: 1, t: 'See if AI mentions you today', d: 'Selfmade asks the questions your buyers ask ChatGPT and Gemini — and shows whether you show up.' },
    { n: 2, t: 'Fix the content AI reads', d: 'It rewrites and structures your pages the way language models parse — answers, comparisons, entities.' },
    { n: 3, t: 'Get cited across the AI web', d: 'Land in the recommendations on ChatGPT, Gemini and Perplexity — with your store linked.' },
  ],
  galleryKicker: 'How Selfmade wins AI',
  galleryTitle: 'Everything that gets you cited',
  cardCta: 'See how →',
  cards: [
    { t: 'Answer-ready content', d: 'Pages written for AI to quote', g: 'linear-gradient(135deg,#cfe8ff,#7db4f0)' },
    { t: 'Comparison pages', d: '“Best X for Y” that AI loves', g: 'linear-gradient(135deg,#ffd9c2,#ff8a5a)' },
    { t: 'FAQ schema', d: 'Structured Q&A models trust', g: 'linear-gradient(135deg,#ffe6a3,#ff9f43)' },
    { t: 'Brand entity', d: 'Be recognised as a real brand', g: 'linear-gradient(135deg,#e2d5ff,#a487f0)' },
    { t: 'Citations', d: 'Earn links from sources AI reads', g: 'linear-gradient(135deg,#c8f0e0,#5bc9a0)' },
    { t: 'Prompt coverage', d: 'Own the questions buyers ask', g: 'linear-gradient(135deg,#ffd0d8,#f0879a)' },
  ],
  featuresTitle: 'The best features, designed for growth',
  features: [
    { t: 'Visibility scan', d: 'See exactly which AI prompts surface you — and which surface rivals.' },
    { t: 'Answer engineering', d: 'Rewrites pages into the format language models cite.' },
    { t: 'Entity building', d: 'Establishes your brand as a real, trusted entity across the web.' },
    { t: 'Comparison content', d: 'Publishes the “best of” pages AI reaches for first.' },
    { t: 'Citation building', d: 'Earns mentions on the sources models actually read.' },
    { t: 'Tracked over time', d: 'Watch your AI share-of-voice grow prompt by prompt.' },
  ],
  faqTitle: 'Questions, answered',
  faq: [
    { q: 'What is AI visibility?', a: 'Whether ChatGPT, Gemini and Perplexity recommend your store when shoppers ask them what to buy.' },
    { q: 'Can you really influence it?', a: 'Yes — by structuring your content and entity the way models parse and cite, you become the answer.' },
    { q: 'Which AIs do you cover?', a: 'ChatGPT, Gemini and Perplexity today, with more added as buyers adopt them.' },
    { q: 'How do I know it’s working?', a: 'Selfmade tracks your share of voice across real buyer prompts over time.' },
  ],
  ctaTitle: 'Ready to be the answer?',
  ctaSub: 'Start free — Selfmade checks whether AI recommends you today, and shows you how to win.',
}

export default function AiVisibilityFeaturePage() { return <FeaturePage config={config} /> }
