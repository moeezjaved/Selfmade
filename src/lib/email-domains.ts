/**
 * Email gate. As of 2026-07-14 the business-email requirement is OFF (REQUIRE_BUSINESS_EMAIL=false):
 * the ICP is solo/small DTC founders who overwhelmingly use Gmail, so blocking personal email turned
 * away the exact user we launch for. We STILL block disposable/throwaway providers (free-tier +
 * welcome-credit abuse protection). Flip REQUIRE_BUSINESS_EMAIL back to true to reinstate the full
 * work-email gate — every enforcement point (signup form, Google callback, middleware) reads it.
 */

// Master switch. false = allow personal email (Gmail etc.), block only disposable. true = business-only.
export const REQUIRE_BUSINESS_EMAIL = false

// Personal/consumer providers — allowed when the gate is off, blocked when it's on.
const PERSONAL_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'yahoo.com.au', 'yahoo.fr', 'yahoo.de', 'yahoo.es', 'yahoo.in', 'ymail.com', 'rocketmail.com',
  'hotmail.com', 'hotmail.co.uk', 'hotmail.fr', 'hotmail.de', 'hotmail.es', 'hotmail.it', 'outlook.com', 'outlook.fr', 'outlook.de', 'outlook.es', 'live.com', 'live.co.uk', 'msn.com',
  'icloud.com', 'me.com', 'mac.com', 'aol.com', 'aim.com',
  'proton.me', 'protonmail.com', 'pm.me', 'tutanota.com', 'tuta.io',
  'gmx.com', 'gmx.net', 'gmx.de', 'mail.com', 'email.com', 'usa.com', 'zoho.com', 'zohomail.com', 'hey.com', 'fastmail.com', 'hushmail.com',
  'yandex.com', 'yandex.ru', 'mail.ru', 'inbox.ru', 'list.ru', 'bk.ru', 'rambler.ru',
  'qq.com', '163.com', '126.com', 'sina.com', 'foxmail.com', 'naver.com', 'daum.net',
  'web.de', 't-online.de', 'freenet.de', 'orange.fr', 'free.fr', 'laposte.net', 'wanadoo.fr', 'libero.it', 'virgilio.it',
  'comcast.net', 'verizon.net', 'sbcglobal.net', 'att.net', 'bellsouth.net', 'cox.net', 'charter.net', 'earthlink.net', 'juno.com',
])

// Disposable / throwaway — ALWAYS blocked (abuse protection), regardless of the master switch.
const DISPOSABLE_EMAIL_DOMAINS = new Set([
  'mailinator.com', '10minutemail.com', 'guerrillamail.com', 'guerrillamail.info', 'trashmail.com', 'yopmail.com', 'temp-mail.org', 'tempmail.com', 'getnada.com', 'sharklasers.com', 'maildrop.cc', 'dispostable.com', 'throwawaymail.com', 'fakeinbox.com', 'mintemail.com', 'spam4.me',
])

/** Extract the lowercased domain from an email, or null if it doesn't look like an email. */
export function emailDomain(email: string): string | null {
  const m = /^[^\s@]+@([^\s@]+\.[^\s@]+)$/.exec((email || '').trim().toLowerCase())
  return m ? m[1] : null
}

/** True if the email is disposable/throwaway (always rejected). */
export function isDisposableEmail(email: string): boolean {
  const d = emailDomain(email)
  return !!d && DISPOSABLE_EMAIL_DOMAINS.has(d)
}

/**
 * True if this email should be BLOCKED at signup. Always blocks disposable addresses; additionally
 * blocks personal/free providers only when REQUIRE_BUSINESS_EMAIL is on. This is the single predicate
 * every gate calls — keep the name for back-compat with existing call sites.
 */
export function isFreeEmail(email: string): boolean {
  if (isDisposableEmail(email)) return true
  if (!REQUIRE_BUSINESS_EMAIL) return false
  const d = emailDomain(email)
  return !!d && PERSONAL_EMAIL_DOMAINS.has(d)
}

/** True if the email is a valid, non-blocked email. */
export function isBusinessEmail(email: string): boolean {
  return !!emailDomain(email) && !isFreeEmail(email)
}
