/**
 * Prettify inbound customer message bodies for display + triage.
 *
 * Unipile can't render every WhatsApp/Instagram message type (polls, stickers, some attachments,
 * ephemeral/view-once media). For those it delivers a raw placeholder like
 *   "-- Unipile cannot display this type of message yet, check the native application --"
 * Leaking that into the inbox (and into Mello's drafted reply) looks broken, so we swap it for a short,
 * human line. Safe to call anywhere — plain strings pass straight through unchanged.
 */
const UNSUPPORTED = /unipile cannot display this type of message|cannot display this type of message yet/i

export function prettyInbound(raw: string | null | undefined): string {
  const t = String(raw || '').trim()
  if (!t) return t
  if (UNSUPPORTED.test(t)) return 'Sent something WhatsApp can’t show here (a poll, sticker, or attachment). Open the chat on your phone to see it.'
  return t
}

/** True when a body is one of the unsupported-type placeholders (so callers can style it as a note). */
export function isUnsupportedBody(raw: string | null | undefined): boolean {
  return UNSUPPORTED.test(String(raw || ''))
}
