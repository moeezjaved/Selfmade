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
      </div>

      <div style={{ borderTop: '1px solid #e6ece2', paddingTop: 20 }}>
        <Markdown content={doc.body_md || ''} />
      </div>
    </div>
  )
}
