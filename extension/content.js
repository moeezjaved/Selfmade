/**
 * Selfmade extension — content script (runs on every page except our own site).
 *
 * Two save surfaces, Atria-style:
 *  1. PER-CARD button — on the Facebook Ad Library we inject a prominent full-width
 *     "＋ Save to Selfmade" button into every ad card (discoverable, no hover needed).
 *  2. HOVER button — on Instagram / TikTok / anywhere else, hovering any image or video shows a
 *     ＋Save button. Plus a floating button that grabs the biggest media on the page.
 *
 * Brand/caption metadata is extracted per-host to enrich the save; a save always works without it.
 */
(function () {
  if (window.__selfmadeInjected) return
  window.__selfmadeInjected = true
  const HOST = location.hostname
  if (HOST.includes('tryselfmade.ai')) return
  const IS_ADLIB = HOST.includes('facebook.com') && location.pathname.includes('/ads/library')

  const MIN = 140

  // ── Toast ─────────────────────────────────────────────────────────────────
  function toast(msg, ok = true) {
    const t = document.createElement('div')
    t.className = 'sm-toast ' + (ok ? 'sm-ok' : 'sm-err')
    t.textContent = msg
    document.documentElement.appendChild(t)
    requestAnimationFrame(() => t.classList.add('sm-show'))
    setTimeout(() => { t.classList.remove('sm-show'); setTimeout(() => t.remove(), 300) }, 2600)
  }

  // ── Media + metadata helpers ─────────────────────────────────────────────
  function mediaUrl(el) {
    if (!el) return { url: '', type: 'image' }
    if (el instanceof HTMLVideoElement) return { url: el.currentSrc || el.src || el.querySelector('source')?.src || '', type: 'video' }
    return { url: el.currentSrc || el.src || '', type: 'image' }
  }
  function biggestMediaIn(scope) {
    let best = null, bestArea = MIN * MIN
    for (const el of scope.querySelectorAll('img, video')) {
      const r = el.getBoundingClientRect()
      const area = r.width * r.height
      if (area > bestArea) { best = el; bestArea = area }
    }
    return best
  }
  function textFrom(scope, sels, max = 800) {
    for (const s of sels) { const e = scope.querySelector(s); const t = (e?.textContent || '').trim(); if (t) return t.slice(0, max) }
    return ''
  }
  function meta(scope) {
    let brand = '', ad_copy = '', platform = 'web'
    try {
      if (IS_ADLIB) {
        platform = 'facebook'
        brand = textFrom(scope, ['a[href*="facebook.com/"] span', 'a[href*="/"] strong', 'strong span', 'span[dir="auto"] strong'], 120)
        ad_copy = textFrom(scope, ['div[style*="line-clamp"]', '[data-ad-preview="message"]', 'span[dir="auto"]'], 900)
      } else if (HOST.includes('instagram.com')) {
        platform = 'instagram'
        const art = scope.closest?.('article') || scope
        brand = textFrom(art, ['header a[href^="/"]'], 120)
        ad_copy = textFrom(art, ['h1', 'ul li span'], 500)
      } else if (HOST.includes('tiktok.com')) {
        platform = 'tiktok'
        brand = textFrom(document, ['[data-e2e="browse-username"]', '[data-e2e="video-author-uniqueid"]'], 120)
        ad_copy = textFrom(document, ['[data-e2e="browse-video-desc"]', '[data-e2e="video-desc"]'], 500)
      } else {
        brand = (document.querySelector('meta[property="og:site_name"]')?.getAttribute('content') || document.title || '').trim().slice(0, 120)
      }
    } catch {}
    return { brand, ad_copy, platform }
  }

  async function toDataURL(url) {
    try {
      const res = await fetch(url)
      if (!res.ok) return null
      const blob = await res.blob()
      if (blob.size > 6_000_000) return null
      return await new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => resolve(null); r.readAsDataURL(blob) })
    } catch { return null }
  }

  // ── Shared save ───────────────────────────────────────────────────────────
  let busy = false
  async function doSave(mediaEl, scope, btn, labels) {
    if (busy) return
    const { url, type } = mediaUrl(mediaEl)
    if (!url) { toast('Could not read that media', false); return }
    busy = true
    const restore = btn.innerHTML
    btn.innerHTML = labels.saving
    btn.classList.add('sm-busy')

    const m = meta(scope || document)
    const image_data = type === 'image' ? await toDataURL(url) : null
    const payload = {
      media_url: url, media_type: type, image_data,
      source_url: location.href, source_platform: m.platform,
      brand: m.brand || undefined, ad_copy: m.ad_copy || undefined,
    }
    chrome.runtime.sendMessage({ type: 'saveAd', payload }, (resp) => {
      busy = false
      btn.classList.remove('sm-busy')
      if (chrome.runtime.lastError) { btn.innerHTML = restore; toast('Extension reloaded — refresh the page', false); return }
      if (resp?.ok) { btn.innerHTML = labels.done; btn.classList.add('sm-done'); toast('✓ Saved to Selfmade') }
      else if (resp?.status === 401) { btn.innerHTML = restore; toast('Open the Selfmade icon to sign in first', false) }
      else { btn.innerHTML = restore; toast(resp?.error || 'Save failed', false) }
    })
  }

  // ── 1. PER-CARD button (Facebook Ad Library) ───────────────────────────────
  function findCard(label) {
    let el = label
    for (let i = 0; i < 12 && el; i++) {
      el = el.parentElement
      if (el && (el.querySelector('img') || el.querySelector('video'))) {
        const r = el.getBoundingClientRect()
        if (r.width > 240 && r.height > 240) return el
      }
    }
    return null
  }
  function injectCardButtons() {
    // Each ad card carries a "Library ID" label near its top — anchor on it, walk up to the card.
    const labels = document.querySelectorAll('span, div')
    for (const label of labels) {
      const txt = label.textContent || ''
      if (txt.length > 40 || !/Library ID/i.test(txt) || label.children.length > 1) continue
      const card = findCard(label)
      if (!card || card.dataset.smCard) continue
      card.dataset.smCard = '1'
      const btn = document.createElement('button')
      btn.className = 'sm-card-btn'
      btn.innerHTML = '<span class="sm-ico">＋</span> Save to Selfmade'
      btn.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation()
        const media = biggestMediaIn(card)
        if (media) doSave(media, card, btn, { saving: 'Saving…', done: '✓ Saved' })
        else toast('No media found in this ad', false)
      })
      if (getComputedStyle(card).position === 'static') card.style.position = 'relative'
      card.insertBefore(btn, card.firstChild)
    }
  }

  // ── 2. HOVER button + floating button (everywhere else) ─────────────────────
  function setupHover() {
    const btn = document.createElement('button')
    btn.className = 'sm-save-btn'
    btn.innerHTML = '<span class="sm-ico">＋</span> Save'
    btn.style.display = 'none'
    document.documentElement.appendChild(btn)
    let target = null, hideT = null
    const showFor = (el) => {
      const r = el.getBoundingClientRect()
      if (r.width < MIN || r.height < MIN) return
      target = el
      btn.style.display = 'flex'
      btn.style.top = `${Math.max(8, r.top) + 8}px`
      btn.style.left = `${Math.min(window.innerWidth - 96, r.right - 92)}px`
    }
    const scheduleHide = () => { clearTimeout(hideT); hideT = setTimeout(() => { btn.style.display = 'none'; target = null }, 400) }
    document.addEventListener('mouseover', (e) => {
      const el = e.target
      if (el instanceof HTMLImageElement || el instanceof HTMLVideoElement) { clearTimeout(hideT); showFor(el) }
    }, true)
    document.addEventListener('mouseout', (e) => {
      if (e.target === btn || (e.target instanceof Element && e.target.closest('.sm-save-btn'))) return
      scheduleHide()
    }, true)
    btn.addEventListener('mouseover', () => clearTimeout(hideT))
    btn.addEventListener('mouseout', scheduleHide)
    btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); if (target) doSave(target, document, btn, { saving: '<span class="sm-ico">…</span> Saving', done: '✓ Saved' }) })

    const fab = document.createElement('button')
    fab.className = 'sm-fab'
    fab.title = 'Save the main media on this page to Selfmade'
    fab.innerHTML = '<img src="' + chrome.runtime.getURL('icons/icon48.png') + '" alt=""/>'
    document.documentElement.appendChild(fab)
    fab.addEventListener('click', () => {
      const el = biggestMediaIn(document)
      if (el) doSave(el, document, fab, { saving: '…', done: '✓' })
      else toast('No image or video found here', false)
    })
  }

  // ── Boot ────────────────────────────────────────────────────────────────────
  setupHover()
  if (IS_ADLIB) {
    injectCardButtons()
    const obs = new MutationObserver(() => { clearTimeout(window.__smT); window.__smT = setTimeout(injectCardButtons, 300) })
    obs.observe(document.body, { childList: true, subtree: true })
  }
})()
