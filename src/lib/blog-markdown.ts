/**
 * Pure, dependency-free Markdown→sanitized-HTML renderer + slug/reading-time helpers.
 * No server imports, so it's safe to use from BOTH the server pages and the client editor's live
 * preview. XSS-safe: text is HTML-escaped before any inline/block rules run.
 */
export function slugify(s: string): string {
  return (s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)
}

export function readingTimeMin(md: string): number {
  const words = (md || '').trim().split(/\s+/).filter(Boolean).length
  return Math.max(1, Math.round(words / 220))
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Inline: `code`, ![alt](url), [text](url), **bold**, *italic*. Runs on ALREADY-escaped text.
function inline(t: string): string {
  return t
    .replace(/`([^`]+)`/g, (_m, c) => `<code>${c}</code>`)
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, alt, url) => `<img src="${esc(url)}" alt="${alt}" loading="lazy" />`)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, txt, url) => {
      const ext = /^https?:\/\//.test(url) && !url.includes('tryselfmade')
      return `<a href="${esc(url)}"${ext ? ' target="_blank" rel="noopener nofollow"' : ''}>${txt}</a>`
    })
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
}

// ── Designed blocks (Ryze-style) — authored as :::cta / :::steps fences, rendered to a fixed,
// safe HTML shape (all values escaped). Lets posts drop rich CTA/step cards inline without raw HTML.
function renderCta(buf: string[]): string {
  const kv: Record<string, string> = {}
  for (const l of buf) { const m = l.match(/^(\w+):\s*(.*)$/); if (m) kv[m[1].toLowerCase()] = m[2].trim() }
  const h = esc(kv.heading || ''); const s = kv.sub ? inline(esc(kv.sub)) : ''
  const b = esc(kv.button || 'Start free'); const href = kv.href || '/signup'
  const ext = /^https?:\/\//.test(href) && !href.includes('tryselfmade')
  return `<div class="sf-cta"><div class="sf-cta-h">${h}</div>${s ? `<p class="sf-cta-s">${s}</p>` : ''}<a class="sf-cta-b" href="${esc(href)}"${ext ? ' target="_blank" rel="noopener nofollow"' : ''}>${b} →</a></div>`
}
function renderSteps(buf: string[]): string {
  const items = buf.map((l) => l.trim()).filter(Boolean).map((l, idx) => {
    const [t, ...d] = l.split('|'); const title = esc((t || '').trim()); const desc = d.length ? inline(esc(d.join('|').trim())) : ''
    return `<div class="sf-step"><span class="sf-step-n">${idx + 1}</span><div class="sf-step-b"><b>${title}</b>${desc ? `<p>${desc}</p>` : ''}</div></div>`
  }).join('')
  return `<div class="sf-steps">${items}</div>`
}

export function renderMarkdown(md: string): string {
  const lines = (md || '').replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  let i = 0
  let para: string[] = []
  const flushPara = () => { if (para.length) { out.push(`<p>${inline(esc(para.join(' ')))}</p>`); para = [] } }

  while (i < lines.length) {
    const line = lines[i]
    if (/^```/.test(line)) {
      flushPara(); i++
      const code: string[] = []
      while (i < lines.length && !/^```/.test(lines[i])) { code.push(lines[i]); i++ }
      i++
      out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`); continue
    }
    const dir = line.match(/^:::(cta|steps)\s*$/)
    if (dir) {
      flushPara(); i++
      const buf: string[] = []
      while (i < lines.length && !/^:::\s*$/.test(lines[i])) { buf.push(lines[i]); i++ }
      i++ // consume closing :::
      out.push(dir[1] === 'cta' ? renderCta(buf) : renderSteps(buf)); continue
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/)
    if (h) { flushPara(); const lvl = h[1].length + 1; out.push(`<h${lvl}>${inline(esc(h[2].trim()))}</h${lvl}>`); i++; continue }
    if (/^\s*(---|\*\*\*)\s*$/.test(line)) { flushPara(); out.push('<hr />'); i++; continue }
    if (/^>\s?/.test(line)) {
      flushPara(); const q: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i])) { q.push(lines[i].replace(/^>\s?/, '')); i++ }
      out.push(`<blockquote>${inline(esc(q.join(' ')))}</blockquote>`); continue
    }
    if (/^\s*[-*]\s+/.test(line)) {
      flushPara(); const items: string[] = []
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { items.push(`<li>${inline(esc(lines[i].replace(/^\s*[-*]\s+/, '')))}</li>`); i++ }
      out.push(`<ul>${items.join('')}</ul>`); continue
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      flushPara(); const items: string[] = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { items.push(`<li>${inline(esc(lines[i].replace(/^\s*\d+\.\s+/, '')))}</li>`); i++ }
      out.push(`<ol>${items.join('')}</ol>`); continue
    }
    if (/^\s*$/.test(line)) { flushPara(); i++; continue }
    const imgOnly = line.trim().match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/)
    if (imgOnly) { flushPara(); out.push(`<figure><img src="${esc(imgOnly[2])}" alt="${imgOnly[1]}" loading="lazy" />${imgOnly[1] ? `<figcaption>${esc(imgOnly[1])}</figcaption>` : ''}</figure>`); i++; continue }
    para.push(line.trim()); i++
  }
  flushPara()
  return out.join('\n')
}
