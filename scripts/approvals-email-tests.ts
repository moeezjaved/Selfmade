import { buildApprovalsDigest } from '../src/lib/channels/approvals-email'

function assert(cond: boolean, msg: string) { if (!cond) { console.error('FAIL:', msg); process.exit(1) } }

// no tasks → null (nothing to send)
assert(buildApprovalsDigest([]) === null, 'empty → null')

// 6 tasks → subject counts + all titles + CTA to /brief + impact shown
const tasks = [
  { title: 'Pause "Cold Traffic — Broad"', why: '0.42x ROAS. Every day it runs, money leaks.', evidence: { impact: 'saves ~$1,200/mo' } },
  { title: 'Scale "Retarget — 7d"', why: '3.1x ROAS, room to grow.', evidence: { impact: '+$800/mo' } },
  { title: 'Target them', why: 'Your winner is leaving lookalikes untapped.', evidence: {} },
  { title: 'Review placements', why: 'Reels is eating budget with no sales.', evidence: {} },
  { title: 'Pause "Prospecting v2"', why: 'Below break-even 9 days straight.', evidence: { impact: 'saves ~$400/mo' } },
  { title: 'Scale "UGC Story"', why: 'Best CTR in the account.', evidence: {} },
]
const d = buildApprovalsDigest(tasks)!
assert(d !== null, 'tasks → digest')
assert(d.subject === '6 actions are waiting for your approval', 'subject counts 6: ' + d.subject)
assert(tasks.every((t) => d.html.includes(t.title.replace(/"/g, '&quot;'))), 'all task titles present (html-escaped)')
assert(d.html.includes('Review approvals'), 'CTA text present')
assert(/\/brief/.test(d.html), 'links to /brief')
assert(d.html.includes('saves ~$1,200/mo'), 'impact line shown')

// singular grammar
const one = buildApprovalsDigest([{ title: 'Pause X', why: null, evidence: null }])!
assert(one.subject === '1 action is waiting for your approval', 'singular grammar: ' + one.subject)

// XSS-safety: a malicious title is escaped, not raw
const xss = buildApprovalsDigest([{ title: '<script>alert(1)</script>', why: null, evidence: null }])!
assert(!xss.html.includes('<script>alert(1)</script>'), 'title is escaped')

console.log('PASS approvals-email-tests')
