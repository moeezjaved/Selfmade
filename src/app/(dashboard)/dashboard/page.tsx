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
  const [winners, setWinners] = useState<any[]>([])
  const [liveCampaigns, setLiveCampaigns] = useState<any[]>([])

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

    // Fetch live campaigns from Meta API
    try {
      const campRes = await fetch('/api/campaigns/manage')
      const campData = await campRes.json()
      setLiveCampaigns(campData.campaigns || [])
    } catch(e) {}

    // Fetch winners from insights
    try {
      const insRes = await fetch('/api/insights/campaigns?dateRange=last_7d')
      const insData = await insRes.json()
      const w = (insData.campaigns || []).flatMap((c: any) =>
        (c.adsets || []).filter((a: any) => a.rec_type === 'scale').map((a: any) => ({
          ...a, campaignName: c.name,
        }))
      )
      setWinners(w)
    } catch(e) {}
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

  // Dynamic health score based on multiple factors
  const calcHealthScore = () => {
    const ins = data.accountInsights
    if (!ins || ins.spend === 0) return 0
    let score = 0
    // ROAS score (40 points) - good ROAS is 2x+
    const roasScore = Math.min(40, Math.round((ins.roas / 3) * 40))
    score += roasScore
    // CTR score (20 points) - good CTR is 2%+
    const ctrScore = Math.min(20, Math.round((ins.ctr / 2) * 20))
    score += ctrScore
    // Conversion rate score (20 points)
    const convRate = ins.clicks > 0 ? (ins.conversions / ins.clicks) * 100 : 0
    const convScore = Math.min(20, Math.round((convRate / 3) * 20))
    score += convScore
    // Spend activity score (20 points) - is account actively spending
    const spendScore = ins.spend > 100 ? 20 : Math.round((ins.spend / 100) * 20)
    score += spendScore
    return Math.min(100, Math.max(0, score))
  }
  const healthScore = calcHealthScore()
  const healthLabel = healthScore >= 80 ? 'Excellent' : healthScore >= 60 ? 'Good' : healthScore >= 40 ? 'Fair' : 'Needs work'
  const healthColor = healthScore >= 80 ? '#2d7a2d' : healthScore >= 60 ? '#b8860b' : healthScore >= 40 ? '#d97706' : '#c0392b'

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
          <h1 className="text-2xl font-black tracking-tight" style={{color:"#1a3a1a"}}>Dashboard</h1>
          <p className="text-sm mt-0.5" style={{color:"#8aaa8a"}}>
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
        <Link href="/insights" className="flex items-center gap-4 bg-gradient-to-r from-dark2 to-dark3 border border-lime/30 rounded-2xl px-5 py-4 hover:border-lime/50 transition-all group">
          <div className="w-10 h-10 rounded-xl bg-lime flex items-center justify-center flex-shrink-0">
            <TrendingUp size={20} className="text-dark"/>
          </div>
          <div className="flex-1">
            <div className="text-base font-bold flex items-center gap-2" style={{color:"#1a3a1a"}}>
              Scale & Insights
              <span className="text-[10px] font-bold bg-lime text-dark px-2 py-0.5 rounded-full">NEW</span>
            </div>
            <div className="text-xs" style={{color:"#8aaa8a"}}>Scale winners, pause losers, track ROAS live</div>
          </div>
          <ChevronRight size={16} className="transition-colors" style={{color:"#8aaa8a"}}/>
        </Link>
        <Link href="/reports" className="flex items-center gap-4 bg-dark2 border border-white/10 rounded-2xl px-5 py-4 hover:border-lime/30 transition-all group">
          <div className="w-10 h-10 rounded-xl bg-lime/10 border border-lime/20 flex items-center justify-center flex-shrink-0">
            <Sparkles size={20} className="text-lime"/>
          </div>
          <div className="flex-1">
            <div className="text-base font-bold" style={{color:"#1a3a1a"}}>Deep Reports</div>
            <div className="text-xs" style={{color:"#8aaa8a"}}>Age, gender, placement, device breakdowns</div>
          </div>
          <ChevronRight size={16} className="transition-colors" style={{color:"#8aaa8a"}}/>
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
                ? 'bg-dark border-lime/25'
                : 'bg-dark2 border-dark4'
            )}
          >
            {kpi.featured && (
              <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-lime to-transparent"/>
            )}
            <div className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{color:"#8aaa8a"}}>
              {kpi.label}
            </div>
            <div className={cn(
              'text-3xl font-black tracking-tight leading-none',
              kpi.featured ? 'text-lime' : 'text-dark'
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

          {/* Winners from Scale & Insights */}
          <div className="card">
            <div className="flex items-center justify-between px-6 py-4" style={{borderBottom:"1px solid rgba(0,0,0,0.07)"}}>
              <div className="font-black text-base" style={{color:"#1a3a1a"}}>🚀 Winning Ad Sets</div>
              <Link href="/insights" className="text-sm font-semibold" style={{color:"#5a7a5a"}}>View Scale & Insights →</Link>
            </div>
            {winners.length === 0 ? (
              <div className="px-6 py-10 text-center text-sm" style={{color:"#8aaa8a"}}>
                No winners detected yet.{' '}
                <Link href="/insights" style={{color:"#1a3a1a",fontWeight:700}}>Open Scale & Insights</Link>
                {' '}to analyse your campaigns.
              </div>
            ) : (
              winners.slice(0,5).map((w: any, i: number) => (
                <div key={i} style={{padding:"14px 24px",borderBottom:"1px solid rgba(0,0,0,0.05)"}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
                    <div>
                      <div style={{fontSize:13,fontWeight:700,color:"#1a3a1a"}}>{w.name}</div>
                      <div style={{fontSize:11,color:"#8aaa8a",marginTop:2}}>{w.campaignName}</div>
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <span style={{background:"rgba(45,122,45,0.1)",border:"1px solid rgba(45,122,45,0.2)",color:"#2d7a2d",padding:"3px 10px",borderRadius:100,fontSize:11,fontWeight:700}}>
                        🏆 {w.roas?.toFixed(2)}x ROAS
                      </span>
                      <Link href="/insights" style={{background:"#1a3a1a",color:"#dffe95",padding:"5px 14px",borderRadius:100,fontSize:11,fontWeight:800,textDecoration:"none"}}>
                        Scale Now →
                      </Link>
                    </div>
                  </div>
                  <div style={{fontSize:12,color:"#6b8f6b",background:"#f0f7ee",borderLeft:"3px solid #2d7a2d",padding:"8px 12px",borderRadius:"0 8px 8px 0"}}>
                    {w.recommendation}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Campaigns table */}
          <div className="card">
            <div className="flex items-center justify-between px-6 py-5 border-b" style={{borderColor:"rgba(0,0,0,0.07)"}}>
              <div className="text-lg font-black" style={{color:"#1a3a1a"}}>Campaigns</div>
              <Link href="/campaigns" className="text-sm font-semibold" style={{color:"#5a7a5a"}}>View Campaigns →</Link>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-dark3">
                    <th className="text-left px-6 py-3 text-[11px] font-bold uppercase tracking-wider" style={{color:"#8aaa8a"}}>Campaign</th>
                    <th className="text-left px-4 py-3 text-[11px] font-bold uppercase tracking-wider" style={{color:"#8aaa8a"}}>Status</th>
                    <th className="text-left px-4 py-3 text-[11px] font-bold uppercase tracking-wider" style={{color:"#8aaa8a"}}>Spend</th>
                    <th className="text-left px-4 py-3 text-[11px] font-bold uppercase tracking-wider" style={{color:"#8aaa8a"}}>ROAS</th>
                    <th className="text-left px-4 py-3 text-[11px] font-bold uppercase tracking-wider" style={{color:"#8aaa8a"}}>CPA</th>
                    <th className="text-left px-4 py-3 text-[11px] font-bold uppercase tracking-wider" style={{color:"#8aaa8a"}}>CTR</th>
                  </tr>
                </thead>
                <tbody>
                  {data.campaigns.filter((c:any) => c.status === 'ACTIVE' || c.status === 'PAUSED').slice(0, 6).map((campaign: any) => {
                    const insights = campaign.campaign_insights?.[0]
                    return (
                      <tr key={campaign.id} className="hover:bg-dark3 transition-colors" style={{borderTop:"1px solid rgba(0,0,0,0.04)"}}>
                        <td className="px-6 py-4 text-sm font-bold max-w-[200px] truncate" style={{color:"#1a3a1a"}}>{campaign.name}</td>
                        <td className="px-4 py-4">
                          <span className={cn(
                            'text-xs font-bold px-2 py-0.5 rounded-full',
                            campaign.status === 'ACTIVE' ? 'pill-green' : 'pill-amber'
                          )}>
                            {campaign.status === 'ACTIVE' ? '● Active' : '⏸ Paused'}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-sm font-bold" style={{color:"#1a3a1a"}}>{formatCurrency(insights?.spend || 0, currency)}</td>
                        <td className="px-4 py-4 text-sm font-bold text-status-green">{formatROAS(insights?.roas || 0)}</td>
                        <td className="px-4 py-4 text-sm font-bold" style={{color:"#1a3a1a"}}>{formatCurrency(insights?.cpa || 0, currency)}</td>
                        <td className="px-4 py-4 text-sm font-bold" style={{color:"#1a3a1a"}}>{formatPercent(insights?.ctr || 0)}</td>
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
            <div className="bg-dark3 px-6 py-6 text-center border-b" style={{borderColor:"rgba(0,0,0,0.07)"}}>
              <div
                className="w-28 h-28 rounded-full mx-auto mb-4 flex items-center justify-center relative"
                style={{
                  background: `conic-gradient(${healthColor} 0% ${healthScore}%, rgba(0,0,0,0.06) ${healthScore}% 100%)`,
                }}
              >
                <div className="absolute inset-3 bg-dark3 rounded-full flex items-center justify-center">
                  <span className="text-2xl font-black" style={{color:healthColor}}>{healthScore}</span>
                </div>
              </div>
              <div className="text-sm mb-2" style={{color:"#8aaa8a"}}>Account Health Score</div>
              <div className="inline-flex items-center gap-2 bg-green/10 border border-green/20 text-status-green text-xs font-bold px-3 py-1 rounded-full">
                {healthScore >= 80 ? "● Excellent" : healthScore >= 60 ? "● Good" : healthScore >= 40 ? "● Fair" : "● Needs work"}
              </div>
            </div>
            <div className="px-5 py-2">
              {[
                { label: 'Active campaigns', value: `${liveCampaigns.filter((c: any) => c.status === 'ACTIVE').length} of ${liveCampaigns.length}`, good: true },
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
