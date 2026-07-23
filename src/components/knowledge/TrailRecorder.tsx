'use client'
/**
 * TRAIL RECORDER — invisible. The visual Trail ships only if behavior proves people
 * browse deep (Moeez's call: "the Trail should feel inevitable, not forced"). Until
 * then this quietly records each knowledge hop — Edition → object → object — so we
 * can measure real exploration depth. sessionStorage keeps the path; a beacon
 * upserts it server-side on every hop. Zero UI, zero blocking, best-effort only.
 */
import { useEffect } from 'react'

const KEY = 'knowledge_trail_v1'
const TTL = 30 * 60 * 1000

export default function TrailRecorder({ node }: { node: string }) {
  useEffect(() => {
    try {
      let s: any = null
      try { s = JSON.parse(sessionStorage.getItem(KEY) || 'null') } catch { s = null }
      const stale = !s || typeof s.t !== 'number' || Date.now() - s.t > TTL
      // Landing on the Edition starts a fresh trail; anything else continues one.
      if (stale || node === 'edition') s = { key: `t_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`, path: [] as string[] }
      if (s.path[s.path.length - 1] !== node) s.path.push(node)
      s.path = s.path.slice(-40)
      s.t = Date.now()
      sessionStorage.setItem(KEY, JSON.stringify(s))
      const body = JSON.stringify({ session_key: s.key, path: s.path })
      if (navigator.sendBeacon) navigator.sendBeacon('/api/knowledge/track', new Blob([body], { type: 'application/json' }))
      else fetch('/api/knowledge/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {})
    } catch { /* never let telemetry touch the reading experience */ }
  }, [node])
  return null
}
