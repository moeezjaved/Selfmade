/**
 * Business-email gate — reject free/personal + disposable email providers so signups are work emails.
 * Used on the signup form (and reusable on the Google callback).
 */
const FREE_EMAIL_DOMAINS = new Set([
  // major consumer providers
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'yahoo.com.au', 'yahoo.fr', 'yahoo.de', 'yahoo.es', 'yahoo.in', 'ymail.com', 'rocketmail.com',
  'hotmail.com', 'hotmail.co.uk', 'hotmail.fr', 'hotmail.de', 'hotmail.es', 'hotmail.it', 'outlook.com', 'outlook.fr', 'outlook.de', 'outlook.es', 'live.com', 'live.co.uk', 'msn.com',
  'icloud.com', 'me.com', 'mac.com', 'aol.com', 'aim.com',
  'proton.me', 'protonmail.com', 'pm.me', 'tutanota.com', 'tuta.io',
  'gmx.com', 'gmx.net', 'gmx.de', 'mail.com', 'email.com', 'usa.com', 'zoho.com', 'zohomail.com', 'hey.com', 'fastmail.com', 'hushmail.com',
  'yandex.com', 'yandex.ru', 'mail.ru', 'inbox.ru', 'list.ru', 'bk.ru', 'rambler.ru',
  'qq.com', '163.com', '126.com', 'sina.com', 'foxmail.com', 'naver.com', 'daum.net',
  'web.de', 't-online.de', 'freenet.de', 'orange.fr', 'free.fr', 'laposte.net', 'wanadoo.fr', 'libero.it', 'virgilio.it',
  'comcast.net', 'verizon.net', 'sbcglobal.net', 'att.net', 'bellsouth.net', 'cox.net', 'charter.net', 'earthlink.net', 'juno.com',
  // common disposable / throwaway
  'mailinator.com', '10minutemail.com', 'guerrillamail.com', 'guerrillamail.info', 'trashmail.com', 'yopmail.com', 'temp-mail.org', 'tempmail.com', 'getnada.com', 'sharklasers.com', 'maildrop.cc', 'dispostable.com', 'throwawaymail.com', 'fakeinbox.com', 'mintemail.com', 'spam4.me',
])

/** Extract the lowercased domain from an email, or null if it doesn't look like an email. */
export function emailDomain(email: string): string | null {
  const m = /^[^\s@]+@([^\s@]+\.[^\s@]+)$/.exec((email || '').trim().toLowerCase())
  return m ? m[1] : null
}

/** True if the email uses a free/personal/disposable provider (i.e. NOT a business email). */
export function isFreeEmail(email: string): boolean {
  const d = emailDomain(email)
  return !!d && FREE_EMAIL_DOMAINS.has(d)
}

/** True if the email is a valid, non-free (business) email. */
export function isBusinessEmail(email: string): boolean {
  return !!emailDomain(email) && !isFreeEmail(email)
}
