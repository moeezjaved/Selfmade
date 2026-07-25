/**
 * THE VOICE — Selfmade's design language, in one place. (Section 3 fix: excellent pieces that didn't
 * compound into one unmistakable voice. This is the law they compound into.)
 *
 * Three registers, and it must always be legible WHO is speaking:
 *   · mello()  — Instrument Serif. Mello's own words: headlines, greetings, the verbs on the desk.
 *   · ui       — Inter. Chrome: buttons, labels, counts, form fields. Never speaks; it frames.
 *   · machine  — mono. The system at work: narrated loading, timestamps, the night's log.
 *
 * Premium, the Cofounder way = luxury calm: serif carries meaning, generous air (SPACE), restraint.
 * Import these instead of re-typing font strings per component, so nothing drifts.
 */
import type { CSSProperties } from 'react'

/** Tokens — the brief's palette, promoted to the shared source of truth. */
export const T = {
  ink: '#161c17',      // primary text
  muted: '#68756b',    // secondary
  faint: '#9aa79a',    // tertiary / timestamps
  paper: '#faf9f5',    // warm surface
  shell: '#f6f8f5',    // app background
  card: '#ffffff',
  hair: '#ecebe3',     // hairline inside a surface
  line: '#e3e2da',     // border between surfaces
  forest: '#17251c',   // ink-dark brand
  lime: '#dffe95',     // action / highlight
  green: '#3f8f4f',    // links / affordance
  greenBg: '#eef6e4',
  greenLine: '#d3e6b8',
} as const

/** A modular spacing scale — premium reads as generous, consistent air (px). */
export const SPACE = { xs: 4, sm: 8, md: 14, lg: 22, xl: 36, xxl: 58 } as const

/** MELLO SPEAKING — Instrument Serif. Pass a size; line-height/tracking scale for display use. */
export const mello = (size = 20): CSSProperties => ({
  fontFamily: "'Instrument Serif', Georgia, serif",
  fontWeight: 400,
  fontSize: size,
  lineHeight: size >= 30 ? 1.08 : 1.2,
  letterSpacing: size >= 30 ? '-.015em' : '-.005em',
  color: T.ink,
})

/** UI CHROME — Inter. The frame around Mello's words; never the words themselves. */
export const ui: CSSProperties = { fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif" }

/** THE MACHINE AT WORK — mono. Narration, timestamps, logs. Signals "the system is doing something." */
export const machine: CSSProperties = { fontFamily: "ui-monospace, 'SF Mono', 'SFMono-Regular', Menlo, monospace" }

/** An uppercase eyebrow label — the quiet section marker used across the brief/scan. */
export const label: CSSProperties = {
  ...ui, fontSize: 11, fontWeight: 800, letterSpacing: '.14em',
  textTransform: 'uppercase', color: T.faint,
}
