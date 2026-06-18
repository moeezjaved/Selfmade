// ============================================================
// M4 METHOD — GRADING CONFIG
// Update this file to change how campaigns are graded,
// what KPIs are shown, and what recommendations are generated.
// ============================================================

export const M4_CONFIG = {

  // ── GRADING THRESHOLDS ──────────────────────────────────────
  // These determine how campaigns are classified
  grading: {
    graduate: {
      // Campaign must be X% above account average ROAS
      roas_above_avg_pct: 1.3,      // 30% above average
      // Campaign must have spent at least X% of avg campaign spend
      min_spend_pct: 0.3,            // 30% of average
      // Must have at least 1 conversion
      min_conversions: 1,
    },
    catchy_not_converting: {
      // CTR is X times above average BUT ROAS is below threshold
      ctr_above_avg_multiplier: 1.5,
      // OR spend is X times above average
      spend_above_avg_multiplier: 1.2,
      // AND ROAS is below X% of account average
      roas_below_avg_pct: 0.7,
    },
    pause_poor: {
      // Spend is below X% of account average
      spend_below_avg_pct: 0.3,
      // AND ROAS is below X% of account average
      roas_below_avg_pct: 0.7,
    },
    // Everything else = HOLD
  },

  // ── KPIs TO SHOW IN REPORTS ────────────────────────────────
  kpis: {
    primary: ['spend', 'roas', 'cpa', 'ctr', 'conversions'],
    secondary: ['impressions', 'clicks', 'cpm', 'cpc', 'reach'],
    // Format: currency | percentage | number | multiplier
    formats: {
      spend: 'currency',
      roas: 'multiplier',
      cpa: 'currency',
      ctr: 'percentage',
      conversions: 'number',
      impressions: 'number',
      clicks: 'number',
      cpm: 'currency',
      cpc: 'currency',
      reach: 'number',
    }
  },

  // ── MINIMUM DATA REQUIREMENTS ───────────────────────────────
  // Don't grade campaigns without enough data
  minimums: {
    // Minimum days running before grading
    min_days: 7,
    // Minimum spend before grading (in account currency)
    min_spend: 10,
  },

  // ── SORT ORDER FOR GRADES ───────────────────────────────────
  sort_order: {
    GRADUATE: 0,
    CATCHY_NOT_CONVERTING: 1,
    PAUSE_POOR: 2,
    HOLD: 3,
  },

  // ── GRADE DISPLAY CONFIG ────────────────────────────────────
  grades: {
    GRADUATE: {
      emoji: '⭐',
      label: 'Graduate — Winner',
      color: '#86efac',
      bg: 'rgba(134,239,172,0.08)',
      border: 'rgba(134,239,172,0.25)',
      action_label: '⭐ Duplicate to Scale',
      confidence: 90,
      db_type: 'SCALE',
    },
    HOLD: {
      emoji: '🟡',
      label: 'Hold — Leave Running',
      color: '#fbbf24',
      bg: 'rgba(251,191,36,0.08)',
      border: 'rgba(251,191,36,0.2)',
      action_label: '🟡 Keep Running',
      confidence: 70,
      db_type: 'BUDGET_REALLOCATION',
    },
    CATCHY_NOT_CONVERTING: {
      emoji: '🪤',
      label: 'Catchy — Not Converting',
      color: '#f87171',
      bg: 'rgba(248,113,113,0.08)',
      border: 'rgba(248,113,113,0.2)',
      action_label: '⏸ Pause This Ad',
      confidence: 85,
      db_type: 'PAUSE',
    },
    PAUSE_POOR: {
      emoji: '❌',
      label: 'Poor Performer — Pause',
      color: '#f87171',
      bg: 'rgba(248,113,113,0.06)',
      border: 'rgba(248,113,113,0.15)',
      action_label: '⏸ Pause This Ad',
      confidence: 85,
      db_type: 'PAUSE',
    },
  },

  // ── ACCOUNT HEALTH SCORE ────────────────────────────────────
  // How to calculate the overall account health score (0-100)
  health_score: {
    // Weight each metric contributes to health score
    weights: {
      roas: 40,         // 40% of score
      ctr: 20,          // 20% of score
      cpa: 20,          // 20% of score
      spend_efficiency: 20,  // 20% of score
    },
    // Target benchmarks (score is relative to these)
    targets: {
      roas: 3.0,        // Target ROAS
      ctr: 2.0,         // Target CTR %
      cpa: 20,          // Target CPA (in account currency)
    }
  },

  // ── PHASE DEFINITIONS ───────────────────────────────────────
  phases: {
    phase1: {
      name: 'Foundational Campaign Structure',
      description: 'Set up broad and interest prospecting campaigns with proper exclusions',
    },
    phase2: {
      name: 'Creative Flywheel',
      description: 'Graduate winners to scale, replace losers with fresh creatives',
    },
    phase3: {
      name: 'Fastest Horse (Deep Dives)',
      description: 'Double down on proven winners, kill everything else',
    },
  },
}

// ── HELPER: Grade a single campaign ─────────────────────────
export function gradeM4Campaign(campaign: {
  spend: number
  roas: number
  ctr: number
  conversions: number
  cpa: number
}, benchmarks: {
  avgRoas: number
  avgCtr: number
  avgSpend: number
}): keyof typeof M4_CONFIG.grades {
  const { spend, roas, ctr, conversions } = campaign
  const { avgRoas, avgCtr, avgSpend } = benchmarks
  const g = M4_CONFIG.grading

  if (
    roas > avgRoas * g.graduate.roas_above_avg_pct &&
    spend > avgSpend * g.graduate.min_spend_pct &&
    conversions >= g.graduate.min_conversions
  ) return 'GRADUATE'

  if (
    (ctr > avgCtr * g.catchy_not_converting.ctr_above_avg_multiplier ||
     spend > avgSpend * g.catchy_not_converting.spend_above_avg_multiplier) &&
    roas < avgRoas * g.catchy_not_converting.roas_below_avg_pct
  ) return 'CATCHY_NOT_CONVERTING'

  if (
    spend < avgSpend * g.pause_poor.spend_below_avg_pct &&
    roas < avgRoas * g.pause_poor.roas_below_avg_pct
  ) return 'PAUSE_POOR'

  return 'HOLD'
}
