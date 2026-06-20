/**
 * Minimal 5-field cron evaluator (min hour dom month dow) — enough for the
 * automation templates (daily/weekly) and simple custom schedules. Supports:
 *   *  number  a,b,c  a-b  *​/n  (and combinations)
 * dow: 0-7 (0 and 7 = Sunday). Times are evaluated in UTC.
 */
function parseField(field: string, min: number, max: number): Set<number> {
  const out = new Set<number>()
  for (const part of field.split(',')) {
    const [rangePart, stepPart] = part.split('/')
    const step = stepPart ? parseInt(stepPart, 10) : 1
    let lo = min, hi = max
    if (rangePart !== '*') {
      const r = rangePart.split('-')
      lo = parseInt(r[0], 10)
      hi = r[1] !== undefined ? parseInt(r[1], 10) : lo
    }
    if (Number.isNaN(lo) || Number.isNaN(hi)) continue
    for (let v = lo; v <= hi; v += step) out.add(v)
  }
  return out
}

function matches(cron: string, d: Date): boolean {
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return false
  const [m, h, dom, mon, dow] = parts
  const mins = parseField(m, 0, 59)
  const hrs = parseField(h, 0, 23)
  const doms = parseField(dom, 1, 31)
  const mons = parseField(mon, 1, 12)
  const dows = parseField(dow, 0, 7)

  const wd = d.getUTCDay() // 0-6, Sun=0
  const dowMatch = dows.has(wd) || (wd === 0 && dows.has(7))
  // Standard cron: when both dom and dow are restricted, either matching counts.
  const domRestricted = dom !== '*'
  const dowRestricted = dow !== '*'
  let dayMatch: boolean
  if (domRestricted && dowRestricted) dayMatch = doms.has(d.getUTCDate()) || dowMatch
  else dayMatch = (dom === '*' || doms.has(d.getUTCDate())) && (dow === '*' || dowMatch)

  return mins.has(d.getUTCMinutes()) && hrs.has(d.getUTCHours()) && (mon === '*' || mons.has(d.getUTCMonth() + 1)) && dayMatch
}

/** Next time (UTC) the cron fires strictly after `from`. Returns null if none within ~1yr. */
export function nextRun(cron: string, from: Date = new Date()): Date | null {
  const d = new Date(from)
  d.setUTCSeconds(0, 0)
  d.setUTCMinutes(d.getUTCMinutes() + 1) // strictly after
  const limit = 366 * 24 * 60 // a year of minutes
  for (let i = 0; i < limit; i++) {
    if (matches(cron, d)) return new Date(d)
    d.setUTCMinutes(d.getUTCMinutes() + 1)
  }
  return null
}

export function cronMatches(cron: string, d: Date): boolean {
  return matches(cron, d)
}
