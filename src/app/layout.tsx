import type { Metadata } from 'next'
import { Toaster } from 'react-hot-toast'
import './globals.css'

export const metadata: Metadata = {
  title: { default: 'Selfmade', template: '%s — Selfmade' },
  description: 'AI-powered Meta ads platform. Stop guessing. Start winning.',
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'https://tryselfmade.ai'), icons: { icon: '/favicon.png', shortcut: '/favicon.png', apple: '/favicon.png' },
  openGraph: {
    title: 'Selfmade — AI Meta Ads Platform',
    description: 'Stop guessing. Start winning. AI-powered Meta ads co-pilot.',
    type: 'website',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="scroll-smooth">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com"/>
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous"/>
        <link
          href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Hanken+Grotesk:wght@300;400;500;600;700;800;900&display=swap"
          rel="stylesheet"
        />
        <style>{`
      @keyframes spin { to { transform: rotate(360deg) } }
      .selfmade-loading {
        display: inline-block;
        width: 32px; height: 32px;
        background: url('/favicon.png') center/contain no-repeat;
        animation: spin 1s linear infinite;
        border-radius: 8px;
      }
    `}</style>
  </head>
      <body className="bg-dark text-white antialiased font-sans">
        {children}
        <Toaster
          position="bottom-right"
          toastOptions={{
            style: {
              background: '#152928',
              color: '#ffffff',
              border: '1px solid rgba(223,254,149,0.2)',
              fontFamily: 'Hanken Grotesk, sans-serif',
              fontSize: '14px',
            },
            success: {
              iconTheme: { primary: '#dffe95', secondary: '#10211f' },
            },
            error: {
              iconTheme: { primary: '#f87171', secondary: '#10211f' },
            },
          }}
        />
      </body>
    </html>
  )
}
