'use client'
/**
 * ShellFlag — flips the `sf_shell` cookie from a `?shell=v2` / `?shell=v1` URL param, then reloads so the
 * server layout re-evaluates and renders the chosen shell. This is how we test Unified Shell v2 without
 * touching the default for real users. Renders nothing.
 */
import { useEffect } from 'react'

export default function ShellFlag() {
  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    const v = p.get('shell')
    if (v !== 'v1' && v !== 'v2') return
    document.cookie = `sf_shell=${v}; path=/; max-age=31536000`
    p.delete('shell')
    const qs = p.toString()
    window.location.replace(window.location.pathname + (qs ? `?${qs}` : ''))
  }, [])
  return null
}
