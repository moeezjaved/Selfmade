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

/** SEO/catalog fixes pushed live to Shopify. */
export function shopifyApplied(n: number): CelebratePayload {
  return {
    emoji: '🍩',
    title: `${n} fixes are live on Shopify!`,
    sub: pick([
      `That's ${n} more products Google can actually read — and ${n} more shoppers who find you before your competitor does. Woo-hoo!`,
      `${n} tiny salespeople just clocked in for the night shift. They don't take breaks and they never ask for a raise.`,
      `Your storefront got ${n} notches more findable. Somewhere out there, a competitor just felt a cold breeze.`,
      `${n} fixes shipped while you sipped your chai. This is what "working smarter" actually looks like.`,
    ]),
  }
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
