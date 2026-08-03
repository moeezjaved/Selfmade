/**
 * The company org — V3.0. The single source of truth for who works here.
 *
 * This is the SHELL of the "company of AI employees": the coordinator (Mello), the departments, what
 * each owns (the 116 behaviors, mapped + marked built/planned), the integration that lights it up, and
 * the task kinds it runs. Everything above this — the company home screen, the coordinator routing,
 * scorecards, the disagreement engine — reads from this file. Departments are known by FUNCTION (no cute
 * names); the personality lives in Mello alone (v3 design decision).
 *
 * `live` = built enough to actually do work today. Non-live departments still appear on the org chart
 * (as "hiring") and light up the moment their integration lands — Unipile → Customer, Shopify → Store,
 * Klaviyo → Growth.
 */

export type DeptKey = 'research' | 'creative' | 'media' | 'growth' | 'customer' | 'store' | 'finance'
export type Division = 'Marketing' | 'Operations'
export type DeptStatus = 'working' | 'finished' | 'waiting' | 'warning' | 'idle' | 'hiring'

export interface Responsibility { label: string; built: boolean }
export interface Department {
  key: DeptKey
  name: string          // functional label shown to the founder
  emoji: string         // the department's face in Slack/WhatsApp
  division: Division
  role: string          // one line: what it owns
  personality: string   // how Mello refers to it (Chief-of-Staff voice)
  live: boolean         // has real, shippable behaviors today
  unlockedBy?: string   // the integration that turns it on (for non-live)
  taskKinds: string[]   // mello_tasks kinds this department executes (for status + routing)
  responsibilities: Responsibility[]  // the 116, mapped to this department
  // how this department speaks (stays in character): Research FINDS, Creative BUILDS, Media LAUNCHES…
  verb: string
}

/** The Chief of Staff — the one the founder talks to; speaks for the whole company. Not a department. */
export const MELLO = {
  name: 'Mello',
  role: 'Chief of Staff',
  personality: 'Calm, decisive, protective of your time. Manages the team, decides what reaches you, and speaks for everyone.',
}

export const DEPARTMENTS: Department[] = [
  {
    key: 'research', name: 'Research', emoji: '🔍', verb: 'found', division: 'Marketing',
    role: 'Watches competitors, trends, and the market so you never get blindsided.',
    personality: 'Endlessly curious, never blinks.',
    live: true, taskKinds: ['research'],
    responsibilities: [
      { label: 'Competitor launches & scaling alerts', built: true },
      { label: 'Competitor intel report', built: true },
      { label: 'New-entrant detection', built: true },
      { label: 'Rival offer/price-change watch', built: true },
      { label: 'Trend & seasonality signals', built: false },
      { label: 'Press/opportunity monitoring', built: false },
      { label: 'Product-gap research', built: false },
    ],
  },
  {
    key: 'creative', name: 'Creative', emoji: '🎨', verb: 'built', division: 'Marketing',
    role: 'Makes the ads, kills the ugly ones before you see them.',
    personality: 'The tasteful one.',
    live: true, taskKinds: ['creative', 'video'],
    responsibilities: [
      { label: 'Nightly creative batch', built: true },
      { label: 'Clone a competitor winner', built: true },
      { label: 'Variants of a winning ad', built: true },
      { label: 'Video / storyboard build', built: true },
      { label: 'Localization & transcreation', built: true },
      { label: 'Fatigue refresh', built: true },
      { label: 'Hook transplant / recombination', built: false },
      { label: 'Seasonal reskin', built: false },
    ],
  },
  {
    key: 'media', name: 'Media Buying', emoji: '📈', verb: 'wants to launch', division: 'Marketing',
    role: 'Runs the ad accounts — scales winners, kills bleeders, launches.',
    personality: 'Numbers-cold, unsentimental.',
    live: true, taskKinds: ['meta_pause', 'meta_scale'],
    responsibilities: [
      { label: 'Scale a proven winner', built: true },
      { label: 'Kill a bleeding ad', built: true },
      { label: 'Launch new campaign (M4)', built: true },
      { label: 'Daily audit & grade', built: true },
      { label: 'Budget reduction on decay', built: false },
      { label: 'Audience / placement optimization', built: false },
      { label: 'Google & TikTok ads', built: false },
      { label: 'Cross-channel budget arbitrage', built: false },
    ],
  },
  {
    key: 'growth', name: 'Growth', emoji: '✉️', verb: 'sent', division: 'Marketing',
    role: 'Owned channels — email, SMS, organic, SEO — the quiet compounding revenue.',
    personality: 'Runs everything you already own.',
    live: false, unlockedBy: 'Klaviyo + publishing APIs', taskKinds: [],
    responsibilities: [
      { label: 'Email campaigns (Klaviyo)', built: false },
      { label: 'Flow fixes & win-backs', built: false },
      { label: 'SMS for the right moments', built: false },
      { label: 'Weekly organic calendar', built: false },
      { label: 'Founder LinkedIn ghostwriting', built: false },
      { label: 'SEO & blog generation', built: false },
    ],
  },
  {
    key: 'customer', name: 'Customer', emoji: '💬', verb: 'handled', division: 'Operations',
    role: 'Answers everyone, turns comments into sales, angry reviews into loyalty.',
    personality: 'Never sleeps on a DM.',
    live: false, unlockedBy: 'Unipile', taskKinds: [],
    responsibilities: [
      { label: 'Unified inbox (IG + WhatsApp + email)', built: false },
      { label: 'Comment → DM sales loop', built: false },
      { label: 'Review responses & rescue', built: false },
      { label: 'Support inbox zero', built: false },
      { label: 'Creator shortlist & outreach', built: false },
      { label: 'Affiliate invitations', built: false },
    ],
  },
  {
    key: 'store', name: 'Store', emoji: '🛍️', verb: 'flagged', division: 'Operations',
    role: 'Watches stock vs ad spend, guards margins, keeps the plumbing working.',
    personality: 'The operator.',
    live: false, unlockedBy: 'Shopify', taskKinds: [],
    responsibilities: [
      { label: 'Inventory vs ad velocity', built: false },
      { label: 'Out-of-stock → auto-pause ads', built: false },
      { label: 'Price / discount / bundle moves', built: false },
      { label: 'Checkout & site-speed watchdog', built: false },
      { label: 'Pixel & tracking health', built: false },
    ],
  },
  {
    key: 'finance', name: 'Finance', emoji: '💰', verb: 'reported', division: 'Operations',
    role: 'Tells you the one true number — real profit — and sees the cash crunch early.',
    personality: 'Tells you what’s actually true.',
    live: false, unlockedBy: 'Shopify + cost model', taskKinds: [],
    responsibilities: [
      { label: 'Weekly & monthly reports', built: true },
      { label: 'True daily profit', built: false },
      { label: 'Cashflow foresight', built: false },
      { label: 'Bookkeeping & subscription audit', built: false },
    ],
  },
]

export const DEPT_KEYS = DEPARTMENTS.map(d => d.key)
export function departmentByKey(k: string): Department | undefined { return DEPARTMENTS.find(d => d.key === k) }
export function departmentForTaskKind(kind: string): DeptKey {
  const d = DEPARTMENTS.find(x => x.taskKinds.includes(kind))
  return d?.key || 'media'
}
/** Progress: how many of a department's responsibilities are built (for the org chart's "leveling up"). */
export function deptProgress(d: Department): { built: number; total: number } {
  return { built: d.responsibilities.filter(r => r.built).length, total: d.responsibilities.length }
}
