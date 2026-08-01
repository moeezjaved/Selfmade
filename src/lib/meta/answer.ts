/**
 * The grounded router (Phase 1 of the ads-employee design, docs/design-mello-ads-employee.md).
 *
 * When a user asks Mello an ad-performance question ("how do I improve my ads", "what should I
 * scale / pause", "how's my account"), we do NOT route through the open tool-loop that hangs. We read
 * the audit we already compute (auditAccount → live grade of the primary account) and answer in one
 * grounded sentence, pointing at the one-click Scale/Pause actions that already exist in the brief.
 *
 * Returns { reply } when it handled an ads question, or null when the message isn't one (caller then
 * falls through to its normal path). Fast, deterministic, never hangs — the whole point.
 */
import { auditAccount } from '@/lib/meta/audit'

// Intent: the message must mention ads/campaigns/spend/ROAS AND ask/act (improve, scale, pause, how, what).
const ADS_NOUN = /\b(ads?|campaigns?|roas|spend(?:ing)?|budget|meta ads?|facebook ads?|ad account|ad performance)\b/i
const ADS_VERB = /\b(improve|fix|optimi[sz]e|scale|pause|kill|cut|stop|help|grow|lower|reduce|what should i do|what do i (?:need to )?do|how (?:are|is|'?s|do|should)|which|worst|best|winning|losing|bleeding|wasting)\b/i
const MY_ADS = /\bmy (?:ads?|campaigns?|roas|ad account|account|spend|performance)\b/i

export function isAdsQuestion(message: string): boolean {
  const q = String(message || '')
  if (MY_ADS.test(q)) return true
  return ADS_NOUN.test(q) && ADS_VERB.test(q)
}

export async function answerAdsQuestion(admin: any, userId: string, message: string): Promise<{ reply: string } | null> {
  if (!isAdsQuestion(message)) return null

  let a: any = null
  try { a = await auditAccount(admin, userId, undefined, 'last_30d') } catch { /* fall through to a safe reply */ }

  if (!a) {
    return { reply: `You don't have a Meta ad account connected yet — connect one from Settings and I'll audit it every morning and tell you exactly what to scale and pause.` }
  }

  const money = (n: number) => { try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: a.currency || 'USD', maximumFractionDigits: 0 }).format(n || 0) } catch { return `${Math.round(n || 0).toLocaleString()}` } }
  const acct = a.accountName || 'your account'

  if (!a.total) {
    return { reply: `I checked ${acct} — no active campaigns with spend in the last 30 days, so there's nothing to tune yet. Launch one and I'll start grading it and flag what to scale or cut.` }
  }

  const scale = a.scale?.[0], pause = a.pause?.[0], watch = a.watch?.[0]
  let reply = `Across your ${a.total} campaign${a.total === 1 ? '' : 's'} you're at ${a.avgRoas}x on ${money(a.spend)} spend over 30 days (${money(a.spendToday)} today). `
  const moves: string[] = []
  if (scale) moves.push(`scale “${scale.name}” — your winner at ${scale.roas}x`)
  if (pause) moves.push(`pause “${pause.name}” — ${money(pause.spend)} for ${pause.conversions} sale${pause.conversions === 1 ? '' : 's'}, it's bleeding`)
  if (watch && !scale) moves.push(`keep an eye on “${watch.name}” — catchy but not converting yet`)

  if (moves.length) {
    reply += `Your move${moves.length === 1 ? '' : 's'}: ${moves.join('; ')}. `
    reply += `Those are one-click in your Morning Brief — say yes and I'll make the change.`
  } else {
    reply += `Everything's steady — no campaign needs a move today. I'll flag it the moment one does.`
  }
  return { reply }
}
