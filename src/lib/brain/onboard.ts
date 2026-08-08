/**
 * onboardDepartment — the "institutional memory" payoff (v6 seed). Compiles a department's FIRST-DAY BRIEF
 * from the Company Brain — identity, the rules it must follow (company-wide + its own), what it already
 * knows, what it's learned, and how the founder likes to work — so a brand-new AI department is instantly
 * up to speed instead of starting blank. Deterministic (no LLM) so it always works and is cheap to test.
 */
const DEPT_LABEL: Record<string, string> = {
  research: 'Research', creative: 'Creative', media: 'Media Buying',
  growth: 'Growth', customer: 'Customer', store: 'Store', finance: 'Finance',
}

export async function onboardDepartment(admin: any, userId: string, department: string): Promise<{ department: string; label: string; brief: string; empty: boolean }> {
  const dept = String(department || '').toLowerCase()
  const label = DEPT_LABEL[dept] || (dept ? dept[0].toUpperCase() + dept.slice(1) : 'Department')

  const [idRes, dnaRes, memRes, lnRes, prefRes] = await Promise.all([
    admin.from('brands').select('name, industry, brand_type').eq('user_id', userId).limit(1),
    admin.from('company_dna').select('rule, department, priority').eq('user_id', userId).eq('active', true).order('priority', { ascending: true }).limit(100),
    admin.from('mello_memory').select('content, department, confidence').eq('user_id', userId).is('retired_at', null).order('confidence', { ascending: false }).limit(100),
    admin.from('learnings').select('event, result, department, created_at').eq('user_id', userId).eq('department', dept).order('created_at', { ascending: false }).limit(12),
    admin.from('ceo_preferences').select('key, value').eq('user_id', userId),
  ])

  const identity = (idRes?.data || [])[0] || null
  const dna = (dnaRes?.data || []) as any[]
  const companyRules = dna.filter(d => !d.department)
  const deptRules = dna.filter(d => d.department === dept)
  const mem = (memRes?.data || []) as any[]
  const deptKnows = mem.filter(m => m.department === dept)
  const learns = (lnRes?.data || []) as any[]
  const prefs: Record<string, any> = {}
  for (const r of ((prefRes?.data || []) as any[])) prefs[r.key] = r.value

  const lines: string[] = []
  lines.push(`You are the ${label} department at ${identity?.name || 'this company'}.`)
  if (identity) {
    const bits = [identity.industry, identity.brand_type].filter(Boolean).join(' · ')
    if (bits) lines.push(`The company: ${bits}.`)
  }

  if (companyRules.length) lines.push(`\nCompany rules you must always follow:\n${companyRules.map(r => `• ${r.rule}`).join('\n')}`)
  if (deptRules.length) lines.push(`\nRules specific to ${label}:\n${deptRules.map(r => `• ${r.rule}`).join('\n')}`)
  if (deptKnows.length) lines.push(`\nWhat ${label} already knows:\n${deptKnows.slice(0, 12).map(m => `• ${m.content}`).join('\n')}`)
  if (learns.length) lines.push(`\nWhat ${label} has learned from real results:\n${learns.map(l => `• ${l.event}${l.result ? ` → ${l.result}` : ''}`).join('\n')}`)

  const culture: any = prefs.culture
  if (culture && typeof culture === 'object') {
    lines.push(`\nHow the founder likes to work: ${culture.aggressive || 'balanced'} on risk, ${culture.premium || 'premium'} positioning, ${culture.tone || 'friendly'} tone, and ${culture.risk === 'auto' ? 'you can decide small things yourself' : culture.risk === 'sometimes' ? 'decide small things, ask on the big ones' : 'always ask before you act'}.`)
  }

  const empty = !companyRules.length && !deptRules.length && !deptKnows.length && !learns.length
  if (empty) lines.push(`\n(The company hasn't taught ${label} much yet — teach it on the Company Brain, and this brief fills in.)`)

  return { department: dept, label, brief: lines.join('\n'), empty }
}
