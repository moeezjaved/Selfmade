'use client'
import { useEffect } from 'react'

export default function ErrorTracker() {
  useEffect(() => {
    const log = async (message: string, stack?: string, extra?: Record<string, unknown>) => {
      try {
        await fetch('/api/errors/log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            error_message: message,
            error_stack: stack,
            page_url: window.location.href,
            extra,
          }),
        })
      } catch {}
    }

    const onError = (event: ErrorEvent) => {
      log(event.message, event.error?.stack)
    }

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason
      const message = reason instanceof Error ? reason.message : String(reason)
      const stack = reason instanceof Error ? reason.stack : undefined
      log(`Unhandled Promise: ${message}`, stack)
    }

    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onUnhandledRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onUnhandledRejection)
    }
  }, [])

  return null
}
