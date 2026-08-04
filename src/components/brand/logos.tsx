import type { ReactNode } from 'react'

/* Real brand marks (inline SVG, self-contained) — shared across Settings + the Customer Inbox. */

export function InstagramLogo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <radialGradient id="ig-g" cx="30%" cy="107%" r="150%">
          <stop offset="0%" stopColor="#fdf497" /><stop offset="5%" stopColor="#fdf497" /><stop offset="45%" stopColor="#fd5949" />
          <stop offset="60%" stopColor="#d6249f" /><stop offset="90%" stopColor="#285AEB" />
        </radialGradient>
      </defs>
      <rect x="1" y="1" width="22" height="22" rx="6" fill="url(#ig-g)" />
      <rect x="5.2" y="5.2" width="13.6" height="13.6" rx="4.4" fill="none" stroke="#fff" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="3.3" fill="none" stroke="#fff" strokeWidth="1.8" />
      <circle cx="16.4" cy="7.6" r="1.1" fill="#fff" />
    </svg>
  )
}
export function WhatsAppLogo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path fill="#25D366" d="M16 0C7.2 0 0 7.2 0 16c0 2.8.7 5.5 2.1 7.9L0 32l8.3-2.2C10.6 31.2 13.2 32 16 32c8.8 0 16-7.2 16-16S24.8 0 16 0z" />
      <path fill="#FFF" d="M23.9 19.4c-.4-.2-2.4-1.2-2.7-1.3-.4-.1-.6-.2-.9.2-.3.4-1 1.3-1.2 1.5-.2.2-.4.3-.8.1-.4-.2-1.7-.6-3.3-2-1.2-1.1-2-2.4-2.3-2.8-.2-.4 0-.6.2-.8.2-.2.4-.4.5-.7.2-.2.2-.4.4-.6.1-.3.1-.5 0-.7-.1-.2-.9-2.1-1.2-2.9-.3-.8-.6-.6-.9-.7h-.7c-.2 0-.6.1-.9.5-.3.4-1.2 1.2-1.2 2.9 0 1.7 1.2 3.4 1.4 3.6.2.2 2.5 3.8 6 5.3.8.4 1.5.6 2 .7.8.3 1.6.2 2.2.1.7-.1 2.1-.9 2.4-1.7.3-.8.3-1.6.2-1.7-.1-.2-.3-.2-.7-.4z" />
    </svg>
  )
}
export function MessengerLogo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" aria-hidden="true">
      <radialGradient id="mg" cx="19%" cy="99%" r="110%">
        <stop offset="0" stopColor="#09f" /><stop offset=".6" stopColor="#a033ff" /><stop offset=".9" stopColor="#ff5280" /><stop offset="1" stopColor="#ff7061" />
      </radialGradient>
      <path fill="url(#mg)" d="M18 0C7.9 0 0 7.4 0 17.4c0 5.2 2.1 9.7 5.6 12.8.3.3.5.6.5 1l.1 3.2c0 1 1.1 1.7 2 1.3l3.6-1.6c.3-.1.6-.2 1-.1 1.6.5 3.4.7 5.2.7 10.1 0 18-7.4 18-17.4S28.1 0 18 0z" />
      <path fill="#fff" d="M7.2 22.6l5.3-8.4c.8-1.3 2.6-1.6 3.8-.7l4.2 3.2c.4.3.9.3 1.3 0l5.7-4.3c.8-.6 1.7.3 1.2 1.1l-5.3 8.4c-.8 1.3-2.6 1.6-3.8.7L15.4 19c-.4-.3-.9-.3-1.3 0l-5.7 4.3c-.8.6-1.7-.3-1.2-1.1z" />
    </svg>
  )
}
export function TelegramLogo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="24" r="24" fill="#29b6f6" />
      <path fill="#fff" d="M10.5 23.5l24-9.3c1.1-.4 2.1.3 1.7 2l-4.1 19.3c-.3 1.3-1.1 1.6-2.2 1L23 32l-3 2.9c-.3.3-.6.5-1.2.6l.4-6.1 11.6-10.5c.5-.4-.1-.6-.8-.2l-14.3 9-6.1-1.9c-1.3-.4-1.3-1.3.2-1.9z" />
    </svg>
  )
}
export function LinkedInLogo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <rect width="48" height="48" rx="8" fill="#0a66c2" />
      <path fill="#fff" d="M14 19h5v15h-5zM16.5 11.4a2.9 2.9 0 110 5.9 2.9 2.9 0 010-5.9zM22 19h4.8v2.1h.1c.7-1.3 2.4-2.6 4.9-2.6 5.2 0 6.2 3.4 6.2 7.9V34h-5v-6.7c0-1.6 0-3.6-2.2-3.6s-2.6 1.7-2.6 3.5V34H22z" />
    </svg>
  )
}
export function XLogo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <rect width="48" height="48" rx="8" fill="#000" />
      <path fill="#fff" d="M26.4 21.9 36 11h-2.3l-8.3 9.5L18.7 11H11l10 14.6L11 37h2.3l8.8-10.1L28.9 37H37zm-3.1 3.6-1-1.5-8.1-11.6h3.5l6.6 9.4 1 1.5 8.5 12.2h-3.5z" />
    </svg>
  )
}
export function EmailLogo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="2.5" y="4.5" width="19" height="15" rx="2.5" fill="#fff" stroke="#5f6368" strokeWidth="1.7" />
      <path d="M3.5 6.5 12 13l8.5-6.5" fill="none" stroke="#5f6368" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

const MAP: Record<string, (p: { size?: number }) => ReactNode> = {
  instagram: InstagramLogo, whatsapp: WhatsAppLogo, messenger: MessengerLogo,
  telegram: TelegramLogo, linkedin: LinkedInLogo, x: XLogo, email: EmailLogo,
}

/** Dispatch a logo by provider key. Falls back to a neutral chat glyph. */
export function ChannelLogo({ provider, size = 24 }: { provider: string; size?: number }) {
  const C = MAP[provider]
  return C ? <>{C({ size })}</> : <span style={{ fontSize: size }}>💬</span>
}
