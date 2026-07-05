/**
 * Mello ACTION tools (agent-core rebuild, stage 2) — the "doing" tools that reuse existing infra so
 * Mello can operate, not just analyze: surface trending winners, manage boards, save ads it found,
 * and search the user's own uploaded Assets. All org-scoped via getUserOrg.
 */
import { createAdminClient } from '@/lib/supabase/server'
import { getUserOrg } from '@/lib/org'
import { embedText } from '@/lib/assets/enrich'

/** Trending winners (performance_score-ranked), optionally by niche — mirrors the /trending logic. */
export async function getTrending(params: { niche?: string; limit?: number }) {
  const admin = createAdminClient() as any
  const limit = Math.min(20, Math.max(1, params.limit || 10))
  let q = admin.from('discovery_ads_index')
    .select('ad_id, page_name, performance_score, format_style, hook_type, days_running, niche')
    .eq('has_creative', true).gt('performance_score', 0)
    .order('performance_score', { ascending: false }).limit(limit)
  if (params.niche) q = q.ilike('niche', `%${params.niche}%`)
  const { data } = await q
  return {
    niche: params.niche || 'all niches', count: (data || []).length,
    ads: (data || []).map((a: any) => ({ ad_id: a.ad_id, brand: a.page_name, score: Math.round((a.performance_score || 0) * 100) / 100, format: a.format_style, hook: a.hook_type, days_running: a.days_running })),
  }
}

/** The user's boards (team + own personal). */
export async function listBoards(userId: string) {
  const admin = createAdminClient() as any
  const org = await getUserOrg(admin, userId)
  const { data } = await admin.from('discovery_boards')
    .select('id, name, emoji, visibility').eq('org_id', org.orgId).or(`visibility.eq.team,created_by.eq.${userId}`)
  return { boards: (data || []).map((b: any) => ({ id: b.id, name: b.name, emoji: b.emoji, shared: b.visibility === 'team' })) }
}

/** Create a board (personal). */
export async function createBoard(userId: string, name: string, emoji = '📋') {
  const admin = createAdminClient() as any
  const org = await getUserOrg(admin, userId)
  const { data, error } = await admin.from('discovery_boards')
    .insert({ user_id: userId, created_by: userId, org_id: org.orgId, name: String(name).slice(0, 60), emoji, visibility: 'personal' }).select('id, name').single()
  if (error) return { error: error.message }
  return { created: true, board: { id: data.id, name: data.name } }
}

/** Save an ad (by ad_id, e.g. from search/trending results) into a board — creating it by name if needed. */
export async function saveAdToBoard(userId: string, adId: string, boardName: string) {
  const admin = createAdminClient() as any
  const org = await getUserOrg(admin, userId)
  let { data: board } = await admin.from('discovery_boards').select('id, name').eq('org_id', org.orgId).ilike('name', boardName).limit(1).maybeSingle()
  if (!board) {
    const { data: nb } = await admin.from('discovery_boards').insert({ user_id: userId, created_by: userId, org_id: org.orgId, name: String(boardName).slice(0, 60), emoji: '📌', visibility: 'personal' }).select('id, name').single()
    board = nb
  }
  const { data: ad } = await admin.from('discovery_ads_index').select('ad_id, page_id, page_name').eq('ad_id', String(adId)).maybeSingle()
  if (!ad) return { error: 'ad not found' }
  await admin.from('discovery_saved_ads').upsert(
    { user_id: userId, org_id: org.orgId, board_id: board.id, ad_id: ad.ad_id, page_id: ad.page_id, page_name: ad.page_name, ad_data: {} },
    { onConflict: 'user_id,board_id,ad_id' })
  return { saved: true, board: board.name, ad: ad.page_name }
}

/** Semantic search the user's own uploaded Assets library. */
export async function searchMyAssets(userId: string, query: string, limit = 12) {
  const admin = createAdminClient() as any
  const org = await getUserOrg(admin, userId)
  const emb = await embedText(query)
  if (emb) {
    const { data } = await admin.rpc('search_assets', { p_org: org.orgId, p_query: emb as any, p_limit: Math.min(24, limit) })
    return { assets: (data || []).map((a: any) => ({ id: a.id, name: a.file_name, type: a.file_type, scene: a.scene, tags: a.tags })) }
  }
  const { data } = await admin.from('assets').select('id, file_name, file_type, scene, tags').eq('org_id', org.orgId).ilike('file_name', `%${query}%`).limit(limit)
  return { assets: (data || []).map((a: any) => ({ id: a.id, name: a.file_name, type: a.file_type, scene: a.scene, tags: a.tags })) }
}
