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
      position="bottom-right"
      toastOptions={{
        style: {
          background: '#152928',
          color: '#ffffff',
          border: '1px solid rgba(223,254,149,0.2)',
          fontFamily: 'Hanken Grotesk, sans-serif',
          fontSize: '14px',
        },
        success: { iconTheme: { primary: '#dffe95', secondary: '#10211f' } },
        error: { iconTheme: { primary: '#f87171', secondary: '#10211f' } },
      }}
    />
  )
}
