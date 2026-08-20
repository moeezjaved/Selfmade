/**
 * Prettify inbound customer message bodies for display + triage.
 *
 * Two jobs:
 *  1. Unipile can't render every WhatsApp/Instagram message type (polls, stickers, some attachments,
 *     ephemeral/view-once media). For those it delivers a raw placeholder like
 *       "-- Unipile cannot display this type of message yet, check the native application --"
 *     Leaking that into the inbox (and into Mello's drafted reply) looks broken, so we swap it for a
 *     short, human line.
 *  2. EMAIL bodies arrive as raw HTML — full <style> blocks, Outlook `<!--[if mso]>` conditional
 *     comments, tracking markup, entities. Dumped straight into the inbox card that reads as a wall of
 *     overlapping tag soup. We strip it down to readable plain text.
 *
 * Safe to call anywhere — a plain WhatsApp string with no markup passes through essentially unchanged.
 */
const UNSUPPORTED = /unipile cannot display this type of message|cannot display this type of message yet/i

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
  mdash: '—', ndash: '–', hellip: '…', middot: '·', bull: '•',
}

/** Strip HTML/Outlook email markup down to readable plain text. No-op-ish on tag-free strings. */
export function stripEmailHtml(input: string): string {
  return input
    // Outlook / IE conditional comments + any HTML comment (this is the mso tag-soup in the report).
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<!\[if[\s\S]*?\]>/gi, ' ')
    .replace(/<!\[endif\]>/gi, ' ')
    // Whole non-content blocks.
    .replace(/<(style|script|head|title|xml)[\s\S]*?<\/\1>/gi, ' ')
    // Tracking / footer links — pull them BEFORE tag-stripping so the whole URL is still intact (once
    // tags turn into spaces a long query string splits into unremovable gibberish).
    .replace(/https?:\/\/[^\s<>"')]+/gi, ' ')
    // Structural tags → line breaks so sentences don't run together.
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|table|blockquote)>/gi, '\n')
    // Everything else that looks like a tag.
    .replace(/<[a-z!/][^>]*>/gi, ' ')
    // Entities.
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)) } catch { return ' ' } })
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(parseInt(n, 10)) } catch { return ' ' } })
    .replace(/&([a-z]+);/gi, (m, name) => NAMED_ENTITIES[name.toLowerCase()] ?? m)
    // Leftover email-footer noise: "key=value&key=value" tracking params, standalone long tracking
    // tokens/ids, and ASCII divider rules (------- / ======= / •••). Emails carry these; real chat
    // messages don't — and stripEmailHtml only runs on markup-bearing bodies anyway.
    .replace(/[\w.+-]+=[\w%~:.@+/-]{6,}(?:&[\w.+-]+=[\w%~:.@+/-]+)*/g, ' ')
    .replace(/\b[A-Za-z0-9_%~+/-]{24,}\b/g, ' ')
    .replace(/(?:^|\s)[-–—_=*·•~]{3,}(?:\s|$)/g, ' ')
    // Tidy whitespace.
    .replace(/ /g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// Looks like markup we should strip (a real tag, a conditional comment, or an entity) — not just a
// stray "<3" or "a < b" in a plain chat message.
const LOOKS_HTML = /<[a-z!/][^>]*>|<!\[if|&[a-z]+;|&#\d+;/i

export function prettyInbound(raw: string | null | undefined): string {
  let t = String(raw || '').trim()
  if (!t) return t
  if (UNSUPPORTED.test(t)) return 'Sent something WhatsApp can’t show here (a poll, sticker, or attachment). Open the chat on your phone to see it.'
  if (LOOKS_HTML.test(t)) t = stripEmailHtml(t)
  // Cap a runaway email dump so the inbox card stays a preview, not a scroll of newsletter boilerplate.
  if (t.length > 900) t = t.slice(0, 900).replace(/\s+\S*$/, '') + '…'
  return t
}

/** True when a body is one of the unsupported-type placeholders (so callers can style it as a note). */
export function isUnsupportedBody(raw: string | null | undefined): boolean {
  return UNSUPPORTED.test(String(raw || ''))
}
