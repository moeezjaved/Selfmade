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

    const isNoise = (message: string) => {
      if (!message || message === 'Script error.') return true
      if (message.includes('ResizeObserver loop')) return true
      if (message.includes('Non-Error promise rejection')) return true
      if (message.includes('Load failed')) return true
      return false
    }

    // After a deploy, Vercel purges the old JS chunks; a long-open tab then 404s on a
    // lazy chunk → "Application error: a client-side exception". Auto-reload ONCE to
    // pull the new build instead of stranding the user on the error page. Guarded by a
    // 15s sessionStorage stamp so a genuinely-broken chunk can't loop-reload forever.
    const CHUNK_RE = /ChunkLoadError|Loading (?:CSS )?chunk [\w-]+ failed|dynamically imported module|Importing a module script failed|error loading dynamically imported/i
    const maybeChunkReload = (message?: string) => {
      if (!message || !CHUNK_RE.test(message)) return false
      try {
        const KEY = '__chunk_reload_ts'
        const last = Number(sessionStorage.getItem(KEY) || 0)
        if (Date.now() - last > 15000) {
          sessionStorage.setItem(KEY, String(Date.now()))
          window.location.reload()
        }
      } catch { window.location.reload() }
      return true
    }

    const onError = (event: ErrorEvent) => {
      if (maybeChunkReload(event.message) || maybeChunkReload(event.error?.message)) return
      if (isNoise(event.message)) return
      log(event.message, event.error?.stack)
    }

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason
      const message = reason instanceof Error ? reason.message : String(reason)
      if (maybeChunkReload(message)) return
      if (isNoise(message)) return
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
