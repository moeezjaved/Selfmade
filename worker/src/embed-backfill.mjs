/**
 * Embedding backfill — populates discovery_ads_index.embedding for the back-catalog so SEMANTIC
 * search actually works. The query side is already built (db-search embeds the query + calls the
 * search_ads_semantic RPC for gap-fill), but only NEW ads get embedded during a crawl tick — the
 * 2.1M backlog was never embedded, so "skincare" only ever matched the literal keyword (~81 ads).
 *
 * Uses the SAME enrichment as the indexer (src/app/api/indexer/route.ts:generateEmbeddings): copy +
 * AI concept tags (industries/themes/topics) + brand_categories, so thin-copy visual ads are still
 * findable by meaning. Embeds with text-embedding-3-small (batched), writes the vector back.
 *
 * Self-healing: targets `embedding IS NULL` ordered by ad_id; embedded rows drop out of the filter,
 * so it converges and is safe to re-run. Back it with a partial index for a fast scan:
 *   create index concurrently if not exists dai_unembedded
 *     on discovery_ads_index (ad_id) where embedding is null;
 *
 *   docker run -d --name embed-backfill --env-file /opt/worker/.env \
 *     -v /opt/worker/src:/app/src selfmade-worker node src/embed-backfill.mjs
 *   # tunables: EMBED_BATCH (default 200 — OpenAI allows up to 2048 inputs/call),
 *   #           EMBED_UPDATE_CONCURRENCY (default 25)
 */
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
const OPENAI_KEY = process.env.OPENAI_API_KEY
const BATCH = Math.max(1, Math.min(2048, Number(process.env.EMBED_BATCH || 200)))
const UPDATE_CONC = Math.max(1, Number(process.env.EMBED_UPDATE_CONCURRENCY || 25))
const MODEL = 'text-embedding-3-small'

if (!SUPABASE_URL || !SERVICE_KEY) { console.error('missing SUPABASE_URL / SERVICE_ROLE_KEY'); process.exit(1) }
if (!OPENAI_KEY) { console.error('missing OPENAI_API_KEY'); process.exit(1) }

const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Exact match to the indexer's enrichment — copy + concept tags + brand categories.
// BUG FIX: the `.slice(0, N)` used to bind only to the LAST template string (operator precedence:
// `a + b + c.slice()`), so the (often huge) `body` was never truncated → OpenAI 400s on the 8192-
// TOKEN cap and the whole batch fails. Wrap the full concat in parens and cap at 6000 CHARS — safe
// for CJK/emoji copy (≈1 token/char) and plenty of signal for English.
const embText = (a) =>
  (`${a.page_name || ''} ${a.title || ''} ${a.body || ''} ${a.description || ''} ` +
  `${(a.industries || []).join(' ')} ${(a.themes || []).join(' ')} ` +
  `${(a.topics || []).join(' ')} ${(a.brand_categories || []).join(' ')}`).slice(0, 6000)

async function embedRaw(inputs) {
  const r = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({ model: MODEL, input: inputs }),
  })
  if (!r.ok) { const t = await r.text(); const e = new Error(`OpenAI ${r.status}: ${t.slice(0, 300)}`); e.status = r.status; e.body = t; throw e }
  const d = await r.json()
  return d.data.map((x) => x.embedding)
}

async function embed(inputs) {
  // OpenAI rejects empty strings → pad to a single space so indices stay aligned with rows.
  let safe = inputs.map((t) => (t && t.trim()) ? t : ' ')
  try {
    return await embedRaw(safe)
  } catch (e) {
    // A stray CJK/emoji-dense row can still blow the token cap — retry ONCE with a hard 2500-char cut
    // on every input (bulletproof under 8192 tokens for any script) instead of failing the whole batch.
    if (e && e.status === 400 && /maximum input length/i.test(e.body || '')) {
      safe = safe.map((t) => t.slice(0, 2500) || ' ')
      return await embedRaw(safe)
    }
    throw e
  }
}

// Bounded-concurrency map so 200 row-updates don't open 200 simultaneous connections.
async function pooledUpdate(rows, vecs) {
  let i = 0, failed = 0
  await Promise.all(Array.from({ length: UPDATE_CONC }, async () => {
    while (i < rows.length) {
      const k = i++
      const { error } = await sb.from('discovery_ads_index')
        .update({ embedding: vecs[k] }).eq('ad_id', rows[k].ad_id)
      if (error) failed++
    }
  }))
  return failed
}

async function main() {
  console.log(`🔢 embed-backfill started (batch=${BATCH}, model=${MODEL})`)
  let done = 0, lastFirst = null
  for (;;) {
    const { data: rows, error } = await sb
      .from('discovery_ads_index')
      .select('ad_id, page_name, body, title, description, industries, themes, topics, brand_categories')
      .is('embedding', null)
      .order('ad_id', { ascending: true })
      .limit(BATCH)
    if (error) { console.error('query failed:', error.message); await sleep(4000); continue }
    if (!rows?.length) break

    // Safety: if the same first ad_id reappears (its update keeps failing), we'd loop forever —
    // detect and bail loudly instead of spinning.
    if (rows[0].ad_id === lastFirst) { console.error(`stuck on ad_id ${lastFirst} — updates not sticking; aborting`); break }
    lastFirst = rows[0].ad_id

    let vecs
    try { vecs = await embed(rows.map(embText)) }
    catch (e) { console.error('embed failed:', e.message, '— backing off 8s'); await sleep(8000); continue }

    const failed = await pooledUpdate(rows, vecs)
    done += rows.length - failed
    console.log(`  embedded ${done}${failed ? ` (·${failed} update-fail)` : ''} · last ad_id ${rows[rows.length - 1].ad_id}`)
  }
  console.log(`✅ embed-backfill done — ${done} embedded`)
  process.exit(0)
}

main().catch((e) => { console.error('fatal:', e); process.exit(1) })
