'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatROAS, formatPercent, formatNumber, timeAgo, cn } from '@/lib/utils'
import type { Campaign, CampaignInsights, Recommendation } from '@/types'
import { RefreshCw, TrendingUp, TrendingDown, CheckCircle, XCircle, ChevronRight, Zap, Sparkles } from 'lucide-react'
import Link from 'next/link'
import AccountSelector from '@/components/AccountSelector'

interface DashboardData {
  campaigns: (Campaign & { insights: CampaignInsights[] })[]
  recommendations: Recommendation[]
  accountInsights: CampaignInsights | null
  lastSynced: string | null
}

export default function DashboardPage() {
  const router = useRouter()
  const supabase = createClient()

  const [data, setData] = useState<DashboardData>({
    campaigns: [],
    recommendations: [],
    accountInsights: null,
    lastSynced: null,
  })
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null)
  const [approving, setApproving] = useState<string | null>(null)
  const [currency, setCurrency] = useState<string>('USD')

  const loadData = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    // Get primary account
    const { data: primaryAccount } = await supabase
      .from('meta_accounts')
      .select('id,account_id,account_name,last_synced_at,currency')
      .eq('user_id', user.id)
      .eq('is_primary', true)
      .single()

    if (primaryAccount?.currency) setCurrency(primaryAccount.currency)

    // Fetch campaigns with insights filtered by primary account
    let campQuery = supabase
      .from('campaigns')
      .select('*, campaign_insights(*)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(10)

    if (primaryAccount) {
      campQuery = campQuery.eq('meta_account_id', primaryAccount.id)
    }

    const { data: campaigns } = await campQuery

    // Fetch pending recommendations
    const { data: recs } = await supabase
      .from('recommendations')
      .select('*, campaigns(name)')
      .eq('user_id', user.id)
      .eq('status', 'PENDING')
      .order('confidence_score', { ascending: false })
      .limit(5)

    // Use primary account for sync time
    const account = primaryAccount

    // Calculate aggregate insights
    const allInsights = (campaigns || []).flatMap((c: any) => c.campaign_insights || [])
    const aggregate = allInsights.reduce((acc: any, i: any) => ({
      spend: acc.spend + Number(i.spend || 0),
      conversions: acc.conversions + Number(i.conversions || 0),
      conversion_value: acc.conversion_value + Number(i.conversion_value || 0),
      clicks: acc.clicks + Number(i.clicks || 0),
      impressions: acc.impressions + Number(i.impressions || 0),
    }), { spend: 0, conversions: 0, conversion_value: 0, clicks: 0, impressions: 0 })

    const accountInsights: CampaignInsights | null = allInsights.length ? {
      campaign_id: 'aggregate',
      date_start: '',
      date_stop: '',
      ...aggregate,
      ctr: aggregate.clicks / (aggregate.impressions || 1) * 100,
      cpm: aggregate.spend / (aggregate.impressions || 1) * 1000,
      cpc: aggregate.spend / (aggregate.clicks || 1),
      roas: aggregate.conversion_value / (aggregate.spend || 1),
      cpa: aggregate.spend / (aggregate.conversions || 1),
      reach: 0,
    } : null

    setData({
      campaigns: (campaigns || []) as any,
      recommendations: (recs || []) as any,
      accountInsights,
      lastSynced: account?.last_synced_at || null,
    })
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const handleSync = async (accountId?: string) => {
    setSyncing(true)
    const toastId = toast.loading('Syncing your Meta account…')
    try {
      const res = await fetch('/api/meta/sync', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ account_id: accountId || null }) })
      if (res.ok) {
        toast.success('Sync complete!', { id: toastId })
        loadData()
      } else {
        toast.error('Sync failed', { id: toastId })
      }
    } finally {
      setSyncing(false)
    }
  }

  const handleApprove = async (recId: string) => {
    setApproving(recId)
    const toastId = toast.loading('Executing on Meta…')
    try {
      const res = await fetch('/api/recommendations/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recommendation_id: recId, action: 'approve' }),
      })
      if (res.ok) {
        toast.success('Action executed successfully!', { id: toastId })
        setData(prev => ({
          ...prev,
          recommendations: prev.recommendations.filter(r => r.id !== recId),
        }))
      } else {
        const err = await res.json()
        toast.error(err.error || 'Execution failed', { id: toastId })
      }
    } finally {
      setApproving(null)
    }
  }

  const handleReject = async (recId: string) => {
    await fetch('/api/recommendations/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recommendation_id: recId, action: 'reject' }),
    })
    toast.success('Recommendation dismissed')
    setData(prev => ({
      ...prev,
      recommendations: prev.recommendations.filter(r => r.id !== recId),
    }))
  }

  const kpis = [
    {
      label: 'Total Spend',
      value: formatCurrency(data.accountInsights?.spend || 0, currency),
      change: '+12%',
      up: true,
      featured: true,
    },
    {
      label: 'ROAS',
      value: formatROAS(data.accountInsights?.roas || 0),
      change: '+0.8×',
      up: true,
    },
    {
      label: 'CPA',
      value: formatCurrency(data.accountInsights?.cpa || 0, currency),
      change: '-$2.10',
      up: true,
    },
    {
      label: 'CTR',
      value: formatPercent(data.accountInsights?.ctr || 0),
      change: '-0.2%',
      up: false,
    },
    {
      label: 'Conversions',
      value: formatNumber(data.accountInsights?.conversions || 0),
      change: '+34',
      up: true,
    },
  ]

  if (loading) {
    return (
      <div className="p-8">
        {/* Topbar skeleton */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <div className="h-7 w-32 bg-dark3 rounded shimmer mb-2"/>
            <div className="h-4 w-48 bg-dark3 rounded shimmer"/>
          </div>
        </div>
        {/* KPI skeleton */}
        <div className="grid grid-cols-5 gap-4 mb-6">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-24 bg-dark2 rounded-2xl shimmer"/>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="p-8">

      {/* ── TOPBAR ── */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight">Dashboard</h1>
          <p className="text-sm text-white/40 mt-0.5">
            {data.lastSynced ? `Last synced ${timeAgo(data.lastSynced)}` : 'Not yet synced'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <AccountSelector onAccountChange={(accountId) => { handleSync(accountId).then(() => loadData()) }} />
          <div className="flex items-center gap-2 bg-green/10 border border-green/20 text-status-green text-xs font-bold px-3 py-2 rounded-lg">
            <span className="live-dot"/>
            Live
          </div>
          <button
            onClick={() => handleSync()}
            disabled={syncing}
            className="flex items-center gap-2 bg-lime text-dark text-sm font-bold px-4 py-2 rounded-lg transition-all hover:bg-lime2 disabled:opacity-50" id="sync-btn"
          >
            <RefreshCw size={14} className={syncing ? 'animate-spin' : ''}/>
            {syncing ? 'Syncing…' : 'Sync'}
          </button>
        </div>
      </div>

      {/* ── PROMO CARDS ── */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <Link href="/m4" className="flex items-center gap-4 bg-gradient-to-r from-dark2 to-dark3 border border-lime/30 rounded-2xl px-5 py-4 hover:border-lime/50 transition-all group">
          <div className="w-10 h-10 rounded-xl bg-lime flex items-center justify-center flex-shrink-0">
            <Zap size={20} className="text-dark"/>
          </div>
          <div className="flex-1">
            <div className="text-base font-bold text-white flex items-center gap-2">
              Ad Engine
              <span className="text-[10px] font-bold bg-lime text-dark px-2 py-0.5 rounded-full">New</span>
            </div>
            <div className="text-xs text-white/40">Run Facebook & Instagram ads in minutes with AI</div>
          </div>
          <ChevronRight size={16} className="text-white/30 group-hover:text-lime transition-colors"/>
        </Link>
        <Link href="/creative-studio" className="flex items-center gap-4 bg-dark2 border border-white/10 rounded-2xl px-5 py-4 hover:border-lime/30 transition-all group">
          <div className="w-10 h-10 rounded-xl bg-lime/10 border border-lime/20 flex items-center justify-center flex-shrink-0">
            <Sparkles size={20} className="text-lime"/>
          </div>
          <div className="flex-1">
            <div className="text-base font-bold text-white">Creative Studio</div>
            <div className="text-xs text-white/40">Generate variation briefs from your winning ads</div>
          </div>
          <ChevronRight size={16} className="text-white/30 group-hover:text-lime transition-colors"/>
        </Link>
      </div>

      {/* ── KPI CARDS ── */}
      <div className="grid grid-cols-5 gap-4 mb-6">
        {kpis.map(kpi => (
          <div
            key={kpi.label}
            className={cn(
              'rounded-2xl p-5 border relative overflow-hidden',
              kpi.featured
                ? 'bg-dark3 border-lime/25'
                : 'bg-dark2 border-white/10'
            )}
          >
            {kpi.featured && (
              <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-lime to-transparent"/>
            )}
            <div className="text-[11px] font-bold uppercase tracking-wider text-white/40 mb-2">
              {kpi.label}
            </div>
            <div className={cn(
              'text-3xl font-black tracking-tight leading-none',
              kpi.featured ? 'text-lime' : 'text-white'
            )}>
              {kpi.value}
            </div>
            <div className={cn(
              'flex items-center gap-1 mt-2 text-xs font-semibold',
              kpi.up ? 'text-status-green' : 'text-status-red'
            )}>
              {kpi.up ? <TrendingUp size={12}/> : <TrendingDown size={12}/>}
              {kpi.change}
            </div>
          </div>
        ))}
      </div>

      {/* ── MAIN GRID ── */}
      <div className="grid grid-cols-[1fr_300px] gap-5">

        {/* Left: Recommendations + Campaigns */}
        <div className="flex flex-col gap-5">

          {/* Recommendations */}
          <div className="card">
            <div className="flex items-center justify-between px-6 py-5 border-b border-white/10">
              <div className="text-lg font-black text-white">Scale & Insights — Winners</div>
              <div className="flex items-center gap-3">
          <AccountSelector onAccountChange={(accountId) => { handleSync(accountId).then(() => loadData()) }} />
                {data.recommendations.length > 0 && (
                  <span className="text-xs font-bold bg-lime text-dark px-2.5 py-0.5 rounded-full">
                    {data.recommendations.length} pending
                  </span>
                )}
                <Link href="/recommendations" className="text-sm text-white/40 hover:text-white font-semibold">
                  View Scale & Insights →
                </Link>
              </div>
            </div>

            {data.recommendations.length === 0 ? (
              <div className="px-6 py-10 text-center text-white/40 text-sm">
                No pending recommendations.{' '}
                <button onClick={() => handleSync()} className="text-lime font-semibold hover:underline">
                  Sync now
                </button>
                {' '}to analyse your account.
              </div>
            ) : (
              data.recommendations.map(rec => (
                <div key={rec.id} className="px-6 py-5 border-b border-white/10 last:border-none hover:bg-white/2 transition-colors">
                  <div className="flex items-start gap-4">
                    <div className={cn(
                      'inline-flex text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full mb-3 flex-shrink-0',
                      rec.type === 'PAUSE' && 'bg-red/10 text-status-red',
                      rec.type === 'SCALE' && 'bg-green/10 text-status-green',
                      rec.type === 'TEST_CREATIVE' && 'bg-blue/10 text-status-blue',
                      !['PAUSE','SCALE','TEST_CREATIVE'].includes(rec.type) && 'bg-amber/10 text-status-amber',
                    )}>
                      {rec.type === 'PAUSE' ? '⏸ Pause' :
                       rec.type === 'SCALE' ? '↑ Scale' :
                       rec.type === 'TEST_CREATIVE' ? '🧪 Test' : rec.type}
                    </div>
                  </div>

                  <div className="text-base font-bold text-white mb-2">{rec.title}</div>
                  <div className="bg-dark3 border-l-2 border-lime rounded-r-xl px-4 py-3 text-sm text-white/60 leading-relaxed mb-3">
                    <strong className="text-white font-bold">Why:</strong> {rec.reasoning}
                  </div>
                  <div className="text-xs text-white/40 mb-3">
                    Impact: <span className="text-lime font-semibold">{rec.impact_estimate}</span>
                    {' · '}Confidence: <span className="text-white font-semibold">{rec.confidence_score}%</span>
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => handleApprove(rec.id)}
                      disabled={approving === rec.id}
                      className="bg-lime text-dark text-sm font-bold px-4 py-2 rounded-full hover:bg-lime2 transition-all disabled:opacity-50"
                    >
                      {approving === rec.id ? '⏳ Executing…' : '✓ Approve'}
                    </button>
                    <button
                      onClick={() => handleReject(rec.id)}
                      className="text-white/40 text-sm font-semibold border border-white/10 px-4 py-2 rounded-full hover:border-white/20 hover:text-white transition-all"
                    >
                      ✕ Reject
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Campaigns table */}
          <div className="card">
            <div className="flex items-center justify-between px-6 py-5 border-b border-white/10">
              <div className="text-lg font-black text-white">Campaigns</div>
              <Link href="/campaigns" className="text-sm text-white/40 hover:text-white font-semibold">View Scale & Insights →</Link>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-dark3">
                    <th className="text-left px-6 py-3 text-[11px] font-bold uppercase tracking-wider text-white/30">Campaign</th>
                    <th className="text-left px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-white/30">Status</th>
                    <th className="text-left px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-white/30">Spend</th>
                    <th className="text-left px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-white/30">ROAS</th>
                    <th className="text-left px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-white/30">CPA</th>
                    <th className="text-left px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-white/30">CTR</th>
                  </tr>
                </thead>
                <tbody>
                  {data.campaigns.slice(0, 6).map((campaign: any) => {
                    const insights = campaign.campaign_insights?.[0]
                    return (
                      <tr key={campaign.id} className="border-t border-white/5 hover:bg-white/2 transition-colors">
                        <td className="px-6 py-4 text-sm font-bold text-white max-w-[200px] truncate">{campaign.name}</td>
                        <td className="px-4 py-4">
                          <span className={cn(
                            'text-xs font-bold px-2 py-0.5 rounded-full',
                            campaign.status === 'ACTIVE' ? 'pill-green' : 'pill-amber'
                          )}>
                            {campaign.status === 'ACTIVE' ? '● Active' : '⏸ Paused'}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-sm font-bold text-white">{formatCurrency(insights?.spend || 0)}</td>
                        <td className="px-4 py-4 text-sm font-bold text-status-green">{formatROAS(insights?.roas || 0)}</td>
                        <td className="px-4 py-4 text-sm font-bold text-white">{formatCurrency(insights?.cpa || 0)}</td>
                        <td className="px-4 py-4 text-sm font-bold text-white">{formatPercent(insights?.ctr || 0)}</td>
                      </tr>
                    )
                  })}
                  {data.campaigns.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-6 py-10 text-center text-sm text-white/30">
                        No campaigns yet.{' '}
                        <Link href="/ad-engine" className="text-lime font-semibold hover:underline">
                          Launch your first →
                        </Link>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Right: Account health + Activity */}
        <div className="flex flex-col gap-5">
          {/* Account health */}
          <div className="card">
            <div className="bg-dark3 px-6 py-6 text-center border-b border-white/10">
              <div
                className="w-28 h-28 rounded-full mx-auto mb-4 flex items-center justify-center relative"
                style={{
                  background: ``conic-gradient(var(--lime) 0% ${Math.min(100, Math.round((data.accountInsights?.roas || 0) / 4 * 100))}%, rgba(0,0,0,0.06) ${Math.min(100, Math.round((data.accountInsights?.roas || 0) / 4 * 100))}% 100%)``,
                }}
              >
                <div className="absolute inset-3 bg-dark3 rounded-full flex items-center justify-center">
                  <span className="text-2xl font-black text-lime">{Math.min(100, Math.round((data.accountInsights?.roas || 0) / 4 * 100))}</span>
                </div>
              </div>
              <div className="text-sm text-white/40 mb-2">Account Health Score</div>
              <div className="inline-flex items-center gap-2 bg-green/10 border border-green/20 text-status-green text-xs font-bold px-3 py-1 rounded-full">
                ● Good performance
              </div>
            </div>
            <div className="px-5 py-2">
              {[
                { label: 'Active campaigns', value: `${data.campaigns.filter((c: any) => c.status === 'ACTIVE').length} of ${data.campaigns.length}`, good: true },
                { label: 'Avg ROAS', value: formatROAS(data.accountInsights?.roas || 0), good: (data.accountInsights?.roas || 0) > 2 },
                { label: 'Pending actions', value: data.recommendations.length.toString(), good: data.recommendations.length === 0 },
              ].map(row => (
                <div key={row.label} className="flex items-center justify-between py-3 border-b border-white/5 last:border-none text-sm">
                  <span className="text-white/50">{row.label}</span>
                  <span className={cn('font-bold', row.good ? 'text-white' : 'text-status-amber')}>
                    {row.value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
