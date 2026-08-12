/**
 * shouldRemember — the deterministic gate that decides whether a founder message contains DURABLE
 * company knowledge worth extracting into the Company Brain. This is Phase 3/11: memory must be
 * selective. Questions, product-help, metric lookups and chit-chat are NEVER remembered; only
 * statements that assert a belief, decision, learning, plan or preference pass. The LLM extractor
 * (brainIngest) runs only AFTER this gate, so we never burn an extraction call — or risk junk memory —
 * on "How do I connect Meta?" or "what's my ROAS?".
 */
import { isProductHelp } from '@/lib/mello/intent'
import { isAdsQuestion } from '@/lib/meta/answer'

// Statement shapes that carry durable knowledge.
const BELIEF   = /^(never|always|from now on|don'?t|do not|only|make sure|remember (?:to|that)|keep in mind|by default)\b/i
// A standing rule stated mid-sentence ("we don't discount this product", "we never run price ads").
const WE_RULE  = /\bwe (?:never|always|only|don'?t|do not|avoid|refuse|won'?t|stopped)\b/i
const DECISION = /\b(we(?:'| a)?(?:ve)? decided|we're (?:going|planning) to|we will|we won'?t|we chose|going forward|we've decided|let'?s (?:stop|start|switch|move)|we want to (?:position|target|focus|move|switch)|we're (?:launching|stopping|killing|pausing|switching|dropping))\b/i
const LEARNING = /\b(we learned|turns out|what worked|worked (?:better|best)|outperform(?:s|ed)?|best[- ]performing|beats?\b.*\b(by|than)|didn'?t work|failed|our winner)\b/i
const PREFERENCE = /\b((our|my) (?:brand|positioning|audience|customers?|voice|tone|niche|market|goal|focus) (?:is|are)|i (?:prefer|like|want|hate|don'?t like)|we (?:prefer|value|care about|focus on|target))\b/i
const PLAN = /\b(we'?re launching|launching (?:in|on|next)|going live|we plan to|our plan is|shipping (?:in|on|next))\b/i

const DURABLE = [BELIEF, WE_RULE, DECISION, LEARNING, PREFERENCE, PLAN]

/** True only for statements that assert durable company knowledge. */
export function shouldRemember(message: string): boolean {
  const q = String(message || '').trim()
  if (q.length < 12) return false
  if (q.includes('?')) return false          // a question is a lookup, not a fact to store
  if (isProductHelp(q)) return false         // "how do I…" is never company knowledge
  if (isAdsQuestion(q)) return false         // metric lookups are live data, not memory
  return DURABLE.some((re) => re.test(q))
}
