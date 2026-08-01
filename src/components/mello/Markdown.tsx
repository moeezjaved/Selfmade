'use client'

import React from 'react'

/**
 * Minimal Markdown → React renderer for Mello's answers. Supports headings,
 * bold/italic/code inline, bullet & numbered lists, GitHub-style tables, and
 * paragraphs. No external dependency. Good enough for the agent's output style.
 */
function inline(text: string, keyBase: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  // Tokenize ![alt](url) image, **bold**, *italic*, `code`. Image FIRST so ad thumbnails render
  // (used in Mello's "running ads" table — first cell is the creative).
  const re = /(!\[([^\]]*)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`)/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    if (m[3] !== undefined) {
      // eslint-disable-next-line @next/next/no-img-element
      nodes.push(<img key={`${keyBase}-img${i}`} src={m[3]} alt={m[2] || ''} style={{ width: 44, height: 44, borderRadius: 7, objectFit: 'cover', verticalAlign: 'middle', display: 'inline-block', background: '#eef2ec' }} onError={(e: any) => { e.currentTarget.style.display = 'none' }} />)
    }
    else if (m[4] !== undefined) nodes.push(<strong key={`${keyBase}-b${i}`}>{m[4]}</strong>)
    else if (m[5] !== undefined) nodes.push(<em key={`${keyBase}-i${i}`}>{m[5]}</em>)
    else if (m[6] !== undefined) nodes.push(<code key={`${keyBase}-c${i}`} style={{ background: 'rgba(0,0,0,0.06)', padding: '1px 5px', borderRadius: 4, fontSize: '0.88em' }}>{m[6]}</code>)
    last = m.index + m[0].length
    i++
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

function splitRow(line: string): string[] {
  return line.replace(/^\||\|$/g, '').split('|').map(c => c.trim())
}

export function Markdown({ content }: { content: string }) {
  const lines = (content || '').split('\n')
  const blocks: React.ReactNode[] = []
  let i = 0
  let key = 0

  while (i < lines.length) {
    const line = lines[i]

    // Blank line
    if (!line.trim()) { i++; continue }

    // Table: header row + separator row of dashes
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const header = splitRow(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(splitRow(lines[i])); i++
      }
      blocks.push(
        <div key={key++} style={{ overflowX: 'auto', margin: '10px 0' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
            <thead>
              <tr>{header.map((h, hi) => (
                <th key={hi} style={{ textAlign: 'left', padding: '7px 10px', borderBottom: '2px solid #e2e8e0', color: '#3a4a36', fontWeight: 700, whiteSpace: 'nowrap' }}>{inline(h, `th${key}-${hi}`)}</th>
              ))}</tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri} style={{ borderBottom: '1px solid #eef2ec' }}>
                  {r.map((c, ci) => (
                    <td key={ci} style={{ padding: '7px 10px', color: '#33402f', verticalAlign: 'top' }}>{inline(c, `td${key}-${ri}-${ci}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
      continue
    }

    // Headings
    const hMatch = /^(#{1,4})\s+(.*)$/.exec(line)
    if (hMatch) {
      const lvl = hMatch[1].length
      const size = lvl === 1 ? 19 : lvl === 2 ? 17 : 15
      blocks.push(<div key={key++} style={{ fontSize: size, fontWeight: 800, color: '#26331f', margin: '12px 0 6px' }}>{inline(hMatch[2], `h${key}`)}</div>)
      i++; continue
    }

    // Bullet list
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*]\s+/, '')); i++ }
      blocks.push(
        <ul key={key++} style={{ margin: '6px 0', paddingLeft: 20, listStyle: 'disc' }}>
          {items.map((it, ii) => <li key={ii} style={{ margin: '3px 0', color: '#33402f', fontSize: 14, lineHeight: 1.5 }}>{inline(it, `li${key}-${ii}`)}</li>)}
        </ul>
      )
      continue
    }

    // Numbered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+\.\s+/, '')); i++ }
      blocks.push(
        <ol key={key++} style={{ margin: '6px 0', paddingLeft: 22 }}>
          {items.map((it, ii) => <li key={ii} style={{ margin: '3px 0', color: '#33402f', fontSize: 14, lineHeight: 1.5 }}>{inline(it, `ol${key}-${ii}`)}</li>)}
        </ol>
      )
      continue
    }

    // Paragraph (collect consecutive non-special lines)
    const para: string[] = [line]
    i++
    while (i < lines.length && lines[i].trim() && !/^\s*[-*]\s+/.test(lines[i]) && !/^\s*\d+\.\s+/.test(lines[i]) && !/^#{1,4}\s/.test(lines[i]) && !lines[i].includes('|')) {
      para.push(lines[i]); i++
    }
    const text = para.join(' ')
    // "→ do this" takeaway lines render as a highlighted action callout (the report's most useful lines).
    if (/^\s*(→|➔|=&gt;|->)\s*/.test(text)) {
      const body = text.replace(/^\s*(→|➔|=&gt;|->)\s*/, '')
      blocks.push(
        <div key={key++} style={{ margin: '12px 0', padding: '11px 14px', background: '#eef7d6', borderLeft: '3px solid #26331f', borderRadius: '0 8px 8px 0', color: '#20321c', fontSize: 13.5, lineHeight: 1.55 }}>
          <span style={{ fontWeight: 800, marginRight: 6 }}>→</span>{inline(body, `cta${key}`)}
        </div>
      )
    } else {
      blocks.push(<p key={key++} style={{ margin: '6px 0', color: '#2f3b2b', fontSize: 14, lineHeight: 1.6 }}>{inline(text, `p${key}`)}</p>)
    }
  }

  return <div>{blocks}</div>
}
