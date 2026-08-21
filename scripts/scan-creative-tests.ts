import { creativeBriefs, videoShotList } from '../src/lib/dna/creative'
import type { FullDnaResult } from '../src/lib/dna/engine'

function assert(cond: boolean, msg: string) { if (!cond) { console.error('FAIL:', msg); process.exit(1) } }

const withRx = {
  gaps: [], winners: { dist: {}, media: [], sampleSize: 0, winnerCount: 0, examples: [] },
  own: {} as any, score: {} as any, cached: false,
  report: { findings: [], prescriptions: [
    { title: 'Founder POV', hook: 'I made this because…', angle: 'origin story', persona: 'skeptical first-timer', offer: '20% off', format: 'Video', rationale: 'rivals all run founder video' },
  ] },
} as unknown as FullDnaResult
const b1 = creativeBriefs(withRx, 'Füm', 'Health & Wellness', 2)
assert(b1.length === 1, 'one prescription → one brief')
assert(b1[0].hook.includes('I made this'), 'brief carries the hook')
assert(b1[0].prompt.toLowerCase().includes('füm'), 'prompt names the brand')
assert(!!b1[0].key, 'brief has a stable key')

const withGaps = {
  gaps: [{ dimension: 'Format', label: 'Video', winnerPct: 80, yourPct: 0, kind: 'missing' }],
  winners: { dist: {}, media: [], sampleSize: 10, winnerCount: 5, examples: [] },
  own: {} as any, score: {} as any, cached: false,
  report: { findings: [], prescriptions: [] },
} as unknown as FullDnaResult
const b2 = creativeBriefs(withGaps, 'Füm', null, 2)
assert(b2.length >= 1, 'gaps fallback yields at least one brief')
assert(b2[0].gapLabel === 'Video', 'brief targets the missing gap')

console.log('PASS scan-creative-tests')

const script = videoShotList(b1[0], 'Füm', 'Health & Wellness')
assert(script.beats.length >= 5, 'shot list has >=5 beats')
assert(script.beats.every(x => /\d:\d\d/.test(x.t)), 'every beat has a timestamp')
assert(script.beats.some(x => (x.onScreen + x.vo).toLowerCase().includes('füm')), 'product appears in the script')
assert(script.totalSeconds > 0 && script.totalSeconds <= 30, 'total <= 30s')
console.log('PASS videoShotList')
