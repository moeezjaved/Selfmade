/**
 * celebrate() — fire a big-win moment from anywhere (client). One line at a task's success:
 *   celebrate(shopifyApplied(14))
 * A <Celebration/> host (mounted in the shell) plays the confetti + message. The copy library below gives
 * each big task a line with PERSONALITY + a revenue/impact angle + a little humour — never a dry "done".
 * Keep it to genuinely meaningful wins (things that move sales/SEO), not every tiny click.
 */
export type CelebratePayload = { title: string; sub?: string; emoji?: string }

export function celebrate(p: CelebratePayload) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('sf-celebrate', { detail: p }))
}

const pick = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)]

/** SEO/catalog fixes pushed live to Shopify (aggregate apply). */
export function shopifyApplied(n: number): CelebratePayload {
  return {
    emoji: '🍩',
    title: `${n} fixes are live on Shopify!`,
    sub: pick([
      `Your storefront got ${n} notches more findable. Somewhere out there, a competitor just felt a cold breeze.`,
      `That's ${n} more products Google can actually read — and ${n} more shoppers who find you before your competitor does. Woo-hoo!`,
      `${n} tiny salespeople just clocked in for the night shift. They don't take breaks and they never ask for a raise.`,
      `${n} fixes shipped while you sipped your chai. This is what "working smarter" actually looks like.`,
    ]),
  }
}

/** Product titles rewritten. */
export function productTitles(n: number): CelebratePayload {
  return { emoji: '🏷️', title: `${n} sharper product titles shipped`, sub: `Shoppers judge a title in about 0.4 seconds. Yours just got ${n}× harder to scroll past.` }
}

/** Image alt text added. */
export function altText(n: number): CelebratePayload {
  return { emoji: '👁️', title: `${n} images can finally be “seen”`, sub: `${n} photos went from invisible to searchable on Google Images. Free traffic doesn't get easier than this.` }
}

/** SEO title & meta description copy written. */
export function seoCopy(): CelebratePayload {
  return { emoji: '📝', title: 'Your search snippets got an upgrade', sub: 'This is the copy Google shows before anyone clicks. You just wrote a much better first impression.' }
}

/** Keywords discovered. */
export function keywordsFound(n: number): CelebratePayload {
  return { emoji: '🔑', title: `${n} keywords worth winning`, sub: `The exact searches your buyers type — now you know precisely where to show up.` }
}

/** Best-fit celebration for a batch of catalog fixes, chosen by the dominant fix type. */
export function catalogApplied(n: number, kind?: string): CelebratePayload {
  const k = (kind || '').toLowerCase()
  if (k.includes('alt')) return altText(n)
  if (k.includes('title') && !k.includes('seo')) return productTitles(n)
  if (k.includes('seo') || k.includes('desc') || k.includes('meta')) return seoCopy()
  if (k.includes('keyword') || k.includes('tag')) return keywordsFound(n)
  return shopifyApplied(n)
}

/** A blog / content piece published. */
export function blogPublished(title?: string): CelebratePayload {
  return {
    emoji: '✍️',
    title: 'Your new article is live!',
    sub: pick([
      `${title ? `"${title}"` : 'It'} is now out there quietly pulling in Google traffic 24/7 — no ad spend required.`,
      'One more page working the search results while you sleep. Compounding, baby.',
    ]),
  }
}

/** Competitors discovered. */
export function competitorsFound(n: number): CelebratePayload {
  return {
    emoji: '🕵️',
    title: `Found ${n} real rivals`,
    sub: `We pulled ${n} competitors and their live ads. Now you can borrow what's working — and skip what isn't.`,
  }
}

/** An ad / creative generated. */
export function adReady(): CelebratePayload {
  return {
    emoji: '🎨',
    title: 'Your ad is ready!',
    sub: pick([
      'Fresh, on-brand, and built to stop the scroll. Ship it and let it earn its keep.',
      'That would’ve been a $300 agency invoice and a 3-day wait. You got it in a minute.',
    ]),
  }
}

/** Generic revenue-flavored win when nothing more specific fits. */
export function bigWin(title: string, sub?: string): CelebratePayload {
  return { emoji: '🎉', title, sub }
}
