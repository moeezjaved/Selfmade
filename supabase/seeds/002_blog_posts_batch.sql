-- Blog posts batch 2 — run in the Supabase SQL Editor after migration 078. Idempotent (upsert by slug).

-- ── Post: Meta ad hooks ──────────────────────────────────────────────────────
insert into blog_posts (slug, title, excerpt, cover_image_url, body_md, author, tags, meta_description, status, published_at)
values (
  '7-meta-ad-hooks-that-stop-the-scroll',
  '7 Meta Ad Hooks That Stop the Scroll (With Examples)',
  'The first three seconds decide everything. Here are seven hook patterns that consistently stop the scroll on Meta — and how to write your own version of each.',
  '/blog/meta-ad-hooks.svg',
  $body$On Meta, you don't lose people at the offer. You lose them in the first three seconds. If the hook doesn't stop the scroll, nothing else in the ad ever gets seen — the budget, the beautiful creative, the airtight offer, all wasted.

The good news: scroll-stopping hooks aren't magic. A handful of patterns show up again and again across winning ads in every niche. Here are seven that work, with how to write your own version of each.

## 1. The callout

Name the exact person you're for. "Founders over 30 who are tired of…", "If you run Facebook ads for ecommerce…". A specific callout feels like the ad is talking directly to *you*, and the brain can't ignore its own description.

## 2. The bold claim

Say something the reader almost doesn't believe. "This 15-second routine replaced my $200 serum." The tension between "that can't be true" and "…but what if it is?" buys you the next three seconds.

## 3. The question

Ask the exact question already in the reader's head. "Why does your skin look worse after moisturizing?" A good question is impossible to un-see — the mind reaches for the answer automatically.

## 4. Before & after

Show the gap between the problem and the outcome in the first frame. Split-screen, day 1 vs day 30, messy vs clean. It compresses the entire promise of the product into one glance.

## 5. The pattern interrupt

Open with something that doesn't belong in an ad — a weird visual, a blunt confession, "I wasn't going to post this." It breaks the "this is an ad, keep scrolling" reflex.

## 6. Social proof up front

Lead with the crowd. "37,000 people switched to this last month." We're wired to follow other people, so proof in the hook lowers skepticism before the pitch even starts.

## 7. The us-vs-them

Position against the obvious alternative. "Stop paying $90 for what costs $12 to make." A clear villain makes your product the hero, instantly.

## How to actually use these

Don't guess which hook fits your product — **look at what's already winning in your niche**. Pull the longest-running ads in your category, label each one's hook against this list, and you'll see which patterns your market responds to. Then write three or four of your own hooks per pattern and let them compete.

The hook is 80% of the ad's job. Spend 80% of your creative energy there.

That's exactly what [Selfmade](/home) is built for — search 3M+ live Meta ads, sort by what's actually working, and see the hooks winning in your niche right now. [Start free](/signup).
$body$,
  'Selfmade', ARRAY['Playbook'],
  'Seven Meta ad hook patterns that consistently stop the scroll — the callout, bold claim, question, before & after, pattern interrupt, social proof, and us-vs-them — with how to write your own.',
  'published', now()
) on conflict (slug) do update set title=excluded.title, excerpt=excluded.excerpt, cover_image_url=excluded.cover_image_url, body_md=excluded.body_md, tags=excluded.tags, meta_description=excluded.meta_description, status=excluded.status, updated_at=now();

-- ── Post: Facebook ad copy ───────────────────────────────────────────────────
insert into blog_posts (slug, title, excerpt, cover_image_url, body_md, author, tags, meta_description, status, published_at)
values (
  'how-to-write-facebook-ad-copy-that-converts',
  'How to Write Facebook Ad Copy That Converts in 2026',
  'Great ad copy isn''t clever — it''s clear, specific, and built on one idea. Here''s the simple structure winning Meta ads use, step by step.',
  '/blog/facebook-ad-copy.svg',
  $body$Most Facebook ad copy fails for the same reason: it tries to say everything, so it says nothing. Winning copy does the opposite — one idea, said clearly, aimed at one person. Here's the structure that works.

## Start with one big idea

Before you write a word, finish this sentence: "This ad is about ___." One thing. Not the product's five features — the single most compelling reason this specific person should care. Every line after that serves the one idea.

If you can't name it in a sentence, the reader won't find it in a paragraph.

## Lead with the hook, not the brand

Nobody scrolls Meta hoping to meet your brand. Open with *them* — their problem, their desire, their doubt. The brand shows up after you've earned the attention, never before.

## Be specific — specificity is credibility

"Save time" is invisible. "Cut your reporting from three hours to twenty minutes" is believable. Real numbers, real timeframes, real details signal that you actually know the problem — vague benefits signal that you're guessing.

## Handle the one big objection

Every prospect has a single loudest reason not to buy: too expensive, won't work for me, too good to be true, no time. Name it and answer it inside the ad. Unspoken objections don't disappear — they just win.

## One clear call to action

End with exactly one action, phrased as a next step, not a demand. "See how it works" beats "Buy now" when the reader is still cold. Give them the smallest believable yes.

## The structure, in order

1. **Hook** — the problem/desire in the reader's own words.
2. **Turn** — "here's what most people get wrong / here's what changed."
3. **Payoff** — the one idea, with specific proof.
4. **Objection** — name the loudest doubt, dissolve it.
5. **CTA** — one clear next step.

## Then stop writing and start borrowing

You don't have to invent this from scratch. The fastest way to write converting copy is to study the copy already converting in your niche — the ads that have run for months — and rebuild their structure with your product and your proof. Keep the skeleton, change the body.

[Selfmade](/home) lets you pull the winning copy in your category from 3M+ live ads, so you're adapting proven structure instead of staring at a blank page. [Start free](/signup).
$body$,
  'Selfmade', ARRAY['Copywriting'],
  'A simple, proven structure for Facebook ad copy that converts: one big idea, a hook that leads with the reader, specific proof, one objection handled, and a single clear CTA.',
  'published', now()
) on conflict (slug) do update set title=excluded.title, excerpt=excluded.excerpt, cover_image_url=excluded.cover_image_url, body_md=excluded.body_md, tags=excluded.tags, meta_description=excluded.meta_description, status=excluded.status, updated_at=now();

-- ── Post: UGC vs studio ──────────────────────────────────────────────────────
insert into blog_posts (slug, title, excerpt, cover_image_url, body_md, author, tags, meta_description, status, published_at)
values (
  'ugc-vs-studio-ads-whats-winning-on-meta-2026',
  'UGC vs Studio Ads: What''s Winning on Meta in 2026',
  'Polished studio ads used to win. Now raw, creator-style UGC often outperforms them. Here''s when each format wins — and how to tell which your niche prefers.',
  '/blog/ugc-vs-studio-ads.svg',
  $body$For years the assumption was simple: better production = better ads. In 2026 that's no longer true. Raw, creator-style **UGC** (user-generated content) now routinely beats glossy studio spots — but not always, and not in every niche. Here's how to think about it.

## Why UGC took over

UGC wins because it doesn't *look* like an ad. On a feed full of friends and creators, a polished studio spot announces "I'm here to sell you something" — and the scroll reflex kicks in. A person talking to their phone camera blends in, feels honest, and gets watched.

It's also cheaper and faster to produce, which means you can test far more angles for the same budget — and volume of testing is what actually finds winners.

## When studio still wins

Studio isn't dead. Polished, designed creative still outperforms for:

- **Premium and luxury brands**, where the production *is* the promise.
- **Bold graphic hooks** — big text, before/after, comparison charts that need to be crisp.
- **Complex products** that need a clean explainer more than a testimonial.

The mistake is treating it as a rule. It's a test.

## The real answer: let the data decide

Don't pick a side based on a trend article — pick based on **what's already winning in your niche.** Pull the longest-running ads in your category and look at the format mix. If the survivors are 80% UGC, that's your market telling you what it responds to. If a category is still dominated by clean studio creative, respect that.

Formats also shift by stage: UGC often wins at the top of the funnel (cold, scroll-stopping), while cleaner, benefit-driven creative can win on retargeting.

## What to actually do

1. Find the top long-running ads in your niche.
2. Tag each as UGC, studio, or hybrid.
3. Match the dominant format — then out-execute it.
4. Keep testing the other format at 20% of budget; markets move.

The brands that win aren't loyal to a format. They're loyal to whatever the data says works this quarter — and they check often.

[Selfmade](/home) makes that check instant: see the format mix winning in your niche across 3M+ live Meta ads, then clone or generate your own in the format your market prefers. [Start free](/signup).
$body$,
  'Selfmade', ARRAY['Trends'],
  'UGC vs studio ads on Meta in 2026: why creator-style UGC often outperforms polished studio spots, when studio still wins, and how to let your niche''s winning ads decide.',
  'published', now()
) on conflict (slug) do update set title=excluded.title, excerpt=excluded.excerpt, cover_image_url=excluded.cover_image_url, body_md=excluded.body_md, tags=excluded.tags, meta_description=excluded.meta_description, status=excluded.status, updated_at=now();
