/**
 * Selfmade extension — content script (runs on every page except our own site).
 * Approach: instead of brittle per-site DOM parsing, we attach a "Save" button to ANY image/video
 * the user hovers (this naturally covers Instagram, the Facebook Ad Library, TikTok and everywhere
 * else). Brand/caption metadata is extracted per-host to enrich the save, but a save always works
 * even without it. A floating button also saves the biggest media on the current page.
 */
(function () {
  if (window.__selfmadeInjected) return
  window.__selfmadeInjected = true
  const HOST = location.hostname
  if (HOST.includes('tryselfmade.ai')) return

  const MIN = 140 // ignore icons/avatars smaller than this

  // ── UI: hover Save button ──────────────────────────────────────────────────
  const btn = document.createElement('button')
  btn.className = 'sm-save-btn'
  btn.innerHTML = '<span class="sm-ico">＋</span> Save'
  btn.style.display = 'none'
  document.documentElement.appendChild(btn)
  let target = null, hideT = null

  function showFor(el) {
    const r = el.getBoundingClientRect()
    if (r.width < MIN || r.height < MIN) return
    target = el
    btn.style.display = 'flex'
    btn.style.top = `${Math.max(8, r.top) + 8}px`
    btn.style.left = `${Math.min(window.innerWidth - 96, r.right - 92)}px`
  }
  function scheduleHide() { clearTimeout(hideT); hideT = setTimeout(() => { btn.style.display = 'none'; target = null }, 400) }

  document.addEventListener('mouseover', (e) => {
    const el = e.target
    if (el instanceof HTMLImageElement || el instanceof HTMLVideoElement) { clearTimeout(hideT); showFor(el) }
  }, true)
  document.addEventListener('mouseout', (e) => {
    if ((e.target === btn) || (e.target instanceof Element && e.target.closest('.sm-save-btn'))) return
    scheduleHide()
  }, true)
  btn.addEventListener('mouseover', () => clearTimeout(hideT))
  btn.addEventListener('mouseout', scheduleHide)
  btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); if (target) save(target, btn) })

  // ── UI: floating action button (universal "save this page's media") ─────────
  const fab = document.createElement('button')
  fab.className = 'sm-fab'
  fab.title = 'Save the main media on this page to Selfmade'
  fab.innerHTML = '<img src="' + chrome.runtime.getURL('icons/icon48.png') + '" alt=""/>'
  document.documentElement.appendChild(fab)
  fab.addEventListener('click', () => {
    const el = biggestMedia()
    if (el) save(el, fab); else toast('No image or video found here', false)
  })

  function biggestMedia() {
    let best = null, bestArea = MIN * MIN
    for (const el of document.querySelectorAll('img, video')) {
      const r = el.getBoundingClientRect()
      const area = r.width * r.height
      if (area > bestArea && r.top < window.innerHeight && r.bottom > 0) { best = el; bestArea = area }
    }
    return best
  }

  // ── Toast ───────────────────────────────────────────────────────────────────
  function toast(msg, ok = true) {
    const t = document.createElement('div')
    t.className = 'sm-toast ' + (ok ? 'sm-ok' : 'sm-err')
    t.textContent = msg
    document.documentElement.appendChild(t)
    requestAnimationFrame(() => t.classList.add('sm-show'))
    setTimeout(() => { t.classList.remove('sm-show'); setTimeout(() => t.remove(), 300) }, 2600)
  }

  // ── Metadata extraction (per host, best-effort) ──────────────────────────────
  function meta(el) {
    let brand = '', ad_copy = '', platform = 'web'
    try {
      if (HOST.includes('instagram.com')) {
        platform = 'instagram'
        const art = el.closest('article') || document
        brand = (art.querySelector('header a[href^="/"]')?.textContent || '').trim()
        ad_copy = (art.querySelector('h1, ul li span, div[role="button"]+span')?.textContent || '').trim().slice(0, 500)
      } else if (HOST.includes('facebook.com')) {
        platform = 'facebook'
        const card = el.closest('[class*="x1lliihq"], div[role="article"]') || el.parentElement
        brand = (card?.querySelector('a[role="link"] span, strong')?.textContent || '').trim()
        ad_copy = (card?.querySelector('div[style*="webkit-box"], [data-ad-preview="message"]')?.textContent || '').trim().slice(0, 800)
      } else if (HOST.includes('tiktok.com')) {
        platform = 'tiktok'
        brand = (document.querySelector('[data-e2e="browse-username"], [data-e2e="video-author-uniqueid"]')?.textContent || '').trim()
        ad_copy = (document.querySelector('[data-e2e="browse-video-desc"], [data-e2e="video-desc"]')?.textContent || '').trim().slice(0, 500)
      } else {
        brand = (document.querySelector('meta[property="og:site_name"]')?.getAttribute('content') || document.title || '').trim().slice(0, 120)
      }
    } catch {}
    return { brand, ad_copy, platform }
  }

  function mediaUrl(el) {
    if (el instanceof HTMLVideoElement) {
      const src = el.currentSrc || el.src || el.querySelector('source')?.src || ''
      return { url: src, type: 'video' }
    }
    return { url: el.currentSrc || el.src || '', type: 'image' }
  }

  async function toDataURL(url) {
    try {
      const res = await fetch(url)
      if (!res.ok) return null
      const blob = await res.blob()
      if (blob.size > 6_000_000) return null // keep messages small; big → let server fetch
      return await new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => resolve(null); r.readAsDataURL(blob) })
    } catch { return null }
  }

  // ── Save ─────────────────────────────────────────────────────────────────────
  let busy = false
  async function save(el, sourceBtn) {
    if (busy) return
    const { url, type } = mediaUrl(el)
    if (!url) { toast('Could not read that media', false); return }
    busy = true
    const original = sourceBtn.innerHTML
    if (sourceBtn === btn) sourceBtn.innerHTML = '<span class="sm-ico">…</span> Saving'
    sourceBtn.classList.add('sm-busy')

    const m = meta(el)
    const image_data = type === 'image' ? await toDataURL(url) : null
    const payload = {
      media_url: url, media_type: type, image_data,
      source_url: location.href, source_platform: m.platform,
      brand: m.brand || undefined, ad_copy: m.ad_copy || undefined,
    }

    chrome.runtime.sendMessage({ type: 'saveAd', payload }, (resp) => {
      busy = false
      sourceBtn.classList.remove('sm-busy')
      if (sourceBtn === btn) sourceBtn.innerHTML = original
      if (chrome.runtime.lastError) { toast('Extension reloaded — refresh the page', false); return }
      if (resp?.ok) { toast('✓ Saved to Selfmade'); if (sourceBtn === btn) flash(btn) }
      else if (resp?.status === 401) toast('Open the Selfmade icon to sign in first', false)
      else toast(resp?.error || 'Save failed', false)
    })
  }
  function flash(b) { b.classList.add('sm-done'); setTimeout(() => b.classList.remove('sm-done'), 1200) }
})()
