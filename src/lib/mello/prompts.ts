/**
 * Mello prompt library — static config (no AI, no DB). Rendered as a searchable
 * modal; clicking a prompt populates the chat input. Grouped by the 6 categories
 * from the Raya spec.
 */
export interface PromptItem {
  category: PromptCategory
  title: string
  description: string
  prompt: string
}

export type PromptCategory =
  | 'diagnostics' | 'patterns' | 'audience' | 'competitors' | 'creative' | 'inspiration'

export const PROMPT_CATEGORIES: { key: PromptCategory; label: string; icon: string }[] = [
  { key: 'diagnostics',  label: 'Diagnostics',  icon: '🩺' },
  { key: 'patterns',     label: 'Patterns',     icon: '📊' },
  { key: 'audience',     label: 'Audience',     icon: '👥' },
  { key: 'competitors',  label: 'Competitors',  icon: '⚔️' },
  { key: 'creative',     label: 'Creative',     icon: '🎨' },
  { key: 'inspiration',  label: 'Inspiration',  icon: '✨' },
]

export const PROMPT_LIBRARY: PromptItem[] = [
  // ── DIAGNOSTICS ───────────────────────────────────────────
  { category: 'diagnostics', title: 'Spot key issues', description: 'What is hurting performance right now?', prompt: 'Analyze my ad account and identify the top 3-5 issues that are hurting performance right now. Look at CTR drops, ROAS decline, high CPA, and fatiguing creatives.' },
  { category: 'diagnostics', title: 'Conversion blockers', description: 'What is stopping more conversions?', prompt: 'Identify what is blocking conversions in my campaigns. Analyze the funnel from impression to purchase and find where we are losing people.' },
  { category: 'diagnostics', title: 'Fatigue check', description: 'Are any ads showing clear signs of fatigue?', prompt: 'Check my active ads for creative fatigue signals — declining CTR, rising frequency, or ROAS dropping over consecutive weeks.' },
  { category: 'diagnostics', title: 'Next experiments', description: 'What should I test next?', prompt: 'Based on my current ad performance data, recommend the 3 highest-leverage experiments I should run next.' },
  { category: 'diagnostics', title: 'Analyse this report', description: 'Can you break this report down clearly?', prompt: 'Analyze the attached performance report and break down the key findings, what is working, what is not, and what to do next.' },
  { category: 'diagnostics', title: 'Creative weaknesses', description: 'Why are my weaker creatives underperforming?', prompt: 'Look at my bottom-performing creatives and explain why they are underperforming compared to my top ads. What creative patterns differ?' },
  { category: 'diagnostics', title: 'Kill / scale / hold', description: 'Which ads should I kill, scale, or hold?', prompt: 'Review all my active ads and give me a clear kill / scale / hold decision for each one with the reasoning.' },
  { category: 'diagnostics', title: 'Landing page mismatch', description: 'Where do landing pages let strong ads down?', prompt: 'Identify cases where strong ad click-through rates are not converting — this usually indicates a landing page message mismatch.' },
  { category: 'diagnostics', title: 'Creative diversity audit', description: 'Where are the gaps in my creative mix?', prompt: 'Audit my current creative mix for format diversity (image vs video vs carousel), hook types, and messaging angles. Where are the gaps?' },

  // ── PATTERNS ──────────────────────────────────────────────
  { category: 'patterns', title: 'White space', description: 'What have we not explored enough?', prompt: 'Look at my ad history and tell me what creative angles, formats, or audience segments I have not explored enough.' },
  { category: 'patterns', title: 'Identify trends', description: 'Identify key performance trends over time.', prompt: 'Analyze my performance data over the last 90 days and identify the key trends — what is improving, what is declining, and why.' },
  { category: 'patterns', title: 'Hook analysis', description: 'Which openings work best?', prompt: 'Analyze the first 3 seconds or opening lines of my best and worst performing ads and identify what hook patterns work.' },
  { category: 'patterns', title: 'Visual patterns', description: 'Which visual traits seem to work?', prompt: 'Look at my top performing image and video ads — what visual patterns (colors, people, product shots, UGC vs polished) correlate with higher performance?' },
  { category: 'patterns', title: 'Message patterns', description: 'Which messages resonate most?', prompt: 'Analyze the copy in my top performing ads — what messaging angles, value propositions, and emotional triggers appear most often?' },
  { category: 'patterns', title: 'CTA patterns', description: 'Which calls to action perform best?', prompt: 'Compare the CTAs in my top and bottom performing ads. Which calls to action drive the most conversions?' },
  { category: 'patterns', title: 'Format comparison', description: 'Which ad formats are working best?', prompt: 'Compare performance across image, video, and carousel formats in my account. Which format has the best ROAS, CTR, and CPA?' },
  { category: 'patterns', title: 'Winning patterns', description: "What's working and what am I leaning on too hard?", prompt: 'What are the common traits of my top 20% of ads? And what am I over-indexing on that may be causing me to miss other opportunities?' },
  { category: 'patterns', title: 'Get deeper insights', description: 'What deeper insights should I focus on?', prompt: 'Go beyond surface metrics — what deeper, non-obvious insights about my account performance should I focus on this month?' },

  // ── AUDIENCE ──────────────────────────────────────────────
  { category: 'audience', title: 'Customer sentiment', description: 'What are customers saying about us right now?', prompt: 'Summarize what customers are currently saying about my brand — look at reviews, ad comments, and social mentions.' },
  { category: 'audience', title: 'Voice-of-customer gap', description: 'What customer themes are my ads missing?', prompt: 'Compare what customers say about my product vs what my current ads say. What customer language and themes are my ads not reflecting?' },
  { category: 'audience', title: 'Copy golden nuggets', description: 'Which customer quotes could we lift into ads?', prompt: 'Find the most emotionally resonant and specific customer quotes that could be used directly in ad copy or as testimonials.' },
  { category: 'audience', title: 'White-space themes', description: 'What untapped customer needs should we claim first?', prompt: 'Identify customer needs, pain points, or desires that my current ads are not addressing but competitors are also missing.' },
  { category: 'audience', title: 'Buying triggers', description: 'What pushes customers to start shopping?', prompt: 'Identify the specific events, emotions, or situations that trigger my target customer to start looking for a solution like mine.' },
  { category: 'audience', title: 'Source-specific pull', description: 'What do customers say on Reddit, X, and Trustpilot?', prompt: 'Gather and synthesize what my target audience says about this category on Reddit, Twitter/X, and review platforms.' },

  // ── COMPETITORS ───────────────────────────────────────────
  { category: 'competitors', title: 'Marketing gap analysis', description: 'Where are competitors out-positioning us?', prompt: 'Analyze my top 3-5 competitors and identify where they are out-positioning my brand in their advertising messaging.' },
  { category: 'competitors', title: 'Competitor benchmarks', description: 'How do we compare against competitors?', prompt: 'How does my creative output, ad frequency, and messaging compare to my main competitors? Benchmark me against them.' },
  { category: 'competitors', title: 'Angle white space', description: 'What competitor angles are we missing?', prompt: 'Look at the messaging angles my competitors are running in their ads and tell me which ones I am not testing yet.' },
  { category: 'competitors', title: 'Message differentiation', description: 'How can we sound more distinct?', prompt: 'My category sounds the same. How can my messaging be more distinct from competitors while staying credible?' },
  { category: 'competitors', title: 'Offer comparison', description: 'How does our offer stack up?', prompt: 'Compare my offer (pricing, guarantee, bundle, shipping) against competitors and tell me where I am weaker or stronger.' },
  { category: 'competitors', title: 'Creative intelligence', description: 'What competitor creative patterns stand out?', prompt: 'Analyze competitor creatives in my niche and identify the visual and structural patterns that keep showing up in their long-running ads.' },
  { category: 'competitors', title: 'Competitor sentiment', description: 'What do customers say about competitors?', prompt: 'Summarize what customers say about my main competitors — their complaints and praise — so I can find angles to exploit.' },

  // ── CREATIVE ──────────────────────────────────────────────
  { category: 'creative', title: 'Image spinouts', description: 'Create more versions of top image ads.', prompt: 'Take my top performing image ads and generate several fresh concept variations that keep the winning elements but change the execution.' },
  { category: 'creative', title: 'Script variations', description: 'Generate fresh versions of winning video ads.', prompt: 'Take my best performing video ad and write 3 fresh script variations that keep the core hook and structure but change the angle.' },
  { category: 'creative', title: 'Refresh top copy', description: 'Refresh winning copy while keeping core drivers.', prompt: 'Refresh the copy on my winning ads — keep the proven hooks and value props but rewrite to fight fatigue.' },
  { category: 'creative', title: 'Fix poor ads', description: 'Improve weak ads with stronger alternatives.', prompt: 'Look at my weakest ads and rewrite them with stronger hooks, clearer value, and better CTAs.' },
  { category: 'creative', title: 'Stronger hooks', description: 'Make openings more compelling.', prompt: 'Write 10 stronger opening hooks for my product based on what is working in my top ads and my category.' },
  { category: 'creative', title: 'CTA upgrade', description: 'Strengthen the close and CTA.', prompt: 'Rewrite the closing lines and CTAs of my ads to be more compelling and conversion-focused.' },
  { category: 'creative', title: 'Product scripts', description: 'Draft launch scripts for a new product.', prompt: 'Draft 3 video ad scripts for a new product launch using my best performing structures and my brand voice.' },
  { category: 'creative', title: 'More angles', description: 'What other messaging directions can I test?', prompt: 'Give me 10 distinct messaging angles I can test for my product, each with a one-line rationale.' },
  { category: 'creative', title: 'Angle variations', description: 'Give me more angles.', prompt: 'Take my current best angle and give me 8 variations on it that I can test as separate ads.' },
  { category: 'creative', title: 'Tone shift', description: 'Rewrite top ads in new tones.', prompt: 'Rewrite my top ad in 4 different tones (bold, empathetic, playful, authoritative) so I can test which resonates.' },
  { category: 'creative', title: 'Audience reframe', description: 'Adapt best ads for a new audience segment.', prompt: 'Adapt my best performing ad for a new audience segment, changing the framing and pain points while keeping the structure.' },
  { category: 'creative', title: 'VoC-grounded angles', description: 'Generate angles from real customer language.', prompt: 'Using real customer language and reviews, generate ad angles and hooks that mirror how customers actually describe their problem.' },

  // ── INSPIRATION ───────────────────────────────────────────
  { category: 'inspiration', title: 'Trending in my category', description: "What's trending in my category right now?", prompt: 'Search the ad library for what is trending in my category right now and summarize the patterns I should pay attention to.' },
  { category: 'inspiration', title: 'Long-running references', description: 'Which ads have proved themselves?', prompt: 'Find ads in my niche that have been running for a long time (proven winners) and break down why they work.' },
  { category: 'inspiration', title: 'Winner lookalikes', description: 'Which inspo ads look like my winners?', prompt: 'Find inspiration ads in the library that share the same structure and hooks as my top performing ads.' },
  { category: 'inspiration', title: 'Adjacent-category inspiration', description: 'What can I borrow from adjacent categories?', prompt: 'Show me strong ads from categories adjacent to mine and tell me what tactics I could borrow and adapt.' },
  { category: 'inspiration', title: 'Trending hooks', description: 'Which TikTok hooks are catching on?', prompt: 'What hook styles are catching on right now that I could adapt for my product? Give me examples and how to use them.' },
]
