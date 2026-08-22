import { diagnose, biggestLever, type AccountMetrics } from '../src/lib/meta/diagnose'

function assert(cond: boolean, msg: string) { if (!cond) { console.error('FAIL:', msg); process.exit(1) } }
const get = (d: ReturnType<typeof diagnose>, k: string) => d.find((x) => x.key === k)!

// Healthy top-of-funnel but low AOV + low ROAS → biggest lever = AOV
const aovCase: AccountMetrics = { spend: 5000, currency: 'USD', cpm: 12, ctr: 0.02, cvr: 0.04, aov: 35, roas: 1.2, frequency: 1.5, activeCreatives: 20 }
const d1 = diagnose(aovCase)
assert(get(d1, 'roas').verdict === 'bad', 'roas 1.2 → bad')
assert(get(d1, 'ctr').verdict === 'good', 'ctr 2% → good')
assert(get(d1, 'cpm').verdict === 'good', 'cpm $12 → good')
assert(get(d1, 'aov').verdict === 'warn', 'aov $35 → warn')
assert(biggestLever(aovCase, d1).headline.includes('order value'), 'combo → AOV lever: ' + biggestLever(aovCase, d1).headline)

// Good clicks + cheap reach but low CVR → biggest lever = website
const siteCase: AccountMetrics = { spend: 5000, currency: 'USD', cpm: 15, ctr: 0.02, cvr: 0.006, aov: 70, roas: 1.3, frequency: 1.8, activeCreatives: 16 }
const d2 = diagnose(siteCase)
assert(get(d2, 'cvr').verdict === 'bad', 'cvr 0.6% → bad')
assert(biggestLever(siteCase, d2).headline.includes('website'), 'combo → website lever: ' + biggestLever(siteCase, d2).headline)

// High CPM + low CTR + few creatives → bads flagged
const badCase: AccountMetrics = { spend: 3000, currency: 'USD', cpm: 62, ctr: 0.005, cvr: 0.02, aov: 50, roas: 1.9, frequency: 4.2, activeCreatives: 4 }
const d3 = diagnose(badCase)
assert(get(d3, 'cpm').verdict === 'bad', 'cpm $62 → bad')
assert(get(d3, 'ctr').verdict === 'bad', 'ctr 0.5% → bad')
assert(get(d3, 'frequency').verdict === 'bad', 'freq 4.2 → bad')
assert(get(d3, 'creatives').verdict === 'bad', '4 creatives → bad')

// Null metrics → unknown, not diagnosed as bad
const emptyCase: AccountMetrics = { spend: 0, currency: 'USD', cpm: null, ctr: null, cvr: null, aov: null, roas: null, frequency: null, activeCreatives: null }
const d4 = diagnose(emptyCase)
assert(d4.every((x) => x.verdict === 'unknown'), 'all null → unknown')

// Healthy account → no bad, biggest lever = healthy
const healthy: AccountMetrics = { spend: 5000, currency: 'USD', cpm: 18, ctr: 0.02, cvr: 0.03, aov: 80, roas: 3.2, frequency: 1.6, activeCreatives: 20 }
const d5 = diagnose(healthy)
assert(!d5.some((x) => x.verdict === 'bad'), 'healthy → no bad')
assert(biggestLever(healthy, d5).headline.includes('healthy'), 'healthy lever')

// Value formatting
assert(get(d5, 'cpm').value === '$18', 'cpm formatted: ' + get(d5, 'cpm').value)
assert(get(d5, 'roas').value === '3.20x', 'roas formatted: ' + get(d5, 'roas').value)
assert(get(d1, 'ctr').value === '2.0%', 'ctr formatted: ' + get(d1, 'ctr').value)

console.log('PASS diagnose-tests')
