/**
 * Ad format → platform vibe. The same brand needs a very different creative on LinkedIn vs WhatsApp,
 * so the chosen format is injected into the generation prompt (angle/direction), not just the size.
 */
export type AdFormat = 'Banner Ad' | 'WhatsApp' | 'Instagram' | 'Facebook' | 'LinkedIn'

export const FORMAT_VIBE: Record<AdFormat, { vibe: string; aspect: string }> = {
  'Banner Ad': { vibe: 'a web display banner — clean, product-forward, a clear headline and a single obvious CTA button; reads instantly at small sizes.', aspect: '16:9' },
  'WhatsApp': { vibe: 'a WhatsApp broadcast promo — bold, direct, urgency and a clear offer/discount, mobile-first, thumb-stopping; feels like a message a shop sends a customer.', aspect: '1:1' },
  'Instagram': { vibe: 'an Instagram feed/story ad — lifestyle, aspirational, beautiful photography-led composition, minimal text, on-trend; scroll-stopping.', aspect: '4:5' },
  'Facebook': { vibe: 'a Facebook feed ad — broad appeal, benefit-led headline, social-proof or offer, friendly and clear.', aspect: '1:1' },
  'LinkedIn': { vibe: 'a LinkedIn ad — professional, B2B/credibility tone, restrained and premium, outcome- and authority-led; NOT flashy or discounty.', aspect: '1:1' },
}

export const FORMATS = Object.keys(FORMAT_VIBE) as AdFormat[]
export const isFormat = (s: any): s is AdFormat => FORMATS.includes(s)
