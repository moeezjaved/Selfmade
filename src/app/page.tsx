import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function HomePage() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (user) redirect('/dashboard')
  } catch {}

  return (
    <div className="min-h-screen" style={{background:'#10211f'}}>

      {/* NAV */}
      <nav style={{background:'#152928',borderBottom:'1px solid rgba(223,254,149,0.13)',position:'sticky',top:0,zIndex:50}}>
        <div style={{maxWidth:1280,margin:'0 auto',padding:'0 32px',height:68,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <span style={{fontSize:26,fontWeight:900,color:'#dffe95',fontFamily:'serif',fontStyle:'italic'}}><img src='/logo.png' alt='Selfmade' style={{height:36,width:'auto',display:'block'}}/></span>
          <div style={{display:'flex',alignItems:'center',gap:12}}>
            <Link href="/login" style={{color:'rgba(255,255,255,0.6)',fontSize:14,fontWeight:600,textDecoration:'none',padding:'8px 18px',borderRadius:100,border:'1.5px solid rgba(255,255,255,0.12)'}}>Log In</Link>
            <Link href="/signup" style={{background:'#dffe95',color:'#10211f',fontSize:14,fontWeight:800,textDecoration:'none',padding:'10px 22px',borderRadius:100}}>Start Free Trial</Link>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <section style={{maxWidth:1280,margin:'0 auto',padding:'100px 32px 80px',textAlign:'center'}}>
        <div style={{display:'inline-flex',alignItems:'center',gap:8,background:'rgba(223,254,149,0.10)',border:'1px solid rgba(223,254,149,0.22)',borderRadius:100,padding:'6px 16px',marginBottom:24}}>
          <span style={{width:6,height:6,borderRadius:'50%',background:'#dffe95',display:'inline-block'}}></span>
          <span style={{fontSize:12,fontWeight:700,color:'#dffe95',textTransform:'uppercase',letterSpacing:'.08em'}}>AI-Powered Meta Ads</span>
        </div>
        <h1 style={{fontSize:64,fontWeight:900,color:'white',lineHeight:1.1,letterSpacing:'-.03em',marginBottom:20}}>
          Stop guessing.<br/>
          <em style={{fontFamily:'Georgia,serif',fontStyle:'italic',color:'#dffe95'}}>Start winning.</em>
        </h1>
        <p style={{fontSize:18,color:'rgba(255,255,255,0.55)',lineHeight:1.7,marginBottom:40,maxWidth:520,margin:'0 auto 40px'}}>
          Your AI media buyer that never sleeps. Pause losers, scale winners, and launch campaigns — all with your approval.
        </p>
        <div style={{display:'flex',gap:12,justifyContent:'center',flexWrap:'wrap',marginBottom:48}}>
          <Link href="/signup" style={{background:'#dffe95',color:'#10211f',fontSize:16,fontWeight:800,textDecoration:'none',padding:'14px 36px',borderRadius:100}}>Start Free Trial →</Link>
          <Link href="/login" style={{background:'none',color:'rgba(255,255,255,0.7)',fontSize:15,fontWeight:600,textDecoration:'none',padding:'14px 28px',borderRadius:100,border:'1.5px solid rgba(255,255,255,0.15)'}}>Log In</Link>
        </div>
        <div style={{display:'flex',gap:40,justifyContent:'center',flexWrap:'wrap'}}>
          {[['$2.4M+','Ad spend managed'],['3.8×','Avg ROAS lift'],['7 days','Free trial']].map(([num,label]) => (
            <div key={label} style={{textAlign:'center'}}>
              <div style={{fontSize:24,fontWeight:900,color:'#dffe95'}}>{num}</div>
              <div style={{fontSize:12,color:'rgba(255,255,255,0.4)',marginTop:2}}>{label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* FEATURE STRIP */}
      <div style={{background:'#152928',borderTop:'1px solid rgba(223,254,149,0.13)',borderBottom:'1px solid rgba(223,254,149,0.13)',padding:'22px 32px'}}>
        <div style={{maxWidth:1280,margin:'0 auto',display:'flex',alignItems:'center',justifyContent:'center',gap:36,flexWrap:'wrap'}}>
          {['Approval-First AI','Live ROAS Tracking','Auto Pause Losers','Scale Winners','Meta API Direct','Creative Studio','Zero Ads Manager'].map(f => (
            <div key={f} style={{display:'flex',alignItems:'center',gap:7,fontSize:13,fontWeight:700,color:'rgba(255,255,255,0.45)',whiteSpace:'nowrap'}}>
              <span style={{color:'#dffe95'}}>✦</span> {f}
            </div>
          ))}
        </div>
      </div>

      {/* HOW IT WORKS */}
      <section style={{maxWidth:1280,margin:'0 auto',padding:'90px 32px'}}>
        <div style={{textAlign:'center',marginBottom:52}}>
          <div style={{fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:'.1em',color:'#dffe95',marginBottom:12}}>How it works</div>
          <h2 style={{fontSize:42,fontWeight:900,color:'white',letterSpacing:'-.025em',lineHeight:1.2}}>
            From insight to action<br/><em style={{fontFamily:'Georgia,serif',fontStyle:'italic',color:'#dffe95'}}>in seconds.</em>
          </h2>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:20}}>
          {[
            {num:'01',title:'Connect Meta',desc:'Link your Facebook ad account via OAuth. Selfmade syncs all campaigns and performance data in real time.',icon:'🔗'},
            {num:'02',title:'Claude analyses',desc:'5 AI agents run in parallel — audience, creative, funnel, competitive, budget. Full reasoning included.',icon:'🧠'},
            {num:'03',title:'You approve, we execute',desc:'Nothing changes without your explicit approval. Click approve and Selfmade calls the Meta API instantly.',icon:'✅'},
          ].map(step => (
            <div key={step.num} style={{background:'#152928',border:'1px solid rgba(223,254,149,0.13)',borderRadius:20,padding:32,position:'relative',overflow:'hidden'}}>
              <div style={{position:'absolute',top:0,left:'20%',right:'20%',height:'1.5px',background:'linear-gradient(90deg,transparent,#dffe95,transparent)'}}></div>
              <div style={{fontSize:38,marginBottom:14}}>{step.icon}</div>
              <div style={{fontSize:10,fontWeight:800,color:'#dffe95',textTransform:'uppercase',letterSpacing:'.1em',marginBottom:8}}>{step.num}</div>
              <div style={{fontSize:18,fontWeight:800,color:'white',marginBottom:10}}>{step.title}</div>
              <div style={{fontSize:13,color:'rgba(255,255,255,0.5)',lineHeight:1.7}}>{step.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* FEATURES */}
      <section style={{background:'#152928',borderTop:'1px solid rgba(223,254,149,0.13)',padding:'90px 32px'}}>
        <div style={{maxWidth:1280,margin:'0 auto'}}>
          <div style={{textAlign:'center',marginBottom:52}}>
            <h2 style={{fontSize:42,fontWeight:900,color:'white',letterSpacing:'-.025em',lineHeight:1.2}}>
              Everything you need.<br/><em style={{fontFamily:'Georgia,serif',fontStyle:'italic',color:'#dffe95'}}>Nothing you don&apos;t.</em>
            </h2>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:16}}>
            {[
              {icon:'📊',title:'Live KPI Dashboard',desc:'ROAS, CPA, CTR, Spend updated in real time. No more opening Ads Manager.'},
              {icon:'🎯',title:'AI Recommendations',desc:'Claude surfaces what to pause, scale or test — with full reasoning behind every suggestion.'},
              {icon:'🚀',title:'Ad Engine',desc:'Create and launch complete Meta campaigns without touching Ads Manager. Step by step.'},
              {icon:'🎨',title:'Creative Studio',desc:'Pick your best ad. Claude generates 6 strategic variation briefs with image prompts.'},
              {icon:'🛡️',title:'Approval-First',desc:'Nothing changes without your sign-off. Full write access, zero auto-execution.'},
              {icon:'📋',title:'Activity Log',desc:'Complete audit trail of every action by you and Selfmade AI. Export anytime.'},
            ].map(f => (
              <div key={f.title} style={{background:'#1c3533',border:'1px solid rgba(223,254,149,0.10)',borderRadius:16,padding:24}}>
                <div style={{fontSize:30,marginBottom:12}}>{f.icon}</div>
                <div style={{fontSize:15,fontWeight:800,color:'white',marginBottom:8}}>{f.title}</div>
                <div style={{fontSize:13,color:'rgba(255,255,255,0.5)',lineHeight:1.7}}>{f.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* TESTIMONIALS */}
      <section style={{maxWidth:1280,margin:'0 auto',padding:'90px 32px'}}>
        <div style={{textAlign:'center',marginBottom:52}}>
          <h2 style={{fontSize:42,fontWeight:900,color:'white',letterSpacing:'-.025em',lineHeight:1.2}}>
            Real results from<br/><em style={{fontFamily:'Georgia,serif',fontStyle:'italic',color:'#dffe95'}}>real advertisers.</em>
          </h2>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:20}}>
          {[
            {q:'"CPL dropped 34% in 3 weeks. Selfmade caught creative fatigue before it killed my best campaign."',name:'Aisha L.',role:'Lead Gen · Real Estate · $12k/mo',init:'AL'},
            {q:'"I replaced my $4k/month agency. Better results, full transparency, I understand every decision."',name:'Marcus K.',role:'Solo SaaS Founder · $6k/mo',init:'MK'},
            {q:'"The recommendations are scary accurate. It caught a CPM spike I would have missed for days."',name:'Sophie R.',role:'E-Commerce · Activewear · $18k/mo',init:'SR'},
          ].map(t => (
            <div key={t.name} style={{background:'#152928',border:'1px solid rgba(223,254,149,0.13)',borderRadius:20,padding:28}}>
              <p style={{fontSize:14,color:'rgba(255,255,255,0.7)',fontStyle:'italic',lineHeight:1.75,marginBottom:20}}>{t.q}</p>
              <div style={{display:'flex',alignItems:'center',gap:12}}>
                <div style={{width:36,height:36,borderRadius:'50%',background:'#dffe95',display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,fontWeight:800,color:'#10211f',flexShrink:0}}>{t.init}</div>
                <div>
                  <div style={{fontSize:13,fontWeight:700,color:'white'}}>{t.name}</div>
                  <div style={{fontSize:11,color:'rgba(255,255,255,0.4)',marginTop:1}}>{t.role}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* PRICING */}
      <section style={{background:'#152928',borderTop:'1px solid rgba(223,254,149,0.13)',padding:'90px 32px'}}>
        <div style={{maxWidth:520,margin:'0 auto',textAlign:'center'}}>
          <h2 style={{fontSize:42,fontWeight:900,color:'white',letterSpacing:'-.025em',marginBottom:40,lineHeight:1.2}}>
            One plan.<br/><em style={{fontFamily:'Georgia,serif',fontStyle:'italic',color:'#dffe95'}}>Everything included.</em>
          </h2>
          <div style={{background:'#1c3533',border:'1px solid rgba(223,254,149,0.25)',borderRadius:24,padding:40,position:'relative',overflow:'hidden'}}>
            <div style={{position:'absolute',top:0,left:'20%',right:'20%',height:'1.5px',background:'linear-gradient(90deg,transparent,#dffe95,transparent)'}}></div>
            <div style={{fontSize:13,fontWeight:700,color:'#dffe95',textTransform:'uppercase',letterSpacing:'.08em',marginBottom:8}}>Selfmade Pro</div>
            <div style={{display:'flex',alignItems:'baseline',justifyContent:'center',gap:4,marginBottom:6}}>
              <span style={{fontSize:54,fontWeight:900,color:'white',letterSpacing:'-.03em'}}>$99</span>
              <span style={{fontSize:15,color:'rgba(255,255,255,0.4)'}}>/month</span>
            </div>
            <div style={{fontSize:13,color:'rgba(255,255,255,0.4)',marginBottom:28}}>7-day free trial · Cancel anytime</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:28,textAlign:'left'}}>
              {['Live KPI Dashboard','AI Recommendations','Approval-First','Ad Engine','Creative Studio','Multiple Accounts','Activity Log','Cancel Anytime'].map(f => (
                <div key={f} style={{display:'flex',alignItems:'center',gap:7,fontSize:13,color:'rgba(255,255,255,0.6)'}}>
                  <span style={{color:'#dffe95',fontWeight:900,flexShrink:0}}>✓</span> {f}
                </div>
              ))}
            </div>
            <Link href="/signup" style={{display:'block',background:'#dffe95',color:'#10211f',fontSize:15,fontWeight:800,textDecoration:'none',padding:'14px',borderRadius:12,textAlign:'center'}}>
              Start Free Trial →
            </Link>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section style={{maxWidth:680,margin:'0 auto',padding:'90px 32px'}}>
        <h2 style={{fontSize:42,fontWeight:900,color:'white',letterSpacing:'-.025em',marginBottom:40,textAlign:'center',lineHeight:1.2}}>
          Questions?<br/><em style={{fontFamily:'Georgia,serif',fontStyle:'italic',color:'#dffe95'}}>We have answers.</em>
        </h2>
        <div style={{display:'flex',flexDirection:'column',gap:3}}>
          {[
            {q:'Does Selfmade change my ads without asking?',a:'Never. Every recommendation requires your explicit click to execute. We have full API write access but use it only when you approve.'},
            {q:'What Meta permissions do you need?',a:'ads_management, ads_read, business_management and pages_read_engagement. ads_management is required to execute approved actions.'},
            {q:'Do I need Meta ads experience?',a:'No. Selfmade works for beginners and pros. The Ad Engine guides you through everything step by step.'},
            {q:"How is this different from Meta's own tools?",a:"Meta shows you data. Selfmade tells you what to do with it and executes when you approve. Dashboard vs co-pilot."},
            {q:'Can I cancel anytime?',a:'Yes. No contracts, no penalties. Cancel from your billing page and access remains until end of billing period.'},
          ].map((item,i) => (
            <details key={i} style={{background:'#152928',border:'1px solid rgba(223,254,149,0.13)',borderRadius:12,padding:'18px 22px',cursor:'pointer',marginBottom:0}}>
              <summary style={{fontSize:14,fontWeight:700,color:'white',listStyle:'none',display:'flex',justifyContent:'space-between',alignItems:'center',gap:16}}>
                {item.q} <span style={{color:'#dffe95',fontSize:18,flexShrink:0}}>+</span>
              </summary>
              <p style={{fontSize:13,color:'rgba(255,255,255,0.55)',lineHeight:1.75,marginTop:12,marginBottom:0}}>{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* FINAL CTA */}
      <section style={{background:'#152928',borderTop:'1px solid rgba(223,254,149,0.13)',padding:'90px 32px',textAlign:'center'}}>
        <div style={{maxWidth:520,margin:'0 auto'}}>
          <h2 style={{fontSize:46,fontWeight:900,color:'white',letterSpacing:'-.03em',marginBottom:14,lineHeight:1.15}}>
            Ready to stop<br/><em style={{fontFamily:'Georgia,serif',fontStyle:'italic',color:'#dffe95'}}>guessing?</em>
          </h2>
          <p style={{fontSize:16,color:'rgba(255,255,255,0.5)',marginBottom:32,lineHeight:1.7}}>
            Join 1,200+ advertisers who replaced agency fees with AI-powered media buying.
          </p>
          <Link href="/signup" style={{display:'inline-flex',alignItems:'center',gap:8,background:'#dffe95',color:'#10211f',fontSize:16,fontWeight:800,textDecoration:'none',padding:'15px 36px',borderRadius:100}}>
            Start Free Trial → <span style={{fontSize:12,fontWeight:600,opacity:.6}}>No card needed</span>
          </Link>
        </div>
      </section>

      {/* FOOTER */}
      <footer style={{borderTop:'1px solid rgba(223,254,149,0.08)',padding:'28px 32px'}}>
        <div style={{maxWidth:1280,margin:'0 auto',display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:14}}>
          <span style={{fontSize:20,fontWeight:900,color:'rgba(255,255,255,0.3)',fontFamily:'Georgia,serif',fontStyle:'italic'}}>Selfmade</span>
          <div style={{fontSize:12,color:'rgba(255,255,255,0.2)'}}>© 2025 Selfmade. All rights reserved.</div>
          <div style={{display:'flex',gap:18}}>
            {['Privacy','Terms','Contact'].map(l => (
              <a key={l} href="#" style={{fontSize:12,color:'rgba(255,255,255,0.25)',textDecoration:'none'}}>{l}</a>
            ))}
          </div>
        </div>
      </footer>

      <style>{`details summary::-webkit-details-marker{display:none}`}</style>
    </div>
  )
}
