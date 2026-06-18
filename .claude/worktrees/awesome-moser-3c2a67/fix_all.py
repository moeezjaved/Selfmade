# Fix 1: Update M4 page - competitor section copy + Instagram required
content = open('src/app/(dashboard)/m4/page.tsx').read()

# Fix brand name Claude -> Selfmade
content = content.replace(
    'Claude uses this to find audiences already buying from your competitors.',
    'Selfmade uses this to find audiences already buying from your competitors. The more accurate details you provide, the better your targeting will be — this directly impacts your ad performance.'
)

# Fix competitor placeholders to show comma separated
content = content.replace(
    'placeholder="minoxidil.com, regaine.com, foligain.com"',
    'placeholder="minoxidil.com, regaine.com, foligain.com (separate with commas)"'
)
content = content.replace(
    'placeholder="facebook.com/Regaine, facebook.com/Minoxidil"',
    'placeholder="facebook.com/Regaine, facebook.com/Minoxidil (separate with commas)"'
)
content = content.replace(
    'placeholder="@regaine_uk, @minoxidilfor.men"',
    'placeholder="@regaine_uk, @minoxidilfor.men (separate with commas)"'
)

# Fix Instagram - make it show properly, not "optional"
content = content.replace(
    '<div style={{fontSize:12,color:\'rgba(255,255,255,0.4)\',marginBottom:6}}>Instagram Account ID (optional):</div>\n                    <input value={selectedInstagramId} onChange={e=>setSelectedInstagramId(e.target.value)} placeholder="e.g. 17841400000000000" style={{...S.input,fontSize:12}}/>',
    '''<div style={{background:'rgba(251,191,36,0.06)',border:'1px solid rgba(251,191,36,0.2)',borderRadius:10,padding:12,marginTop:4}}>
                      <div style={{fontSize:12,fontWeight:700,color:'#fbbf24',marginBottom:4}}>⚠️ Instagram Required</div>
                      <div style={{fontSize:12,color:'rgba(255,255,255,0.5)',marginBottom:8}}>Your ads will run on both Facebook and Instagram. Connect your Instagram in Meta Business Suite → Instagram Accounts, then reconnect Selfmade.</div>
                      <input value={selectedInstagramId} onChange={e=>setSelectedInstagramId(e.target.value)} placeholder="Or enter Instagram Account ID manually" style={{...S.input,fontSize:12}}/>
                    </div>'''
)

open('src/app/(dashboard)/m4/page.tsx', 'w').write(content)
print('M4 page fixed:', 'Selfmade uses this' in content)
