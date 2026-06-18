import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format, formatDistanceToNow, parseISO } from 'date-fns'

// ── Tailwind class merge ──────────────────────────────────────
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ── Number formatters ─────────────────────────────────────────
export function formatCurrency(amount: number, currency: string = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount)
}

export function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`
  return n.toString()
}

export function formatPercent(n: number, decimals: number = 1): string {
  return `${n.toFixed(decimals)}%`
}

export function formatROAS(roas: number): string {
  return `${roas.toFixed(1)}×`
}

export function formatCPA(cpa: number): string {
  return formatCurrency(cpa)
}

// ── Date formatters ───────────────────────────────────────────
export function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? parseISO(date) : date
  return format(d, 'MMM d, yyyy')
}

export function formatDateTime(date: string | Date): string {
  const d = typeof date === 'string' ? parseISO(date) : date
  return format(d, 'MMM d, yyyy · h:mm a')
}

export function timeAgo(date: string | Date): string {
  const d = typeof date === 'string' ? parseISO(date) : date
  return formatDistanceToNow(d, { addSuffix: true })
}

export function toISODate(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}

// ── Meta API helpers ──────────────────────────────────────────
export function formatAccountId(id: string): string {
  return id.startsWith('act_') ? id : `act_${id}`
}

export function stripActPrefix(id: string): string {
  return id.replace('act_', '')
}

// Meta API uses cents for budget
export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100)
}

export function centsToDollars(cents: number): number {
  return cents / 100
}

// ── Status helpers ─────────────────────────────────────────────
export function getCampaignStatusColor(status: string): string {
  switch (status) {
    case 'ACTIVE':   return 'text-status-green'
    case 'PAUSED':   return 'text-status-amber'
    case 'DELETED':  return 'text-status-red'
    default:         return 'text-white/40'
  }
}

export function getHealthColor(score: number): string {
  if (score >= 80) return 'text-status-green'
  if (score >= 60) return 'text-status-amber'
  return 'text-status-red'
}

export function getROASColor(roas: number, target: number = 2): string {
  if (roas >= target * 1.5) return 'text-status-green'
  if (roas >= target)       return 'text-status-amber'
  return 'text-status-red'
}

// ── Validation ────────────────────────────────────────────────
export function isValidUrl(url: string): boolean {
  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

// ── Error handling ─────────────────────────────────────────────
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'An unexpected error occurred'
}

// ── Debounce ──────────────────────────────────────────────────
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timer: NodeJS.Timeout
  return (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), delay)
  }
}

// ── Sleep (for mock delays in dev) ────────────────────────────
export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// ── Budget estimates ───────────────────────────────────────────
export function estimateReach(dailyBudget: number): { low: string; high: string } {
  const low  = Math.round(dailyBudget * 100)
  const high = Math.round(dailyBudget * 280)
  return {
    low: formatNumber(low),
    high: formatNumber(high),
  }
}

export function estimateConversions(dailyBudget: number, estimatedCPA: number = 20): {
  low: number
  high: number
} {
  return {
    low: Math.max(1, Math.floor(dailyBudget / (estimatedCPA * 1.5))),
    high: Math.ceil(dailyBudget / (estimatedCPA * 0.7)),
  }
}

// ── Platform detection (from SKILL.md) ────────────────────────
export function detectBusinessType(niche: string): {
  type: string
  recommendedPlatforms: string[]
  primaryObjective: string
} {
  const n = niche.toLowerCase()
  if (n.includes('saas') || n.includes('software') || n.includes('app')) {
    return {
      type: 'SaaS/Software',
      recommendedPlatforms: ['Meta', 'Google Ads', 'LinkedIn'],
      primaryObjective: 'OUTCOME_LEADS',
    }
  }
  if (n.includes('ecommerce') || n.includes('shop') || n.includes('store')) {
    return {
      type: 'E-Commerce',
      recommendedPlatforms: ['Meta', 'Google Shopping', 'TikTok'],
      primaryObjective: 'OUTCOME_SALES',
    }
  }
  if (n.includes('lead') || n.includes('real estate') || n.includes('insurance')) {
    return {
      type: 'Lead Generation',
      recommendedPlatforms: ['Meta', 'Google Ads'],
      primaryObjective: 'OUTCOME_LEADS',
    }
  }
  return {
    type: 'Service Business',
    recommendedPlatforms: ['Meta', 'Google Ads'],
    primaryObjective: 'OUTCOME_LEADS',
  }
}
