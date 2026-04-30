'use client'
import { useState, useEffect } from 'react'

const fmt = (n: number, currency = 'PKR') =>
  new Intl.NumberFormat('en-PK', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n)

export default function ReportsPage() {
  const [loading, setLoading] = useState(true)
  const [dateRange, setDateRange] = useState('last_7d')
  const [data, setData] = useState<any>(null)
  const [error, setError] = useState('')

  useEffect(() => { loadReports() }, [dateRange])

  const loadReports = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/reports?dateRange=${dateRange}`)
      const json = await res.json()
      if (json.error) setError(json.error)
      else setData(json)
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }

  const card = (label: string, value: string, sub?: string, color = 'white') => (
    <div style={{background:'#152928',border:'1px solid rgba(255,255,255,0.06)',borderRadius:16,padding:20}}>
      <div style={{fontSize:11,fontWeight:700,color:'rgba(255,255,255,0.4)',textTransform:'uppercase',letterSpacing:'.08em',marginBottom:8}}>{label}</div>
      <div style={{fontSize:24,fontWeight:900,color}}>{value}</div>
      {sub && <div style={{fontSize:11,color:'rgba(255,255,255,0.35)',marginTop:4}}>{sub}</div>}
    </div>
  )

  return (
    <div style={{padding:32,maxWidth:1200,margin:'0 auto'}}>
      {/* Header */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:28}}>
        <div>
          <div style={{fontSize:24,fontWeight:900,color:'white'}}>Reports</div>
          <div style={{fontSize:13,color:'rgba(255,255,255,0.4)',marginTop:4}}>Deep insights from your Meta Ads data</div>
        </div>
        <div style={{display:'flex',gap:8}}>
          {['last_3d','last_7d','last_14d','last_30d'].map(r => (
            <button key={r} onClick={()=>setDateRange(r)} style={{padding:'8px 16px',borderRadius:100,border:'none',fontFamily:'inherit',fontWeight:700,fontSize:12,cursor:'pointer',background:dateRange===r?'#dffe95':'rgba(255,255,255,0.06)',color:dateRange===r?'#10211f':'rgba(255,255,255,0.5)'}}>
              {r.replace('last_','').replace('d',' days')}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{textAlign:'center',padding:80}}>
          <img src='/favicon.png' alt='' style={{width:44,height:44,borderRadius:11,animation:'spin 1s linear infinite',margin:'0 auto 16px',display:'block'}}/>
          <div style={{color:'white',fontWeight:700}}>Loading your reports...</div>
        </div>
      ) : error ? (
        <div style={{background:'rgba(248,113,113,0.1)',border:'1px solid rgba(248,113,113,0.3)',borderRadius:16,padding:24,color:'#f87171'}}>{error}</div>
      ) : data && (
        <div style={{display:'flex',flexDirection:'column',gap:24}}>

          {/* Overview */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:16}}>
            {card('Total Spend', fmt(data.overview?.spend||0, data.currency), undefined, '#f87171')}
            {card('Total Revenue', fmt(data.overview?.revenue||0, data.currency), undefined, '#86efac')}
            {card('Blended ROAS', (data.overview?.roas||0).toFixed(2)+'x', undefined, data.overview?.roas>=2?'#86efac':data.overview?.roas>=1?'#fbbf24':'#f87171')}
            {card('Conversions', String(data.overview?.conversions||0), undefined, '#93c5fd')}
          </div>

          {/* Best Creative */}
          <Section title="🎨 Best Performing Creatives" subtitle="Ranked by ROAS">
            <Table
              headers={['Creative/Ad Name','Spend','Revenue','ROAS','Conversions','CTR','CPA']}
              rows={(data.creatives||[]).map((c:any) => [
                c.name,
                fmt(c.spend, data.currency),
                fmt(c.revenue, data.currency),
                <span style={{color:c.roas>=2?'#86efac':c.roas>=1?'#fbbf24':'#f87171',fontWeight:800}}>{c.roas.toFixed(2)}x</span>,
                c.conversions,
                c.ctr.toFixed(2)+'%',
                fmt(c.cpa, data.currency),
              ])}
            />
          </Section>

          {/* Audience Breakdown */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
            <Section title="👥 Age Breakdown" subtitle="Which age group buys most">
              <Table
                headers={['Age Group','Spend','Revenue','ROAS','Conversions']}
                rows={(data.age||[]).map((r:any) => [
                  r.age_range,
                  fmt(r.spend, data.currency),
                  fmt(r.revenue, data.currency),
                  <span style={{color:r.roas>=2?'#86efac':r.roas>=1?'#fbbf24':'#f87171',fontWeight:800}}>{r.roas.toFixed(2)}x</span>,
                  r.conversions,
                ])}
              />
            </Section>

            <Section title="⚧ Gender Breakdown" subtitle="Performance by gender">
              <Table
                headers={['Gender','Spend','Revenue','ROAS','Conversions']}
                rows={(data.gender||[]).map((r:any) => [
                  r.gender==='male'?'👨 Male':r.gender==='female'?'👩 Female':'Unknown',
                  fmt(r.spend, data.currency),
                  fmt(r.revenue, data.currency),
                  <span style={{color:r.roas>=2?'#86efac':r.roas>=1?'#fbbf24':'#f87171',fontWeight:800}}>{r.roas.toFixed(2)}x</span>,
                  r.conversions,
                ])}
              />
            </Section>
          </div>

          {/* Placement Breakdown */}
          <Section title="📍 Placement Breakdown" subtitle="Where your ads perform best">
            <Table
              headers={['Placement','Spend','Revenue','ROAS','Conversions','CTR']}
              rows={(data.placement||[]).map((r:any) => [
                r.placement,
                fmt(r.spend, data.currency),
                fmt(r.revenue, data.currency),
                <span style={{color:r.roas>=2?'#86efac':r.roas>=1?'#fbbf24':'#f87171',fontWeight:800}}>{r.roas.toFixed(2)}x</span>,
                r.conversions,
                r.ctr.toFixed(2)+'%',
              ])}
            />
          </Section>

          {/* Device Breakdown */}
          <Section title="📱 Device Breakdown" subtitle="Mobile vs Desktop performance">
            <Table
              headers={['Device','Spend','Revenue','ROAS','Conversions','CTR']}
              rows={(data.device||[]).map((r:any) => [
                r.device,
                fmt(r.spend, data.currency),
                fmt(r.revenue, data.currency),
                <span style={{color:r.roas>=2?'#86efac':r.roas>=1?'#fbbf24':'#f87171',fontWeight:800}}>{r.roas.toFixed(2)}x</span>,
                r.conversions,
                r.ctr.toFixed(2)+'%',
              ])}
            />
          </Section>

          {/* Time of Day */}
          <Section title="🕐 Time of Day" subtitle="When people buy most">
            <Table
              headers={['Hour','Spend','Revenue','ROAS','Conversions']}
              rows={(data.hourly||[]).map((r:any) => [
                r.hour,
                fmt(r.spend, data.currency),
                fmt(r.revenue, data.currency),
                <span style={{color:r.roas>=2?'#86efac':r.roas>=1?'#fbbf24':'#f87171',fontWeight:800}}>{r.roas.toFixed(2)}x</span>,
                r.conversions,
              ])}
            />
          </Section>

          {/* Day of Week */}
          <Section title="📅 Day of Week" subtitle="Best days for conversions">
            <Table
              headers={['Day','Spend','Revenue','ROAS','Conversions']}
              rows={(data.daily||[]).map((r:any) => [
                r.day,
                fmt(r.spend, data.currency),
                fmt(r.revenue, data.currency),
                <span style={{color:r.roas>=2?'#86efac':r.roas>=1?'#fbbf24':'#f87171',fontWeight:800}}>{r.roas.toFixed(2)}x</span>,
                r.conversions,
              ])}
            />
          </Section>

          {/* Geographic */}
          <Section title="🌍 Geographic Breakdown" subtitle="Top performing regions">
            <Table
              headers={['Region','Spend','Revenue','ROAS','Conversions']}
              rows={(data.geographic||[]).map((r:any) => [
                r.region,
                fmt(r.spend, data.currency),
                fmt(r.revenue, data.currency),
                <span style={{color:r.roas>=2?'#86efac':r.roas>=1?'#fbbf24':'#f87171',fontWeight:800}}>{r.roas.toFixed(2)}x</span>,
                r.conversions,
              ])}
            />
          </Section>

        </div>
      )}

      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}

function Section({title,subtitle,children}:{title:string,subtitle:string,children:React.ReactNode}) {
  return (
    <div style={{background:'#152928',border:'1px solid rgba(255,255,255,0.06)',borderRadius:20,overflow:'hidden'}}>
      <div style={{padding:'16px 24px',borderBottom:'1px solid rgba(255,255,255,0.06)'}}>
        <div style={{fontSize:16,fontWeight:800,color:'white'}}>{title}</div>
        <div style={{fontSize:12,color:'rgba(255,255,255,0.4)',marginTop:2}}>{subtitle}</div>
      </div>
      <div style={{overflowX:'auto'}}>{children}</div>
    </div>
  )
}

function Table({headers,rows}:{headers:string[],rows:any[][]}) {
  if (!rows.length) return (
    <div style={{padding:24,textAlign:'center',color:'rgba(255,255,255,0.3)',fontSize:13}}>No data available for this period</div>
  )
  return (
    <table style={{width:'100%',borderCollapse:'collapse'}}>
      <thead>
        <tr>
          {headers.map(h => (
            <th key={h} style={{padding:'10px 16px',textAlign:'left',fontSize:10,fontWeight:700,color:'rgba(255,255,255,0.35)',textTransform:'uppercase',letterSpacing:'.06em',borderBottom:'1px solid rgba(255,255,255,0.04)'}}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row,i) => (
          <tr key={i} style={{borderBottom:'1px solid rgba(255,255,255,0.03)'}}>
            {row.map((cell,j) => (
              <td key={j} style={{padding:'12px 16px',fontSize:13,color:'rgba(255,255,255,0.8)',fontWeight:j===0?700:400}}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
