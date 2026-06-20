/**
 * Mello's tools — OpenAI function-calling schemas + executor.
 *
 * `request_clarification` is special: it is NOT executed as a data fetch. When the
 * model calls it, the agent loop emits a `widget` SSE event and ends the turn; the
 * user's selection comes back as the next chat message. This avoids cross-request
 * blocking (serverless-friendly) while preserving the inline-picker UX.
 */
import { listAdAccounts, getAccountInfo, getAdPerformance, searchAdLibrary } from './meta-data'

export const TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'get_current_date',
      description: "Get today's date. Call this before any month-to-date or relative date reasoning.",
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_ad_accounts',
      description: 'List the ad accounts this user has connected. Use to discover what account to analyze.',
      parameters: {
        type: 'object',
        properties: {
          platform: { type: 'string', enum: ['meta', 'all'], description: 'Filter by platform' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_account_info',
      description: 'Get metadata about an ad account — name, currency, account id. Call before pulling performance so you report the right currency.',
      parameters: {
        type: 'object',
        properties: {
          account_id: { type: 'string', description: 'act_xxx id, or omit for the primary account' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_ad_performance',
      description: 'Pull LIVE ad-level performance from a connected Meta ad account (spend, impressions, CTR, CPC, CPM, ROAS, conversions). This is real data from the Meta Insights API.',
      parameters: {
        type: 'object',
        properties: {
          account_id: { type: 'string', description: 'act_xxx id, or omit for the primary account' },
          date_preset: { type: 'string', enum: ['today', 'yesterday', 'last_7d', 'last_30d', 'last_90d', 'this_month', 'last_month', 'maximum'], description: 'Relative window. Use this_month for month-to-date.' },
          date_start: { type: 'string', description: 'YYYY-MM-DD (overrides date_preset, requires date_end)' },
          date_end: { type: 'string', description: 'YYYY-MM-DD' },
          level: { type: 'string', enum: ['ad', 'adset', 'campaign'], description: 'Aggregation level, default ad' },
          limit: { type: 'integer', description: 'Max rows (default 20, max 50)' },
          sort_by: { type: 'string', description: 'Metric to sort by, default spend' },
          sort_order: { type: 'string', enum: ['desc', 'asc'] },
          status: { type: 'string', enum: ['ACTIVE', 'ALL'], description: 'Restrict to active ads' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_ad_library',
      description: "Search Selfmade's own ad-intelligence library (millions of crawled competitor/inspiration ads) for examples, trends, and patterns. Use for inspiration, competitor, and creative questions.",
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Brand, keyword, or theme to search' },
          niche: { type: 'string', description: 'Niche filter, e.g. "Hair", "Supplements"' },
          format: { type: 'string', enum: ['image', 'video', 'carousel'] },
          min_days_active: { type: 'integer', description: 'Only long-running (proven) ads' },
          limit: { type: 'integer', description: 'Max results (default 10, max 24)' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'request_clarification',
      description: 'Ask the user to choose from options before continuing — e.g. which ad account to analyze, or which date range. Renders an inline picker. Use when you genuinely need the user to decide.',
      parameters: {
        type: 'object',
        required: ['question', 'options'],
        properties: {
          question: { type: 'string' },
          widget_type: { type: 'string', enum: ['radio_select', 'confirm'], description: 'default radio_select' },
          options: {
            type: 'array',
            items: {
              type: 'object',
              required: ['label', 'value'],
              properties: {
                label: { type: 'string' },
                value: { type: 'string' },
                description: { type: 'string' },
                recommended: { type: 'boolean' },
              },
            },
          },
          allow_skip: { type: 'boolean', description: 'default true' },
        },
      },
    },
  },
]

// Human labels shown as the live "thinking" step in the UI.
export const TOOL_LABELS: Record<string, string> = {
  get_current_date: 'Checking the date…',
  get_ad_accounts: 'Checking your connected ad accounts…',
  get_account_info: 'Getting account info…',
  get_ad_performance: 'Loading live ad performance…',
  search_ad_library: 'Searching the ad library…',
  request_clarification: 'Asking for clarification…',
}

export interface ToolCtx { userId: string }

export async function executeTool(name: string, args: any, ctx: ToolCtx): Promise<any> {
  switch (name) {
    case 'get_current_date': {
      const now = new Date()
      return {
        today: now.toISOString().slice(0, 10),
        iso: now.toISOString(),
        weekday: now.toLocaleDateString('en-US', { weekday: 'long' }),
        month: now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
      }
    }
    case 'get_ad_accounts':
      return { accounts: await listAdAccounts(ctx.userId) }
    case 'get_account_info':
      return await getAccountInfo(ctx.userId, args.account_id)
    case 'get_ad_performance':
      return await getAdPerformance(ctx.userId, args)
    case 'search_ad_library':
      return await searchAdLibrary(args)
    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

/** Build the `tool_result` SSE payload — a checkmark + optional sub-item in the UI. */
export function formatToolResult(name: string, result: any): { sub_item?: any; icon?: string } {
  if (name === 'get_ad_accounts') {
    const n = result?.accounts?.length || 0
    const primary = result?.accounts?.find((a: any) => a.is_primary)
    return { icon: 'meta', sub_item: { label: primary ? primary.name : `${n} account(s)`, count: n } }
  }
  if (name === 'get_account_info') {
    return { icon: 'meta', sub_item: { label: `${result?.name} · ${result?.currency}` } }
  }
  if (name === 'get_ad_performance') {
    return { icon: 'chart', sub_item: { label: `Loaded ${result?.count ?? 0} ${result?.level || 'ad'}(s)` } }
  }
  if (name === 'search_ad_library') {
    return { icon: 'search', sub_item: { label: `Found ${result?.count ?? 0} reference ad(s)` } }
  }
  return {}
}
