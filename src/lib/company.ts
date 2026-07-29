/**
 * Single source of truth for the legal / business details that payment providers (Stripe,
 * PayPal, local PSPs) and Meta require on public pages: registered entity, address, phone,
 * support email. Used by /contact, /refund, /terms, /privacy so they never drift.
 *
 * ⚠️ FILL THESE with your REAL registered details before going live — a payment provider
 * verifies them against your business registration. Placeholders are marked TODO.
 */
export const COMPANY = {
  // Legal registered entity name
  legalName: 'Virgin Teez',
  // Full registered/business address, one line per line (used with whiteSpace: pre-line)
  address: '', // TODO: add registered address when ready (blocks left off cleanly render nothing)
  // Customer support phone in international format
  phone: '+1 782 822 0679',
  // Support email (live inbox)
  supportEmail: 'moeez@selfmade.ai',
  // Trading/brand name shown to customers
  brand: 'Selfmade',
} as const
