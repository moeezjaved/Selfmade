/**
 * Payment-provider icons shared by the bespoke templates (render real card icons in a `.pays` row) and the
 * Page Builder editor (a "Payment Providers" show/hide toggle list, matching PagePilot). Each icon is a small
 * self-contained inline SVG (no external assets) so it renders identically on the canvas and on Shopify.
 * Markup contract: `<span class="payicon" data-pay="<id>">…svg…</span>` inside `<div class="pays">`.
 */
export type PayProvider = { id: string; label: string; svg: string }

const card = (bg: string, inner: string, stroke = '#e6e6ee') =>
  `<svg viewBox="0 0 40 26" width="38" height="25" xmlns="http://www.w3.org/2000/svg"><rect x=".5" y=".5" width="39" height="25" rx="4" fill="${bg}" stroke="${stroke}"/>${inner}</svg>`

export const PAY_PROVIDERS: PayProvider[] = [
  { id: 'visa', label: 'Visa', svg: card('#fff', '<text x="20" y="17.5" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="10.5" font-style="italic" font-weight="700" fill="#1a1f71">VISA</text>') },
  { id: 'mastercard', label: 'Mastercard', svg: card('#fff', '<circle cx="16" cy="13" r="6.4" fill="#eb001b"/><circle cx="24" cy="13" r="6.4" fill="#f79e1b"/><path d="M20 8.2a6.4 6.4 0 0 0 0 9.6 6.4 6.4 0 0 0 0-9.6z" fill="#ff5f00"/>') },
  { id: 'amex', label: 'American Express', svg: card('#1f72cf', '<text x="20" y="16.5" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="8" font-weight="800" fill="#fff">AMEX</text>', '#1f72cf') },
  { id: 'paypal', label: 'PayPal', svg: card('#fff', '<text x="20" y="17" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="8.5" font-style="italic" font-weight="800" fill="#003087">Pay<tspan fill="#009cde">Pal</tspan></text>') },
  { id: 'applepay', label: 'Apple Pay', svg: card('#fff', '<path d="M13.6 9.4c.4-.5.7-1.2.6-1.9-.6 0-1.3.4-1.7.9-.4.4-.7 1.1-.6 1.8.7 0 1.3-.4 1.7-.8z" fill="#000"/><path d="M14.2 10.3c-.9-.1-1.7.5-2.1.5-.4 0-1.1-.5-1.8-.5-.9 0-1.8.5-2.2 1.4-1 1.6-.3 4 .7 5.3.5.6 1 1.3 1.7 1.3.7 0 .9-.4 1.8-.4.8 0 1 .4 1.8.4.7 0 1.2-.6 1.6-1.3.3-.4.5-.9.5-.9-1.3-.5-1.5-2.3-.2-3-.5-.7-1.4-.8-1.6-.8z" fill="#000"/><text x="24" y="16.5" font-family="Arial,Helvetica,sans-serif" font-size="8.5" font-weight="700" fill="#000">Pay</text>') },
  { id: 'googlepay', label: 'Google Pay', svg: card('#fff', '<text x="11" y="16.5" font-family="Arial,Helvetica,sans-serif" font-size="8.5" font-weight="700" fill="#4285f4">G</text><text x="16" y="16.5" font-family="Arial,Helvetica,sans-serif" font-size="8.5" font-weight="600" fill="#5f6368">Pay</text>') },
  { id: 'shop', label: 'Shop Pay', svg: card('#5a31f4', '<text x="20" y="16.5" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="8" font-weight="800" fill="#fff">shop</text>', '#5a31f4') },
  { id: 'klarna', label: 'Klarna', svg: card('#ffb3c7', '<text x="20" y="16.5" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="7.5" font-weight="800" fill="#0a0b09">Klarna.</text>', '#ffb3c7') },
  { id: 'stripe', label: 'Stripe', svg: card('#635bff', '<text x="20" y="16.5" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="7.5" font-weight="800" fill="#fff">stripe</text>', '#635bff') },
  { id: 'amazonpay', label: 'Amazon Pay', svg: card('#fff', '<text x="20" y="15" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="7" font-weight="800" fill="#232f3e">amazon</text><text x="20" y="21.5" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="5.5" font-weight="700" fill="#ff9900">pay</text>') },
]

export const payIcon = (id: string): string => {
  const p = PAY_PROVIDERS.find((x) => x.id === id)
  return p ? `<span class="payicon" data-pay="${id}" title="${p.label}">${p.svg}</span>` : ''
}
/** Default provider set baked into a fresh template's buy-box. */
export const DEFAULT_PAYS = ['visa', 'mastercard', 'amex', 'paypal', 'shop']
export const paysRowInner = (ids: string[] = DEFAULT_PAYS): string => ids.map(payIcon).join('')
