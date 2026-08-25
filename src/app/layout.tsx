import type { Metadata } from 'next'
import ClientToaster from '@/components/ClientToaster'
import ErrorTracker from '@/components/ErrorTracker'
import './globals.css'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: { default: 'Selfmade', template: '%s — Selfmade' },
  description: 'AI-powered Meta ads platform. Stop guessing. Start winning.',
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'https://tryselfmade.ai'), icons: { icon: '/favicon-mark.png', shortcut: '/favicon-mark.png', apple: '/favicon-mark.png' },
  openGraph: {
    title: 'Selfmade — AI Meta Ads Platform',
    description: 'Stop guessing. Start winning. AI-powered Meta ads co-pilot.',
    type: 'website',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="scroll-smooth" suppressHydrationWarning>
      <head>
        {/* BUG-1 hydration watchdog. The reported failure: on a direct load/refresh the client bundle
            sometimes never hydrates (React root stays empty, app JS never fires) — systemic and
            intermittent. This runs before React; if ErrorTracker hasn't flipped window.__hydrated
            within 6s, it reloads ONCE (sessionStorage-guarded so a hard-broken page can't loop), which
            recovers the intermittent case instead of leaving a permanent blank screen. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{if(window.top!==window.self)return;var K='__hydration_retry';" +
              "setTimeout(function(){if(window.__hydrated)return;var n=0;try{n=+(sessionStorage.getItem(K)||0)}catch(e){}" +
              "if(n<1){try{sessionStorage.setItem(K,String(n+1))}catch(e){}location.reload()}},6000);" +
              "var iv=setInterval(function(){if(window.__hydrated){try{sessionStorage.removeItem(K)}catch(e){}clearInterval(iv)}},1000);}catch(e){}})();",
          }}
        />
        {/* Google Analytics 4 — set NEXT_PUBLIC_GA_ID (e.g. G-XXXXXXX) in env to enable. */}
        {process.env.NEXT_PUBLIC_GA_ID && (
          <>
            <script async src={`https://www.googletagmanager.com/gtag/js?id=${process.env.NEXT_PUBLIC_GA_ID}`} />
            <script dangerouslySetInnerHTML={{ __html:
              `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${process.env.NEXT_PUBLIC_GA_ID}');` }} />
          </>
        )}
        {/* Fonts are remapped to one Helvetica/Arial grotesque in globals.css (matches Lapis's
            Die Grotesk look); no web fonts are loaded. */}
        <style>{`
      @keyframes sm-pulse { 0%,100% { transform: scale(1); opacity: 1 } 50% { transform: scale(.9); opacity: .78 } }
      .selfmade-loading {
        display: inline-block;
        width: 32px; height: 32px;
        background: url(/favicon-mark.png) center/contain no-repeat;
        animation: sm-pulse 1.3s ease-in-out infinite;
        border-radius: 9px;
      }
    `}</style>
  </head>
      <body className="bg-dark text-white antialiased font-sans" suppressHydrationWarning>
        <ErrorTracker />
        {children}
        <ClientToaster />
      </body>
    </html>
  )
}
