/**
 * A Mello-authored document — the flagship Competitor Intelligence Report and its siblings.
 * SERVER-RENDERED so the strategy doc lands in the HTML and reads even if the client never hydrates
 * (some users' browser extensions break React). The markdown body is rendered by the shared Markdown
 * component; this page gives it an editorial "strategy memo" frame worthy of the artifact.
 */
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { Markdown } from '@/components/mello/Markdown'

export const dynamic = 'force-dynamic'

const MODEL_LABEL: Record<string, string> = {
  'claude-opus': 'Claude Opus', 'gemini-2.5-pro': 'Gemini 2.5 Pro', 'gpt-4o': 'GPT-4o',
}

export default async function DocumentPage({ params }: { params: { id: string } }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) notFound()

  const admin = createAdminClient()
  const { data: doc } = await admin.from('mello_documents').select('*').eq('id', params.id).eq('user_id', user.id).maybeSingle()
  if (!doc) notFound()

  const when = doc.created_at ? new Date(doc.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : ''
  const adCount = (doc.meta as any)?.adCount ?? null
  const costUsd = (doc.meta as any)?.costUsd ?? null
  const swipe: { adId: string; headline: string | null; copy: string | null; days: number | null; format: string | null; image: string | null; videoUrl: string | null }[] = (doc.meta as any)?.swipe || []
  const creators: { name: string; count: number; ads: { adId: string; headline: string | null; days: number | null; format: string | null; image: string | null; videoUrl: string | null }[] }[] = (doc.meta as any)?.creators || []
  const subject = doc.subject || ''
  const stats = (doc.meta as any)?.stats || null
  const statCells: { label: string; value: string }[] = stats ? [
    { label: 'Ads tracked', value: String(stats.adCount ?? '—') },
    ...(stats.activeAds != null ? [{ label: 'Active now', value: String(stats.activeAds) }] : []),
    ...(stats.longestDays != null ? [{ label: 'Longest-running', value: `${stats.longestDays}d` }] : []),
    ...(stats.creatorPct != null ? [{ label: 'Creator-fronted', value: `${stats.creatorPct}%` }] : []),
    ...(stats.formatTop ? [{ label: 'Top format', value: stats.formatTop }] : []),
  ] : []

  return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: '32px 24px 96px' }}>
      <div style={{ marginBottom: 18 }}>
        <Link href="/documents" style={{ fontSize: 13, color: '#5a6b52', textDecoration: 'none', fontWeight: 600 }}>← Documents</Link>
      </div>

      {/* Masthead — treats this like an internal strategy memo, not a chat message. */}
      <div style={{ borderTop: '3px solid #26331f', paddingTop: 14, marginBottom: 8 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#6b7a62' }}>
          <span>Competitor Intelligence</span>
          {doc.subject ? <><span style={{ opacity: 0.4 }}>·</span><span>{doc.subject}</span></> : null}
          {when ? <><span style={{ opacity: 0.4 }}>·</span><span>{when}</span></> : null}
        </div>
      </div>
      <h1 style={{ fontFamily: 'Instrument Serif, Georgia, serif', fontSize: 34, lineHeight: 1.12, color: '#1c2617', margin: '4px 0 10px', fontWeight: 400 }}>
        {doc.title}
      </h1>
      <div style={{ fontSize: 12, color: '#8a9880', marginBottom: 24, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <span>Written by Mello</span>
        {doc.model ? <><span style={{ opacity: 0.4 }}>·</span><span>{MODEL_LABEL[doc.model] || doc.model}</span></> : null}
        {adCount != null ? <><span style={{ opacity: 0.4 }}>·</span><span>grounded on {adCount} real ad{adCount === 1 ? '' : 's'}</span></> : null}
        {costUsd != null ? <><span style={{ opacity: 0.4 }}>·</span><span title="Model cost to generate this report">cost ${Number(costUsd).toFixed(3)}</span></> : null}
      </div>

      {statCells.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${statCells.length}, 1fr)`, gap: 1, background: '#e6ece2', border: '1px solid #e6ece2', borderRadius: 12, overflow: 'hidden', marginBottom: 8 }}>
          {statCells.map((s) => (
            <div key={s.label} style={{ background: '#fbfcf9', padding: '14px 12px', textAlign: 'center' }}>
              <div style={{ fontFamily: 'Instrument Serif, Georgia, serif', fontSize: 26, color: '#17251c', lineHeight: 1 }}>{s.value}</div>
              <div style={{ fontSize: 10.5, color: '#7a8872', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 5 }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}
      {stats?.topCreator && (
        <div style={{ fontSize: 13, color: '#66755d', margin: '2px 0 20px' }}>
          Fronted heavily by <strong style={{ color: '#20321c' }}>{stats.topCreator}</strong> and other whitelisted creators.
        </div>
      )}

      <div style={{ borderTop: '1px solid #e6ece2', paddingTop: 20 }}>
        <Markdown content={doc.body_md || ''} />
      </div>

      {creators.length > 0 && (
        <div style={{ marginTop: 40, borderTop: '3px solid #26331f', paddingTop: 18 }}>
          <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#6b7a62' }}>Their creator payroll</div>
          <h2 style={{ fontFamily: 'Instrument Serif, Georgia, serif', fontSize: 26, lineHeight: 1.15, color: '#1c2617', margin: '4px 0 4px', fontWeight: 400 }}>The faces fronting their ads</h2>
          <p style={{ fontSize: 13.5, color: '#66755d', margin: '0 0 20px', lineHeight: 1.6 }}>
            {subject ? `${subject} runs` : 'They run'} these ads through partner/creator pages, not their own brand page — a paid whitelisting engine. This is who to recruit in the same style.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
            {creators.map((c) => (
              <div key={c.name}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
                  <span style={{ fontSize: 15, fontWeight: 800, color: '#20321c' }}>{c.name}</span>
                  <span style={{ fontSize: 12, color: '#8a9880', fontFamily: 'ui-monospace, Menlo, monospace' }}>{c.count} ad{c.count === 1 ? '' : 's'} fronted</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
                  {c.ads.map((s) => {
                    const isVideo = !!s.videoUrl
                    const href = `/studio?ad=${encodeURIComponent(s.adId)}${isVideo ? '&type=video' : ''}${s.image ? `&img=${encodeURIComponent(s.image)}` : ''}${s.videoUrl ? `&vid=${encodeURIComponent(s.videoUrl)}` : ''}${subject ? `&brand=${encodeURIComponent(subject)}` : ''}`
                    return (
                      <Link key={s.adId} href={href} style={{ textDecoration: 'none', border: '1px solid #e6ece2', borderRadius: 10, overflow: 'hidden', background: '#fff', display: 'flex', flexDirection: 'column' }}>
                        <div style={{ position: 'relative', aspectRatio: '4/5', background: '#f0f3ee' }}>
                          {s.image && <img src={s.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                          {isVideo && <span style={{ position: 'absolute', top: 7, right: 7, background: 'rgba(0,0,0,.6)', color: '#fff', fontSize: 9.5, fontWeight: 700, padding: '2px 6px', borderRadius: 100 }}>▶ VIDEO</span>}
                        </div>
                        <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 5 }}>
                          <div style={{ fontSize: 10.5, color: '#8a9880', fontFamily: 'ui-monospace, Menlo, monospace' }}>
                            {[s.days ? `${s.days}d live` : null, s.format].filter(Boolean).join(' · ') || 'their creative'}
                          </div>
                          <div style={{ fontSize: 11.5, color: '#3a7d2c', fontWeight: 800 }}>Make my version →</div>
                        </div>
                      </Link>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {swipe.length > 0 && (
        <div style={{ marginTop: 40, borderTop: '3px solid #26331f', paddingTop: 18 }}>
          <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#6b7a62' }}>Swipe file</div>
          <h2 style={{ fontFamily: 'Instrument Serif, Georgia, serif', fontSize: 26, lineHeight: 1.15, color: '#1c2617', margin: '4px 0 4px', fontWeight: 400 }}>Steal these — remade for you</h2>
          <p style={{ fontSize: 13.5, color: '#66755d', margin: '0 0 18px', lineHeight: 1.6 }}>
            {subject ? `${subject}'s` : 'Their'} proven winners. One click rebuilds any of them around your product, in your brand.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
            {swipe.map((s) => {
              const isVideo = !!s.videoUrl
              const href = `/studio?ad=${encodeURIComponent(s.adId)}${isVideo ? '&type=video' : ''}${s.image ? `&img=${encodeURIComponent(s.image)}` : ''}${s.videoUrl ? `&vid=${encodeURIComponent(s.videoUrl)}` : ''}${subject ? `&brand=${encodeURIComponent(subject)}` : ''}`
              return (
                <div key={s.adId} style={{ border: '1px solid #e6ece2', borderRadius: 12, overflow: 'hidden', background: '#fff', display: 'flex', flexDirection: 'column' }}>
                  <div style={{ position: 'relative', aspectRatio: '4/5', background: '#f0f3ee' }}>
                    {s.image && <img src={s.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                    {isVideo && <span style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,.6)', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 100 }}>▶ VIDEO</span>}
                  </div>
                  <div style={{ padding: '11px 12px', display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
                    <div style={{ fontSize: 12.5, color: '#2f3b2b', lineHeight: 1.4, flex: 1 }}>
                      {(s.headline || s.copy || 'Untitled ad').slice(0, 90)}
                    </div>
                    <div style={{ fontSize: 10.5, color: '#8a9880', fontFamily: 'ui-monospace, Menlo, monospace' }}>
                      {[s.days ? `${s.days}d live` : null, s.format].filter(Boolean).join(' · ')}
                    </div>
                    <Link href={href} style={{ display: 'block', textAlign: 'center', background: '#c9f24d', color: '#17251c', fontSize: 12.5, fontWeight: 800, padding: '9px 12px', borderRadius: 100, textDecoration: 'none' }}>
                      ✨ Make my version →
                    </Link>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
