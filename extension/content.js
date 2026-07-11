/**
 * Selfmade extension — content script (runs on every page except our own site).
 *
 * Save surfaces, Atria-style:
 *  • PER-CARD / PER-POST buttons injected in-place on Facebook Ad Library, Instagram, TikTok Ad
 *    Library, and the TikTok feed — a prominent "＋ Save to Selfmade" button, no hover needed.
 *  • HOVER button on any other image/video, plus a floating button for the biggest media on a page.
 *
 * Brand/caption metadata is extracted per-surface to enrich the save; a save always works without it.
 */
(function () {
  if (window.__selfmadeInjected) return
  window.__selfmadeInjected = true
  const HOST = location.hostname
  if (HOST.includes('tryselfmade.ai')) return

  const IS_FB_ADLIB = HOST.includes('facebook.com') && location.pathname.includes('/ads/library')
  const IS_TT_ADLIB = HOST.includes('library.tiktok.com')
  const IS_TT_FEED = HOST.includes('tiktok.com') && !IS_TT_ADLIB
  const IS_IG = HOST.includes('instagram.com')
  // Ad surfaces we actually support. The hover Save button only runs here — otherwise it popped up on
  // EVERY thumbnail on media sites like YouTube ("Save button everywhere when I scroll").
  const SUPPORTED = HOST.includes('facebook.com') || IS_IG || IS_TT_ADLIB || IS_TT_FEED
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
  // Extract an http(s) image URL from a CSS background-image (FB paints many creatives this way).
  function bgUrl(el) {
    try {
      const bg = getComputedStyle(el).backgroundImage || ''
      const m = bg.match(/url\(["']?(https?:\/\/[^"')]+)["']?\)/)
      return m ? m[1] : ''
    } catch { return '' }
  }
  function mediaUrl(el) {
    if (!el) return { url: '', type: 'image' }
    if (el instanceof HTMLVideoElement) {
      const src = el.currentSrc || el.src || el.querySelector('source')?.src || ''
      // FB/IG stream video through blob: (MediaSource) which the server can't fetch — save the
      // poster frame (an fbcdn image) instead so the save still works.
      if (!src || src.startsWith('blob:')) { const p = el.poster || ''; if (p) return { url: p, type: 'image' } }
      return { url: src, type: 'video' }
    }
    if (el instanceof HTMLImageElement) return { url: el.currentSrc || el.src || '', type: 'image' }
    const bg = bgUrl(el)                                  // background-image creative
    if (bg) return { url: bg, type: 'image' }
    return { url: '', type: 'image' }
  }
  // Blob-streamed videos (FB/IG/TikTok feed) can't be fetched by the server. Grab a POSTER image so
  // the save still works + the saved card shows the creative (not a black box). "Open original" (the
  // permalink) is what lets the user actually watch the video on the platform.
  function findPoster(el) {
    if (el instanceof HTMLVideoElement && el.poster && /^https?:/.test(el.poster)) return el.poster
    const box = (el.closest && el.closest('[role="article"], article, [data-ad-preview], [aria-label]')) || el.parentElement || document
    let best = '', bestArea = 120 * 120                 // ignore avatars/icons
    for (const img of box.querySelectorAll('img')) {
      const src = img.currentSrc || img.src || ''
      if (!/^https?:/.test(src)) continue
      const r = img.getBoundingClientRect(); const a = r.width * r.height
      if (a > bestArea) { best = src; bestArea = a }
    }
    if (best) return best
    // Last resort: a background-image creative in the same box.
    for (const d of box.querySelectorAll('div, a, span')) { const u = bgUrl(d); if (u) return u }
    return ''
  }
  function biggestMediaIn(scope) {
    let best = null, bestArea = MIN * MIN
    for (const el of scope.querySelectorAll('img, video')) {
      const r = el.getBoundingClientRect()
      const area = r.width * r.height
      if (area > bestArea) { best = el; bestArea = area }
    }
    // FB often has no <img>/<video> for the creative — it's a background-image div. Consider those.
    if (!best) {
      for (const el of scope.querySelectorAll('div, a, span')) {
        if (!bgUrl(el)) continue
        const r = el.getBoundingClientRect()
        const area = r.width * r.height
        if (area > bestArea) { best = el; bestArea = area }
      }
    }
    return best
  }
  function textFrom(scope, sels, max = 800) {
    for (const s of sels) { const e = scope.querySelector(s); const t = (e?.textContent || '').trim(); if (t) return t.slice(0, max) }
    return ''
  }
  const LABEL_RE = /^(Sponsored|Active|Inactive|See ad details|See summary details|Library ID|Started running|Platforms|Open Drop-?down|This ad has multiple versions|First shown|Last shown|Unique users seen|\d+ ads?\b|Ad\b|Follow|Like|Comment|Share|Save)/i
  function longestText(scope, max = 900) {
    // Key off the element with the longest OWN text (direct text nodes) — robust to markup shifts.
    let best = ''
    for (const el of scope.querySelectorAll('span, div, p')) {
      let own = ''
      for (const n of el.childNodes) if (n.nodeType === 3) own += n.textContent
      own = own.trim()
      if (own.length > best.length && own.length > 25 && !LABEL_RE.test(own)) best = own
    }
    return best.slice(0, max)
  }
  // Best-effort post permalink so "Open original" opens the actual ad/post, not the site's home page.
  function permalinkIn(scope) {
    try {
      const art = scope.closest?.('article') || scope
      // Prefer the post's timestamp link (the canonical permalink on IG/FB) or an explicit /p/ /reel/ href.
      let href = ''
      try { href = (art.querySelector('a:has(time)') || art.querySelector('a[href*="/p/"], a[href*="/reel/"], a[href*="/reels/"]'))?.getAttribute('href') || '' } catch {}
      if (!href) {
        href = [...art.querySelectorAll('a[href]')].map(x => x.getAttribute('href') || '')
          .find(h => /\/(p|reel|reels|share|watch|stories|posts)\//.test(h) || /story_fbid=|permalink\.php|\/videos\//.test(h) || /view_all_page_id=/.test(h)) || ''
      }
      if (!href) return ''
      return href.startsWith('http') ? href : new URL(href, location.origin).href
    } catch { return '' }
  }
  function meta(scope) {
    let brand = '', ad_copy = '', platform = 'web', permalink = ''
    try {
      permalink = permalinkIn(scope)
      if (IS_FB_ADLIB) {
        platform = 'facebook'
        brand = textFrom(scope, ['a[href*="facebook.com/"] span', 'a[href*="/"] strong', 'strong span', 'span[dir="auto"] strong'], 120)
        ad_copy = longestText(scope)
      } else if (IS_TT_ADLIB) {
        platform = 'tiktok'
        brand = textFrom(scope, ['a[href*="/ads/detail"]', 'h1', 'h2', 'strong', 'a[href*="advertiser"]'], 120)
        if (!brand) { const t = (scope.textContent || '').replace(/^\s*Ad\s*/i, '').trim(); brand = t.split('\n')[0].slice(0, 120) }
      } else if (IS_IG) {
        platform = 'instagram'
        const art = scope.closest?.('article') || scope
        // Username = first "/handle/" permalink with text (IG dropped the <header> wrapper).
        const u = [...art.querySelectorAll('a[href^="/"]')].find(a => /^\/[A-Za-z0-9._]+\/$/.test(a.getAttribute('href') || '') && (a.textContent || '').trim())
        brand = u ? (u.textContent || '').trim().replace(/Verified$/, '') : ''
        ad_copy = longestText(art)
      } else if (IS_TT_FEED) {
        platform = 'tiktok'
        brand = textFrom(scope, ['[data-e2e="browse-username"]', '[data-e2e="video-author-uniqueid"]', 'a[href^="/@"]'], 120)
        ad_copy = textFrom(scope, ['[data-e2e="browse-video-desc"]', '[data-e2e="video-desc"]'], 500)
      } else {
        brand = (document.querySelector('meta[property="og:site_name"]')?.getAttribute('content') || document.title || '').trim().slice(0, 120)
      }
    } catch {}
    return { brand, ad_copy, platform, permalink }
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
  async function doSave(mediaEl, scope, btn, labels, opts = {}) {
    if (busy) return
    let { url, type } = mediaUrl(mediaEl)
    // Blob/again video with no direct src → save its poster frame (image) so the save works and the
    // card shows the creative. The permalink (below) is how the user watches the real video.
    if (!url || (type === 'video' && url.startsWith('blob:'))) {
      const poster = findPoster(mediaEl)
      if (poster) { url = poster; type = 'image' }
    }
    if (!url) { toast('Could not read that media — try the ＋Save on the ad itself', false); return }
    busy = true
    const restore = btn.innerHTML
    btn.innerHTML = labels.saving
    btn.classList.add('sm-busy')
    const m = meta(scope || document)
    const image_data = type === 'image' ? await toDataURL(url) : null
    const payload = {
      media_url: url, media_type: type, image_data,
      source_url: m.permalink || location.href, source_platform: m.platform,
      brand: m.brand || undefined, ad_copy: m.ad_copy || undefined,
    }
    chrome.runtime.sendMessage({ type: 'saveAd', payload }, (resp) => {
      busy = false
      btn.classList.remove('sm-busy')
      if (chrome.runtime.lastError) { btn.innerHTML = restore; toast('Extension reloaded — refresh the page', false); return }
      if (resp?.ok) {
        btn.innerHTML = labels.done; btn.classList.add('sm-done'); toast('✓ Saved to Selfmade')
        // Reusable buttons (the floating FAB + the hover button) must NOT stay stuck green — revert
        // them so the next ad can be saved. Per-card buttons keep the "✓ Saved" state.
        if (opts.revert) setTimeout(() => { btn.innerHTML = restore; btn.classList.remove('sm-done') }, 1800)
      }
      else if (resp?.status === 401) { btn.innerHTML = restore; toast('Open the Selfmade icon to sign in first', false) }
      else { btn.innerHTML = restore; toast(resp?.error || 'Save failed', false) }
    })
  }

  // ── Generic card-button injector ────────────────────────────────────────────
  function addCardButton(card, place) {
    if (!card || card.dataset.smCard) return
    // De-dupe nested containers (TikTok wraps a video in several matching divs → multiple buttons for
    // ONE ad). Skip if this card already contains a button, or sits inside an already-tagged card.
    if (card.querySelector('.sm-card-btn')) return
    if (card.closest('[data-sm-card]')) return
    card.dataset.smCard = '1'
    const btn = document.createElement('button')
    btn.className = 'sm-card-btn'
    btn.innerHTML = '<span class="sm-ico">＋</span> Save to Selfmade'
    btn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation()
      const media = biggestMediaIn(card)
      if (media) doSave(media, card, btn, { saving: 'Saving…', done: '✓ Saved' })
      else toast('No media found here', false)
    })
    if (getComputedStyle(card).position === 'static') card.style.position = 'relative'
    if (place === 'append') card.appendChild(btn); else card.insertBefore(btn, card.firstChild)
  }
  // Is this feed card an AD (sponsored), vs organic content? The Ad Library surfaces are all-ads, so
  // this only gates the IG / TikTok / FB FEED. Meta obfuscates the "Sponsored" label, so we also treat
  // a classic ad CTA or an outbound-ad link as an ad signal. Errs toward NOT injecting on organic posts.
  const CTA_RE = /\b(Shop now|Learn more|Sign up|Download|Get offer|Order now|Book now|Buy now|Install now|Contact us|Send message|Apply now|Get quote|Subscribe|Get tickets|Play game|Watch more|See menu|Donate now)\b/i
  function looksLikeAd(scope) {
    try {
      const art = scope.closest?.('article') || scope
      const txt = (art.innerText || '').slice(0, 4000)
      if (/\bSponsored\b/i.test(txt)) return true
      if (art.querySelector('[aria-label*="Sponsored" i], a[href*="l.facebook.com"], a[href*="l.instagram.com"], a[href*="/ads/"]')) return true
      if (CTA_RE.test(txt)) return true
      return false
    } catch { return false }
  }
  function cardFromLabel(label, minSize = 240) {
    let el = label
    for (let i = 0; i < 12 && el; i++) {
      el = el.parentElement
      if (el && (el.querySelector('img') || el.querySelector('video'))) {
        const r = el.getBoundingClientRect()
        if (r.width > minSize && r.height > minSize) return el
      }
    }
    return null
  }

  function scan() {
    if (IS_FB_ADLIB) {
      for (const label of document.querySelectorAll('span, div')) {
        const txt = label.textContent || ''
        if (txt.length > 40 || !/Library ID/i.test(txt) || label.children.length > 1) continue
        addCardButton(cardFromLabel(label), 'prepend')
      }
    } else if (IS_TT_ADLIB) {
      for (const label of document.querySelectorAll('span, div')) {
        const txt = label.textContent || ''
        if (txt.length > 24 || !/First shown|Last shown/i.test(txt) || label.children.length > 1) continue
        addCardButton(cardFromLabel(label, 180), 'prepend')
      }
    } else if (IS_IG) {
      for (const art of document.querySelectorAll('article')) {
        const r = art.getBoundingClientRect()
        // Only inject on SPONSORED posts — organic posts/reels get no button (they're not ads and
        // their blob video can't be saved anyway).
        if (r.width > 260 && (art.querySelector('img') || art.querySelector('video')) && looksLikeAd(art)) addCardButton(art, 'append')
      }
    } else if (IS_TT_FEED) {
      for (const v of document.querySelectorAll('video')) {
        const container = v.closest('[class*="DivItemContainer"], [class*="DivContainer"], article, div[data-e2e]') || v.parentElement
        if (container) { const r = container.getBoundingClientRect(); if (r.width > 200 && r.height > 200 && looksLikeAd(container)) addCardButton(container, 'prepend') }
      }
    }
  }

  // ── Hover button + floating button ──────────────────────────────────────────
  function setupHover() {
    // Hover Save button — only on supported ad surfaces. On YouTube/other sites it was popping up over
    // every thumbnail as you moused around while scrolling. The static FAB below stays for manual saves.
    if (SUPPORTED) {
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
      let el = e.target
      // Direct media hover (IG/TikTok/most sites).
      if (el instanceof HTMLImageElement || el instanceof HTMLVideoElement) { clearTimeout(hideT); showFor(el); return }
      // FB puts a click overlay ON TOP of the creative, so the hover target is a div/anchor — look for
      // the media inside a nearby container so the Save button still appears over FB feed ads.
      if (el instanceof Element) {
        const box = el.closest('[role="article"], article, [data-ad-preview], [aria-label]') || el.parentElement
        const media = box && biggestMediaIn(box)
        if (media) { clearTimeout(hideT); showFor(media) }
      }
    }, true)
    document.addEventListener('mouseout', (e) => {
      if (e.target === btn || (e.target instanceof Element && e.target.closest('.sm-save-btn'))) return
      scheduleHide()
    }, true)
    btn.addEventListener('mouseover', () => clearTimeout(hideT))
    btn.addEventListener('mouseout', scheduleHide)
    btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); if (target) doSave(target, document, btn, { saving: '<span class="sm-ico">…</span> Saving', done: '✓ Saved' }, { revert: true }) })
    }

    const fab = document.createElement('button')
    fab.className = 'sm-fab'
    fab.title = 'Save the main media on this page to Selfmade · drag to move'
    fab.innerHTML = '<img src="' + chrome.runtime.getURL('icons/icon48.png') + '" alt=""/>'
    document.documentElement.appendChild(fab)

    // Restore a user-chosen position (persisted), so it stays clear of a site's chat widget.
    try {
      const saved = JSON.parse(localStorage.getItem('sm_fab_pos') || 'null')
      if (saved && typeof saved.left === 'number' && typeof saved.top === 'number') {
        fab.style.left = saved.left + 'px'; fab.style.top = saved.top + 'px'
        fab.style.right = 'auto'; fab.style.bottom = 'auto'
      }
    } catch { /* ignore */ }

    // Draggable, with a click/drag threshold so a normal click still saves.
    let down = null, moved = false
    const onMove = (e) => {
      if (!down) return
      const dx = e.clientX - down.x, dy = e.clientY - down.y
      if (!moved && Math.hypot(dx, dy) < 5) return          // below threshold → still a click
      moved = true; fab.classList.add('sm-dragging')
      const w = fab.offsetWidth, h = fab.offsetHeight
      const left = Math.min(Math.max(0, down.left + dx), window.innerWidth - w)
      const top = Math.min(Math.max(0, down.top + dy), window.innerHeight - h)
      fab.style.left = left + 'px'; fab.style.top = top + 'px'; fab.style.right = 'auto'; fab.style.bottom = 'auto'
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp)
      if (moved) {
        fab.classList.remove('sm-dragging')
        try { localStorage.setItem('sm_fab_pos', JSON.stringify({ left: fab.offsetLeft, top: fab.offsetTop })) } catch { /* ignore */ }
      }
      down = null
    }
    fab.addEventListener('mousedown', (e) => {
      const r = fab.getBoundingClientRect()
      down = { x: e.clientX, y: e.clientY, left: r.left, top: r.top }; moved = false
      document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp)
    })
    fab.addEventListener('click', (e) => {
      if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; return }   // was a drag, not a click
      const el = biggestMediaIn(document)
      if (el) doSave(el, document, fab, { saving: '…', done: '✓' }, { revert: true })
      else toast('No image or video found here', false)
    })
  }

  // ── Boot ────────────────────────────────────────────────────────────────────
  // Only run Selfmade's save UI on supported ad surfaces — nothing on YouTube/arbitrary sites.
  if (SUPPORTED) setupHover()
  if (IS_FB_ADLIB || IS_TT_ADLIB || IS_IG || IS_TT_FEED) {
    scan()
    const obs = new MutationObserver(() => { clearTimeout(window.__smT); window.__smT = setTimeout(scan, 350) })
    obs.observe(document.body, { childList: true, subtree: true })
  }
})()
