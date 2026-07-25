/**
 * Documents — the library of everything Mello has authored (competitor reports, niche teardowns,
 * strategy memos). Server-rendered so the list lands in the HTML regardless of hydration.
 */
import Link from 'next/link'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const KIND_LABEL: Record<string, string> = {
  competitor_report: 'Competitor Intelligence',
  niche_report: 'Niche Teardown',
  strategy_memo: 'Strategy Memo',
}

export default async function DocumentsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  let docs: any[] = []
  if (user) {
    const admin = createAdminClient()
    const { data } = await admin
      .from('mello_documents')
      .select('id, kind, title, subject, model, meta, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(100)
    docs = data || []
  }

  return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: '32px 24px 96px' }}>
      <div style={{ borderTop: '3px solid #26331f', paddingTop: 14 }}>
        <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#6b7a62' }}>Written by Mello</div>
      </div>
      <h1 style={{ fontFamily: 'Instrument Serif, Georgia, serif', fontSize: 34, lineHeight: 1.12, color: '#1c2617', margin: '4px 0 6px', fontWeight: 400 }}>Documents</h1>
      <p style={{ fontSize: 14, color: '#66755d', margin: '0 0 26px', lineHeight: 1.6 }}>
        Strategy documents Mello writes and leaves behind — competitor teardowns, niche reports, memos.
        Ask Mello to <em>“analyze a competitor”</em> to author a new one.
      </p>

      {docs.length === 0 ? (
        <div style={{ border: '1px dashed #cfd9c8', borderRadius: 12, padding: '34px 20px', textAlign: 'center', color: '#7a8872' }}>
          <div style={{ fontFamily: 'Instrument Serif, Georgia, serif', fontSize: 20, color: '#3a4a34', marginBottom: 6 }}>No documents yet</div>
          <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>
            Open Mello and say <strong>“Analyze [a competitor]”</strong> — it’ll write a full intelligence report and file it here.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {docs.map((d) => {
            const when = d.created_at ? new Date(d.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''
            const adCount = (d.meta as any)?.adCount ?? null
            return (
              <Link key={d.id} href={`/documents/${d.id}`} style={{ display: 'block', textDecoration: 'none', color: 'inherit', borderBottom: '1px solid #eef2ec', padding: '16px 4px' }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 10.5, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#8a9880', marginBottom: 4 }}>
                  <span>{KIND_LABEL[d.kind] || d.kind}</span>
                  {when ? <><span style={{ opacity: 0.4 }}>·</span><span>{when}</span></> : null}
                  {adCount != null ? <><span style={{ opacity: 0.4 }}>·</span><span>{adCount} ads</span></> : null}
                </div>
                <div style={{ fontFamily: 'Instrument Serif, Georgia, serif', fontSize: 21, lineHeight: 1.2, color: '#20291b' }}>{d.title}</div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
