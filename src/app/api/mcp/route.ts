/**
 * Selfmade MCP server — a read-only Model Context Protocol endpoint so external AI clients (Claude,
 * Cursor, ChatGPT) can query the 3M+ ad library + its AI tags directly. JSON-RPC 2.0 over POST.
 *
 * Auth: `Authorization: Bearer <token>` where token is a row in mcp_keys (minted at /admin/mcp).
 * Reads from the cached discovery_ads_index (never live Meta calls) — same design constraint Motion
 * uses to avoid getting ad accounts flagged. Read-only: no tool mutates anything.
 *
 * Methods: initialize · tools/list · tools/call.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const toSlug = (s: string) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
function img(url: string, w = 400) {
  if (!url) return null
  if (/r2\.dev|r2\.cloudflarestorage|\/\/pub-|\/\/cdn\./.test(url)) return url
  return `https://images.weserv.nl/?url=${encodeURIComponent(url)}&w=${w}&q=72&output=webp`
}
const SITE = (process.env.NEXT_PUBLIC_APP_URL || 'https://tryselfmade.ai').replace(/\/$/, '')

// ── Tool schemas (advertised to the client) ──
const TOOLS = [
  { name: 'search_ads', description: 'Search the Selfmade library of 3M+ real Meta ads by keyword and AI tags (niche, hook type, visual format). Returns top matches ranked by performance.',
    inputSchema: { type: 'object', properties: {
      query: { type: 'string', description: 'keyword to match in ad copy/headline' },
      niche: { type: 'string', description: 'industry/niche filter, e.g. "Supplements"' },
      hook_type: { type: 'string', description: 'hook tactic filter, e.g. "Testimonial", "Question"' },
      format_style: { type: 'string', description: 'visual format filter, e.g. "UGC", "Before & After"' },
      limit: { type: 'number', description: 'max results (default 12, max 40)' },
    } } },
  { name: 'get_trending', description: 'Top-performing Meta ads right now, optionally scoped to an industry. Ranked by Selfmade performance score.',
    inputSchema: { type: 'object', properties: { niche: { type: 'string' }, limit: { type: 'number' } } } },
  { name: 'get_ad', description: 'Full detail for one ad by ad_id: copy, brand, AI tags (hook/emotion/angle/persona/topics), creative image URL.',
    inputSchema: { type: 'object', required: ['ad_id'], properties: { ad_id: { type: 'string' } } } },
  { name: 'get_brand_ads', description: 'Top ads for a specific brand (by name or page_id).',
    inputSchema: { type: 'object', properties: { brand: { type: 'string' }, page_id: { type: 'string' }, limit: { type: 'number' } } } },
  { name: 'top_formats', description: 'Most common visual ad formats (with counts), optionally by industry — a "popular formats" trend signal.',
    inputSchema: { type: 'object', properties: { niche: { type: 'string' }, limit: { type: 'number' } } } },
  { name: 'list_taxonomy', description: 'The Selfmade tag taxonomy: available industries/niches and hook types you can filter by.',
    inputSchema: { type: 'object', properties: {} } },
]

const ADCOLS = 'ad_id, page_id, page_name, body, title, niche, hook_type, emotion, angle, format_style, topics, performance_score, days_running, is_active, discovery_creatives(asset_type,position,r2_url,poster_url)'

function shapeAd(r: any) {
  const c = (r.discovery_creatives || []).slice().sort((a: any, b: any) => (a.position || 0) - (b.position || 0))
    .find((x: any) => (x.asset_type === 'video' ? x.poster_url : x.r2_url))
  return {
    ad_id: r.ad_id, brand: r.page_name || 'Brand', niche: r.niche || null,
    hook_type: r.hook_type || null, format_style: r.format_style || null,
    emotion: r.emotion || null, angle: r.angle || null, topics: r.topics || null,
    copy: (r.body || r.title || '').slice(0, 400) || null,
    performance_score: Math.round((Number(r.performance_score) || 0) * 100),
    days_running: r.days_running ?? null, active: !!r.is_active,
    image: c ? img(c.asset_type === 'video' ? c.poster_url : c.r2_url) : null,
    permalink: `${SITE}/discovery?ad=${r.ad_id}`,
  }
}

async function runTool(name: string, args: any) {
  const db = createAdminClient() as any
  const clamp = (n: any, d: number, max: number) => Math.min(Math.max(1, parseInt(n, 10) || d), max)

  if (name === 'search_ads') {
    let q = db.from('discovery_ads_index').select(ADCOLS).eq('has_creative', true).gt('performance_score', 0)
    if (args.niche) q = q.eq('niche', args.niche)
    if (args.hook_type) q = q.eq('hook_type', args.hook_type)
    if (args.format_style) q = q.eq('format_style', args.format_style)
    if (args.query) q = q.or(`body.ilike.%${String(args.query).replace(/[%,]/g, '')}%,title.ilike.%${String(args.query).replace(/[%,]/g, '')}%`)
    const { data } = await q.order('performance_score', { ascending: false }).limit(clamp(args.limit, 12, 40))
    return { count: (data || []).length, ads: (data || []).map(shapeAd) }
  }
  if (name === 'get_trending') {
    let q = db.from('discovery_ads_index').select(ADCOLS).eq('has_creative', true).gt('performance_score', 0)
    if (args.niche) q = q.eq('niche', args.niche)
    const { data } = await q.order('performance_score', { ascending: false }).limit(clamp(args.limit, 12, 40))
    return { count: (data || []).length, ads: (data || []).map(shapeAd) }
  }
  if (name === 'get_ad') {
    if (!args.ad_id) throw new Error('ad_id required')
    const { data } = await db.from('discovery_ads_index').select(ADCOLS).eq('ad_id', String(args.ad_id)).maybeSingle()
    return data ? shapeAd(data) : { error: 'not found' }
  }
  if (name === 'get_brand_ads') {
    let q = db.from('discovery_ads_index').select(ADCOLS).eq('has_creative', true)
    if (args.page_id) q = q.eq('page_id', String(args.page_id))
    else if (args.brand) q = q.ilike('page_name', `%${String(args.brand).replace(/[%,]/g, '')}%`)
    else throw new Error('brand or page_id required')
    const { data } = await q.order('performance_score', { ascending: false }).limit(clamp(args.limit, 12, 40))
    return { count: (data || []).length, ads: (data || []).map(shapeAd) }
  }
  if (name === 'top_formats') {
    let q = db.from('discovery_ads_index').select('format_style').eq('has_creative', true).not('format_style', 'is', null)
    if (args.niche) q = q.eq('niche', args.niche)
    const { data } = await q.limit(5000)
    const counts = new Map<string, number>()
    for (const r of (data || [])) counts.set(r.format_style, (counts.get(r.format_style) || 0) + 1)
    const formats = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, clamp(args.limit, 12, 30)).map(([format, count]) => ({ format, count }))
    return { formats }
  }
  if (name === 'list_taxonomy') {
    const { data: nc } = await db.from('niche_counts').select('niche').limit(60)
    const niches = Array.from(new Set((nc || []).map((r: any) => r.niche).filter(Boolean)))
    return { niches, hook_types: ['Question', 'Before & After', 'Testimonial', 'Story', 'Announcement', 'Educational', 'Urgency', 'Discount', 'Unboxing', 'Us vs Them', 'Social Proof', 'Pain Point'] }
  }
  throw new Error(`unknown tool: ${name}`)
}

async function authed(request: NextRequest): Promise<boolean> {
  const h = request.headers.get('authorization') || ''
  const token = h.replace(/^Bearer\s+/i, '').trim()
  if (!token) return false
  try {
    const db = createAdminClient() as any
    const { data } = await db.from('mcp_keys').select('id').eq('token', token).eq('revoked', false).maybeSingle()
    if (!data) return false
    db.from('mcp_keys').update({ last_used_at: new Date().toISOString() }).eq('id', data.id).then(() => {}, () => {})
    return true
  } catch { return false }
}

export async function POST(request: NextRequest) {
  if (!(await authed(request))) return NextResponse.json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized — provide a valid Selfmade MCP key as Bearer token' } }, { status: 401 })
  const body = await request.json().catch(() => null)
  const id = body?.id ?? null
  const method = body?.method

  if (method === 'initialize') {
    return NextResponse.json({ jsonrpc: '2.0', id, result: {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'selfmade', version: '1.0.0' },
      instructions: 'Read-only access to the Selfmade library of 3M+ real Meta ads with AI tags. Use search_ads/get_trending to find winning ads, get_ad for detail, top_formats/list_taxonomy for trends and filters.',
    } })
  }
  if (method === 'tools/list') return NextResponse.json({ jsonrpc: '2.0', id, result: { tools: TOOLS } })
  if (method === 'tools/call') {
    const { name, arguments: args } = body?.params || {}
    try {
      const result = await runTool(name, args || {})
      return NextResponse.json({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] } })
    } catch (e: any) {
      return NextResponse.json({ jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: `Error: ${e?.message || e}` }] } })
    }
  }
  if (method === 'ping' || method === 'notifications/initialized') return NextResponse.json({ jsonrpc: '2.0', id, result: {} })
  return NextResponse.json({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } }, { status: 200 })
}

export async function GET() {
  return NextResponse.json({ server: 'selfmade-mcp', status: 'ok', transport: 'JSON-RPC 2.0 over POST', auth: 'Bearer <mcp key>', tools: TOOLS.map(t => t.name) })
}
