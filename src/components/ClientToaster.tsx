'use client'
/**
 * Client-only Toaster. react-hot-toast@2.4.1's <Toaster> server-renders a container that doesn't
 * match the client tree → React hydration #418/#423/#425, which discarded the whole page ("feed
 * vanishes then returns"). It sits in the ROOT layout — the one part of the tree NOT behind a
 * mounted-gate — and it's a library, so it lives in the vendor chunk whose hash never changed
 * across deploys (the tell that my app-code fixes never touched the real source). Rendering it
 * only after mount means the server + first client render emit NOTHING here, so there's nothing
 * to mismatch. Toasts are user-triggered (always post-mount), so zero UX cost.
 */
import { useState, useEffect } from 'react'
import { Toaster } from 'react-hot-toast'

export default function ClientToaster() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  if (!mounted) return null
  return (
    <Toaster
      // Top-CENTER, bigger, and longer — errors were small, in the corner, and gone before they could
      // be read (founder feedback). Errors especially stay up long enough to act on.
      position="top-center"
      containerStyle={{ top: 24 }}
      toastOptions={{
        duration: 6000,
        style: {
          background: '#152928',
          color: '#ffffff',
          border: '1px solid rgba(223,254,149,0.2)',
          fontFamily: 'Hanken Grotesk, sans-serif',
          fontSize: '15px',
          fontWeight: 600,
          lineHeight: '1.5',
          padding: '16px 20px',
          maxWidth: '560px',
          borderRadius: '14px',
          boxShadow: '0 12px 40px -8px rgba(0,0,0,0.45)',
        },
        success: { duration: 5000, iconTheme: { primary: '#dffe95', secondary: '#10211f' } },
        // Errors linger + get a red edge so they read as errors at a glance.
        error: { duration: 10000, style: { border: '1px solid rgba(248,113,113,0.55)' }, iconTheme: { primary: '#f87171', secondary: '#10211f' } },
      }}
    />
  )
}
