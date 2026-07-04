'use client'
/**
 * /admin/blog — write & publish blog posts. Two-pane markdown editor with live preview, cover image,
 * SEO fields, and a draft/publish toggle. Talks to /api/admin/blog (admin-cookie auth).
 */
import { useEffect, useState, useCallback } from 'react'
import { renderMarkdown, slugify, readingTimeMin } from '@/lib/blog-markdown'

type Post = {
  id?: string; slug?: string; title: string; excerpt?: string; cover_image_url?: string; body_md: string
  author?: string; tags?: string[]; meta_description?: string; status?: string; published_at?: string | null; updated_at?: string
}
const BLANK: Post = { title: '', body_md: '', excerpt: '', cover_image_url: '', author: 'Selfmade', tags: [], meta_description: '', status: 'draft' }
const LIME = '#dffe95', INK = '#0e1b12'

export default function AdminBlog() {
  const [posts, setPosts] = useState<Post[]>([])
  const [editing, setEditing] = useState<Post | null>(null)
  const [tagsStr, setTagsStr] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)

  const load = useCallback(async () => {
    const j = await fetch('/api/admin/blog').then(r => r.json()).catch(() => ({ posts: [] }))
    setPosts(j.posts || [])
  }, [])
  useEffect(() => { load() }, [load])

  const open = (p: Post | null) => {
    const post = p ? { ...p } : { ...BLANK }
    setEditing(post); setTagsStr((post.tags || []).join(', ')); setSlugTouched(!!p); setMsg('')
  }
  const set = (k: keyof Post, v: any) => setEditing((e) => e ? { ...e, [k]: v } : e)

  const save = async (publish?: boolean) => {
    if (!editing) return
    if (!editing.title.trim()) { setMsg('Title required'); return }
    setSaving(true); setMsg('')
    const body = { ...editing, tags: tagsStr.split(',').map(s => s.trim()).filter(Boolean), status: publish ? 'published' : (editing.status || 'draft') }
    const j = await fetch('/api/admin/blog', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json()).catch(() => ({ error: 'failed' }))
    setSaving(false)
    if (j.error) { setMsg('Error: ' + j.error); return }
    setMsg(publish ? '✓ Published' : '✓ Saved'); setEditing(j.post); await load()
  }
  const del = async (id?: string) => {
    if (!id || !confirm('Delete this post?')) return
    await fetch(`/api/admin/blog?id=${id}`, { method: 'DELETE' })
    setEditing(null); await load()
  }

  const inp: React.CSSProperties = { width: '100%', padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box' }
  const lbl: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.04em', margin: '0 0 5px', display: 'block' }

  return (
    <div style={{ fontFamily: "'Inter',-apple-system,sans-serif", maxWidth: 1280, margin: '0 auto', padding: 24, color: INK }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, margin: 0 }}>Blog</h1>
        <button onClick={() => open(null)} style={{ background: INK, color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 100, fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>+ New post</button>
      </div>

      {!editing ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(320px,1fr))', gap: 16 }}>
          {posts.length === 0 && <div style={{ color: '#9ca3af', fontSize: 15 }}>No posts yet. Click “New post” to write your first.</div>}
          {posts.map((p) => (
            <div key={p.id} onClick={() => open(p)} style={{ border: '1px solid #eef0ee', borderRadius: 14, overflow: 'hidden', cursor: 'pointer', background: '#fff' }}>
              <div style={{ aspectRatio: '16/9', background: '#0d120e' }}>
                {p.cover_image_url && /* eslint-disable-next-line @next/next/no-img-element */ <img src={p.cover_image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
              </div>
              <div style={{ padding: '12px 14px 16px' }}>
                <span style={{ fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 20, background: p.status === 'published' ? '#dcfce7' : '#fef3c7', color: p.status === 'published' ? '#166534' : '#92400e' }}>{p.status === 'published' ? 'Published' : 'Draft'}</span>
                <h3 style={{ fontSize: 16, fontWeight: 800, margin: '8px 0 4px', lineHeight: 1.25 }}>{p.title || '(untitled)'}</h3>
                <div style={{ fontSize: 12.5, color: '#9ca3af' }}>{p.slug}</div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <button onClick={() => setEditing(null)} style={{ background: 'none', border: '1px solid #d1d5db', padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>← Back</button>
            <div style={{ flex: 1 }} />
            {msg && <span style={{ fontSize: 13, fontWeight: 700, color: msg.startsWith('Error') ? '#dc2626' : '#16a34a' }}>{msg}</span>}
            {editing.id && <button onClick={() => del(editing.id)} style={{ background: 'none', border: '1px solid #fecaca', color: '#dc2626', padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Delete</button>}
            <button onClick={() => save(false)} disabled={saving} style={{ background: '#fff', border: '1px solid #d1d5db', padding: '9px 16px', borderRadius: 100, fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>Save draft</button>
            <button onClick={() => save(true)} disabled={saving} style={{ background: LIME, border: 'none', padding: '9px 18px', borderRadius: 100, fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>{editing.status === 'published' ? 'Update' : 'Publish'}</button>
          </div>

          {/* meta fields */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 14, marginBottom: 16 }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={lbl}>Title</label>
              <input style={{ ...inp, fontSize: 18, fontWeight: 700 }} value={editing.title} placeholder="How to write a scroll-stopping Meta ad" onChange={(e) => { set('title', e.target.value); if (!slugTouched) set('slug', slugify(e.target.value)) }} />
            </div>
            <div>
              <label style={lbl}>Slug (URL)</label>
              <input style={inp} value={editing.slug || ''} placeholder="how-to-write-scroll-stopping-ads" onChange={(e) => { setSlugTouched(true); set('slug', e.target.value) }} />
            </div>
            <div>
              <label style={lbl}>Cover image URL</label>
              <input style={inp} value={editing.cover_image_url || ''} placeholder="https://…/cover.jpg" onChange={(e) => set('cover_image_url', e.target.value)} />
            </div>
            <div>
              <label style={lbl}>Author</label>
              <input style={inp} value={editing.author || ''} onChange={(e) => set('author', e.target.value)} />
            </div>
            <div>
              <label style={lbl}>Tags (comma-separated)</label>
              <input style={inp} value={tagsStr} placeholder="strategy, teardown" onChange={(e) => setTagsStr(e.target.value)} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={lbl}>Excerpt (card summary)</label>
              <input style={inp} value={editing.excerpt || ''} placeholder="One or two sentences that sell the click." onChange={(e) => set('excerpt', e.target.value)} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={lbl}>Meta description (SEO — falls back to excerpt)</label>
              <input style={inp} value={editing.meta_description || ''} onChange={(e) => set('meta_description', e.target.value)} />
            </div>
          </div>

          {/* two-pane markdown editor */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
            <div>
              <label style={lbl}>Body (Markdown) · {readingTimeMin(editing.body_md)} min read</label>
              <textarea value={editing.body_md} onChange={(e) => set('body_md', e.target.value)} spellCheck
                placeholder={'## A big subhead\n\nWrite in **markdown**. Use *italics*, [links](https://…), lists:\n\n- point one\n- point two\n\n> A pull quote.\n\n![alt text](https://…/image.jpg)'}
                style={{ width: '100%', minHeight: 520, padding: 16, border: '1px solid #d1d5db', borderRadius: 10, fontSize: 14.5, lineHeight: 1.6, fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace', boxSizing: 'border-box', resize: 'vertical' }} />
            </div>
            <div>
              <label style={lbl}>Live preview</label>
              <div className="blog-prose" style={{ minHeight: 520, padding: '8px 22px', border: '1px solid #eef0ee', borderRadius: 10, background: '#fff', overflow: 'auto' }}
                dangerouslySetInnerHTML={{ __html: renderMarkdown(editing.body_md) }} />
            </div>
          </div>
          <style>{`
            .blog-prose{font-size:16px;line-height:1.7;color:#1f2937}
            .blog-prose h2{font-size:24px;font-weight:800;margin:26px 0 10px}
            .blog-prose h3{font-size:19px;font-weight:800;margin:22px 0 8px}
            .blog-prose h4{font-size:16px;font-weight:800;margin:18px 0 6px}
            .blog-prose a{color:#16a34a;text-decoration:underline}
            .blog-prose ul,.blog-prose ol{padding-left:22px;margin:0 0 16px}
            .blog-prose blockquote{border-left:4px solid ${LIME};background:#fbfdfa;padding:4px 16px;margin:16px 0;font-style:italic;color:#374151}
            .blog-prose code{background:#f3f4f6;padding:1px 5px;border-radius:5px;font-size:.9em}
            .blog-prose pre{background:#0d120e;color:#e5e7eb;padding:14px 16px;border-radius:10px;overflow-x:auto}
            .blog-prose pre code{background:none;padding:0;color:inherit}
            .blog-prose img{max-width:100%;border-radius:10px}
            .blog-prose figcaption{font-size:13px;color:#9ca3af;text-align:center}
          `}</style>
        </div>
      )}
    </div>
  )
}
