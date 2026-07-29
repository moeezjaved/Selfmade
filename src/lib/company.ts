/**
 * Single source of truth for the legal / business details that payment providers (Stripe,
 * PayPal, local PSPs) and Meta require on public pages: registered entity, address, phone,
 * support email. Used by /contact, /refund, /terms, /privacy so they never drift.
 *
 * ⚠️ FILL THESE with your REAL registered details before going live — a payment provider
 * verifies them against your business registration. Placeholders are marked TODO.
 */
export const COMPANY = {
  // Legal registered entity name (e.g. "Selfmade Technologies Ltd" or your sole-proprietor name)
  legalName: 'Selfmade Technologies', // TODO: exact registered legal name
  // Full registered/business address, one line per line (used with whiteSpace: pre-line)
  address: '123 Example Street\nCity, State/Region, Postal Code\nCountry', // TODO: real registered address
  // Customer support phone in international format
  phone: '+1 (000) 000-0000', // TODO: real support phone
  // Support email (already a live inbox)
  supportEmail: 'support@tryselfmade.ai',
  // Trading/brand name shown to customers
  brand: 'Selfmade',
} as const
