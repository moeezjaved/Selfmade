/**
 * DB-backed proxy pool — round-robins crawl traffic across multiple proxies.
 *
 * Solves: a single static residential IP gets soft-throttled by Meta after
 * ~60 requests/session (verified empirically — latency jumps 5-10×). Spreading
 * load across N IPs keeps every brand on the fast lane and gives us instant
 * "IP got flagged" fallback.
 *
 * Behavior:
 *   - Loads enabled rows from `proxy_pool` table (cached 60s)
 *   - Round-robin pick per call to next()
 *   - On crawl finish, caller logs result via recordEvent()
 *   - If pool is empty OR USE_PROXY_POOL != 'true', returns null
 *     → caller falls back to legacy startProxyChain() (IPRoyal)
 *
 * This is the ONLY module that talks to the proxy_pool table from the worker.
 * Admin UI manages the table via REST API on the Vercel side.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { Server } from 'proxy-chain'
import { isBlockedMediaHost, isBlockedTelemetryHost } from './proxy-chain.js'

export interface PoolProxy {
  id: string
  label: string
  provider: string
  host: string
  port: number
  username: string
  password: string
  country: string | null
  isp: string | null
}

const SUPABASE_URL = process.env.SUPABASE_URL || ''
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
export const proxyPoolEnabled =
  process.env.USE_PROXY_POOL === 'true' && !!SUPABASE_URL && !!SUPABASE_KEY

let _sb: SupabaseClient | null = null
function sb(): SupabaseClient {
  if (!_sb) _sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  return _sb
}

// In-memory cache (used by debugPool only — pickProxy queries fresh for LRU ordering)
let _cache: { proxies: PoolProxy[]; ts: number } | null = null
const CACHE_TTL_MS = 60_000

async function loadPool(): Promise<PoolProxy[]> {
  const now = Date.now()
  if (_cache && now - _cache.ts < CACHE_TTL_MS) return _cache.proxies
  const { data, error } = await sb()
    .from('proxy_pool')
    .select('id,label,provider,host,port,username,password,country,isp')
    .eq('enabled', true)
    .order('added_at', { ascending: true })
  if (error) {
    console.warn(`[proxy-pool] load failed: ${error.message} — returning empty`)
    return []
  }
  const proxies = (data || []) as PoolProxy[]
  _cache = { proxies, ts: now }
  return proxies
}

/**
 * Pick the least-recently-used enabled proxy, then immediately mark it used.
 *
 * Why LRU-via-DB and not an in-memory round-robin: each crawl runs as a SEPARATE
 * process (the scheduler spawns a fresh `tsx playwright-indexer` per brand), so an
 * in-memory cursor resets to 0 every process and always picks the first IP —
 * leaving the other IPs idle while the first gets throttled. Selecting the proxy
 * with the oldest `last_used_at` and AWAITING the update distributes load evenly
 * across all IPs regardless of process boundaries.
 *
 * Returns null if pool is disabled or empty — caller should fall back to IPRoyal.
 */
export async function pickProxy(): Promise<PoolProxy | null> {
  if (!proxyPoolEnabled) return null
  const { data, error } = await sb()
    .from('proxy_pool')
    .select('id,label,provider,host,port,username,password,country,isp')
    .eq('enabled', true)
    .order('last_used_at', { ascending: true, nullsFirst: true })
    .limit(1)
  if (error) {
    console.warn(`[proxy-pool] pick failed: ${error.message} — returning null`)
    return null
  }
  if (!data || data.length === 0) return null
  const p = data[0] as PoolProxy
  // AWAIT the touch so the NEXT process (next crawl) sees the updated timestamp
  // and rotates to a different IP. Fire-and-forget would let concurrent picks
  // race onto the same IP.
  await sb().from('proxy_pool').update({ last_used_at: new Date().toISOString() }).eq('id', p.id)
  return p
}

/**
 * Spin up a localhost proxy-chain wrapper for a pool proxy. Returns
 * { url, close } matching the shape of startProxyChain() so callers can
 * use the same interface.
 *
 * Chromium needs this wrapper because some proxy auth schemes don't work
 * over its HTTPS CONNECT handshake (same reason we have proxy-chain for
 * IPRoyal). Playwright's native proxy field DOES work for Proxy-Cheap basic
 * auth — but using proxy-chain keeps a single code path for the indexer.
 */
export async function openProxyChain(p: PoolProxy): Promise<{ url: string; close: () => Promise<void> }> {
  const upstream = `http://${encodeURIComponent(p.username)}:${encodeURIComponent(p.password)}@${p.host}:${p.port}`
  // Filtering local server (NOT plain anonymizeProxy): reject media + Google-telemetry hosts so they
  // never consume IPRoyal bytes on the POOL path. Without this, Chromium's google.com / mtalk /
  // googleapis chatter was forwarded straight upstream — 693281a only filtered the proxy-CHAIN path,
  // but the crawl tries the POOL first (pickProxy), so the telemetry leak survived the rebuild.
  // Mirrors proxy-chain.ts's filtering Server.
  const server = new Server({
    port: 0,
    verbose: false,
    prepareRequestFunction: ({ hostname }: any) => {
      if (hostname && (isBlockedMediaHost(hostname) || isBlockedTelemetryHost(hostname))) {
        throw new Error(`blocked-host:${hostname}`)   // refused before any upstream connect → 0 IPRoyal
      }
      return { upstreamProxyUrl: upstream }
    },
  })
  server.on('error', () => { /* swallow per-connection errors (rejected media/telemetry) */ })
  await server.listen()
  return {
    url: `http://127.0.0.1:${server.port}`,
    close: async () => { try { await server.close(true) } catch { /* ignore */ } },
  }
}

/**
 * Log a per-request event for observability. Non-blocking — failures here
 * never break the crawl.
 */
export function recordEvent(opts: {
  proxyId: string
  kind: 'crawl' | 'asset' | 'error' | 'disabled'
  latencyMs?: number | null
  httpStatus?: number | null
  bytes?: number | null
  brandPageId?: string | null
  errorMessage?: string | null
}): void {
  if (!proxyPoolEnabled) return
  sb().from('proxy_pool_events').insert({
    proxy_pool_id: opts.proxyId,
    kind: opts.kind,
    latency_ms: opts.latencyMs ?? null,
    http_status: opts.httpStatus ?? null,
    bytes: opts.bytes ?? null,
    brand_page_id: opts.brandPageId ?? null,
    error_message: opts.errorMessage ?? null,
  }).then(() => {}, (e) => console.warn(`[proxy-pool] recordEvent failed: ${e?.message ?? e}`))
}

/**
 * Mark a proxy as disabled (e.g. after repeated 4xx/5xx from Meta).
 * Worker can call this to self-heal — the IP drops out of rotation within
 * 60s (next cache refresh).
 */
export async function disableProxy(proxyId: string, reason: string): Promise<void> {
  if (!proxyPoolEnabled) return
  recordEvent({ proxyId, kind: 'disabled', errorMessage: reason })
  await sb()
    .from('proxy_pool')
    .update({ enabled: false, disabled_at: new Date().toISOString(), disabled_reason: reason })
    .eq('id', proxyId)
  _cache = null // invalidate cache so next pickProxy() refetches
}

/** For tests/debugging — show what the pool currently has cached. */
export async function debugPool(): Promise<{ count: number; proxies: PoolProxy[] }> {
  const proxies = await loadPool()
  return { count: proxies.length, proxies }
}
