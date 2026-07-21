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

  // Facebook's *management* surfaces (Ads Manager, Business Suite, Developers) are where you BUILD ads,
  // not view them — the Save button trailing over the campaign builder / audience panels was pure noise
  // ("this save button is everywhere on facebook, moves with scroll"). Never run there.
  const IS_FB_TOOLS =
    HOST.startsWith('adsmanager.') || HOST.startsWith('business.') || HOST.startsWith('developers.') ||
    location.pathname.startsWith('/adsmanager') || location.pathname.startsWith('/business') ||
    location.pathname.startsWith('/latest/') // Business Suite
  if (IS_FB_TOOLS) return

  const IS_FB_ADLIB = HOST.includes('facebook.com') && location.pathname.includes('/ads/library')
  const IS_FB_REEL = HOST.includes('facebook.com') && location.pathname.startsWith('/reel/')  // full-screen reel viewer
  const IS_FB_FEED = HOST.includes('facebook.com') && !IS_FB_ADLIB && !IS_FB_REEL   // the plain FB feed (sponsored posts)
  const IS_TT_ADLIB = HOST.includes('library.tiktok.com')
  const IS_TT_FEED = HOST.includes('tiktok.com') && !IS_TT_ADLIB
  const IS_IG = HOST.includes('instagram.com')
  const IS_YT = HOST.includes('youtube.com')   // YouTube Shorts / watch — hover save card (Denote-style)
  // Ad surfaces we actually support. The hover Save button only runs here — otherwise it popped up on
  // EVERY thumbnail on media sites like YouTube ("Save button everywhere when I scroll").
  const SUPPORTED = HOST.includes('facebook.com') || IS_IG || IS_TT_ADLIB || IS_TT_FEED
  // Surfaces where we inject a per-CARD Save button (Atria-style). There, the floating hover button
  // is redundant + annoying (it trails the mouse "everywhere"). Hover/FAB are only for the plain
  // Facebook FEED, which has no per-card buttons.
  // FB FEED now gets per-card buttons too (was only the FAB, which grabbed the page's biggest media →
  // saved the wrong ad + re-saves overwrote the same dedupe key). Per-card captures each ad's OWN media.
  const HAS_CARDS = IS_FB_ADLIB || IS_FB_FEED || IS_TT_ADLIB || IS_IG || IS_TT_FEED
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
  // Instagram streams reels/videos via an MSE blob: URL that can't be downloaded. The REAL fbcdn MP4
  // is embedded in the page's JSON — resolve it so Download + Save get the actual video (this is how
  // download extensions do it "flawlessly"). Best-effort: returns '' if not found.
  function resolveIgVideoUrl() {
    try {
      const og = document.querySelector('meta[property="og:video"], meta[property="og:video:secure_url"]')?.getAttribute('content') || ''
      if (/^https?:\/\/.+\.mp4/i.test(og)) return og
      const unesc = (u) => u.replace(/\\u0026/g, '&').replace(/\\\//g, '/').replace(/\\u003D/gi, '=')
      for (const s of document.querySelectorAll('script[type="application/json"], script:not([src])')) {
        const t = s.textContent || ''
        if (t.indexOf('video_versions') < 0 && t.indexOf('video_url') < 0) continue
        const m = t.match(/"video_versions":\s*\[\s*\{[^}]*?"url":"([^"]+?\.mp4[^"]*?)"/) || t.match(/"video_url":"([^"]+?\.mp4[^"]*?)"/)
        if (m && m[1]) return unesc(m[1])
      }
    } catch {}
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
  // The FAB should save the ad the user is LOOKING AT — the largest media in the viewport, closest to
  // centre — not the biggest media on the whole page (which was always the same ad → wrong save + the
  // same dedupe key → overwrote the previous save).
  function biggestVisibleMedia() {
    const vw = window.innerWidth, vh = window.innerHeight, cx = vw / 2, cy = vh / 2
    let best = null, bestScore = 0
    const consider = (el) => {
      const r = el.getBoundingClientRect()
      const visW = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0))
      const visH = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0))
      const visArea = visW * visH
      if (visArea < MIN * MIN) return
      const dist = Math.hypot((r.left + r.right) / 2 - cx, (r.top + r.bottom) / 2 - cy)
      const score = visArea / (1 + dist)     // large + centred wins
      if (score > bestScore) { best = el; bestScore = score }
    }
    document.querySelectorAll('img, video').forEach(consider)
    if (!best) document.querySelectorAll('div, a, span').forEach((el) => { if (bgUrl(el)) consider(el) })
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

  // Last-resort creative grab: draw the current frame of a <video> to a canvas → data URL. Handles
  // FB/IG feed video ads that stream via blob: with NO poster and no sibling <img> (the exact case
  // that used to fail with "Could not read that media"). Same-origin blob frames aren't canvas-tainted;
  // a cross-origin taint throws and we fall through gracefully.
  function captureFrame(video) {
    try {
      if (!(video instanceof HTMLVideoElement)) return null
      const w = video.videoWidth, h = video.videoHeight
      if (!w || !h) return null
      const c = document.createElement('canvas')
      c.width = w; c.height = h
      c.getContext('2d').drawImage(video, 0, 0, w, h)
      return c.toDataURL('image/jpeg', 0.85)
    } catch { return null }
  }
  function findVideoIn(el, scope) {
    if (el instanceof HTMLVideoElement) return el
    const box = (el && el.closest && el.closest('[role="article"], article, [data-ad-preview]')) || scope || document
    return (box.querySelector && box.querySelector('video')) || null
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
    // A caller can force the media URL (e.g. YouTube, where the <video> is a stream but we save the
    // thumbnail). Otherwise read it off the element.
    let { url, type } = opts.forceUrl ? { url: opts.forceUrl, type: opts.forceType || 'image' } : mediaUrl(mediaEl)
    // IG reels stream via a blob: MSE URL. Pull the REAL fbcdn MP4 out of the page JSON so we save a
    // TRUE video (shows as video + enables video remake), instead of only the poster frame.
    if (IS_IG && (type === 'video' || mediaEl instanceof HTMLVideoElement) && (!url || url.startsWith('blob:'))) {
      const real = resolveIgVideoUrl()
      if (real) { url = real; type = 'video' }
    }
    // Still a blob/again video with no direct src → save its poster frame (image) so the save works and
    // the card shows the creative. The permalink (below) is how the user watches the real video.
    if (!url || (type === 'video' && url.startsWith('blob:'))) {
      const poster = findPoster(mediaEl)
      if (poster) { url = poster; type = 'image' }
    }
    // Still no fetchable URL (posterless blob video — the FB/IG feed case) → capture the current
    // video frame off a canvas so the save works instead of erroring "Could not read that media".
    let capturedFrame = null
    if (!url || url.startsWith('blob:')) {
      const frame = captureFrame(findVideoIn(mediaEl, scope))
      if (frame) { capturedFrame = frame; type = 'image'; if (url.startsWith('blob:')) url = '' }
    }
    if (!url && !capturedFrame) { toast('Could not read that media — try the ＋Save on the ad itself', false); return }
    busy = true
    const restore = btn.innerHTML
    btn.innerHTML = labels.saving
    btn.classList.add('sm-busy')
    const m = meta(scope || document)
    const image_data = capturedFrame || (type === 'image' ? await toDataURL(url) : null)
    // Was the ORIGINAL creative a video? (FB/IG feed videos stream via blob → we can only save the
    // poster image, so media_type ends up 'image'. Flag it so the app can label it + point the user
    // to Discovery for a true video remake.)
    const was_video = (mediaEl instanceof HTMLVideoElement) || type === 'video' || !!capturedFrame ||
      !!(scope && scope !== document && scope.querySelector && scope.querySelector('video'))
    const payload = {
      // media_url = the REAL media file only. Do NOT fall back to the page URL: on the FB feed every ad
      // shares the same location.href, and the server hashed (source_url|media_url) into the dedup id →
      // every saved feed video collapsed onto ONE row (each save overwrote the last). Leave it empty for
      // blob/feed videos; the captured frame (image_data) is what identifies + shows the ad.
      media_url: (url && !url.startsWith('blob:')) ? url : undefined, media_type: capturedFrame ? 'image' : type, image_data,
      source_url: m.permalink || location.href, source_platform: m.platform, was_video,
      brand: m.brand || undefined, ad_copy: m.ad_copy || undefined,
      board_id: opts.boardId || undefined,   // chosen in the in-post board picker (else background falls back to the default board)
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

  // ── Instagram in-post board picker (Denote-style) ──────────────────────────
  // On an open IG post/reel, drop a clean card into the RIGHT column: pick a board → Save, or Download.
  let BOARDS = null, boardsLoading = false
  // Fill EVERY board <select> on the page once the list arrives — the Ad Library mounts one card per
  // ad, and the old code filled only the ONE select that triggered the fetch (all the rest stayed stuck
  // on "Loading boards…"). One fetch, then populate them all; late-mounting cards read the cache.
  function fillAllBoards() { document.querySelectorAll('.sm-ig-select').forEach((s) => fillBoards(s)) }
  function loadBoards(sel) {
    if (BOARDS) { fillBoards(sel); return }
    if (boardsLoading) return   // a fetch is already in flight — it will fill ALL selects (incl. this one) when it lands
    boardsLoading = true
    try {
      chrome.runtime.sendMessage({ type: 'getBoards' }, (resp) => {
        boardsLoading = false
        // Service worker was asleep / transient error → retry shortly so we don't sit on "Loading…".
        if (chrome.runtime.lastError) { setTimeout(() => loadBoards(sel), 1500); return }
        if (resp && resp.ok === false) {   // not signed in — prompt, and let a later card retry
          document.querySelectorAll('.sm-ig-select').forEach((s) => { s.innerHTML = '<option value="">Sign in to Selfmade first</option>' })
          return
        }
        BOARDS = Array.isArray(resp?.boards) ? resp.boards : []
        fillAllBoards()
      })
    } catch { boardsLoading = false; setTimeout(() => loadBoards(sel), 1500) }
  }
  function fillBoards(sel) {
    if (!sel || !BOARDS) return
    const last = (() => { try { return localStorage.getItem('sm_board') || '' } catch { return '' } })()
    if (!BOARDS.length) { sel.innerHTML = '<option value="">No boards yet — saves to your default</option>'; return }
    sel.innerHTML = '<option value="">Select a board (optional)</option>' +
      BOARDS.map((b) => `<option value="${b.id}">${(b.emoji ? b.emoji + ' ' : '') + String(b.name || 'Board').replace(/</g, '')}</option>`).join('')
    if (last && BOARDS.some((b) => b.id === last)) sel.value = last
  }

  // Find the info/right column of an open IG post so the card sits like Denote's (under the header).
  function igInfoColumn(art) {
    const userLink = [...art.querySelectorAll('a[href^="/"]')].find((a) => /^\/[A-Za-z0-9._]+\/$/.test(a.getAttribute('href') || '') && (a.textContent || '').trim())
    if (!userLink) return null
    let header = userLink
    for (let i = 0; i < 10 && header.parentElement && header.parentElement !== art; i++) {
      const p = header.parentElement
      const pr = p.getBoundingClientRect(), ar = art.getBoundingClientRect()
      // stop at the header row: a block narrower than the whole article (i.e. inside the right column)
      if (p.childElementCount >= 1 && pr.width > 180 && pr.width < ar.width * 0.75) { header = p; break }
      header = p
    }
    return { col: header.parentElement || art, header }
  }

  // ── Reusable Denote-style save card (board dropdown + Save + optional Download). Used on IG posts,
  // the FB/TikTok Ad Libraries, and YouTube Shorts. getMedia() returns the media element to save. ──
  function buildSaveCard(getMedia, scope, o = {}) {
    const showDl = o.showDownload !== false
    const card = document.createElement('div')
    card.className = 'sm-ig-card' + (o.overlay ? ' sm-ig-overlay' : '')
    card.innerHTML =
      '<div class="sm-ig-brandrow"><img class="sm-ig-logo" src="' + chrome.runtime.getURL('icons/icon48.png') + '" alt=""/><span>Save to Selfmade</span></div>' +
      '<select class="sm-ig-select"><option value="">Loading boards…</option></select>' +
      '<div class="sm-ig-actions">' +
      '<button class="sm-ig-save" type="button">＋ Save to Selfmade</button>' +
      (showDl ? '<button class="sm-ig-dl" type="button" title="Download this media">⤓ Download</button>' : '') +
      '</div>'
    const stop = (e) => { e.stopPropagation() }
    card.addEventListener('click', stop); card.addEventListener('mousedown', stop)
    const sel = card.querySelector('.sm-ig-select')
    const saveBtn = card.querySelector('.sm-ig-save')
    const dlBtn = card.querySelector('.sm-ig-dl')
    loadBoards(sel)
    sel.addEventListener('change', () => { try { localStorage.setItem('sm_board', sel.value) } catch {} })
    saveBtn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation()
      const m = getMedia()
      if (m) doSave(m, scope, saveBtn, { saving: 'Saving…', done: '✓ Saved' }, { revert: true, boardId: sel.value || undefined, forceUrl: o.forceUrl && o.forceUrl(), forceType: o.forceType })
      else toast('No media found here', false)
    })
    if (dlBtn) dlBtn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation()
      const m = getMedia()
      const isVid = (m instanceof HTMLVideoElement) || mediaUrl(m).type === 'video'
      let url = (isVid && o.resolveVideo) ? o.resolveVideo() : ''
      if (!url) { const mu = mediaUrl(m); url = (mu.url && !mu.url.startsWith('blob:')) ? mu.url : (findPoster(m) || '') }
      if (!url) { toast('Couldn’t find a downloadable file here', false); return }
      const filename = 'selfmade-' + Date.now() + (/\.mp4/i.test(url) ? '.mp4' : '.jpg')
      const orig = dlBtn.textContent; dlBtn.textContent = '⤓ Saving…'
      chrome.runtime.sendMessage({ type: 'download', url, filename }, (resp) => {
        dlBtn.textContent = orig
        if (chrome.runtime.lastError || !resp?.ok) { try { window.open(url, '_blank') } catch {}; toast('Opened in a new tab — right-click → Save', false) }
        else toast('✓ Downloaded')
      })
    })
    return card
  }

  function mountIgCard() {
    if (!IS_IG) return
    for (const art of document.querySelectorAll('article')) {
      if (art.querySelector('.sm-ig-card')) continue
      const media = art.querySelector('video, img')
      const ar = art.getBoundingClientRect()
      if (!media || ar.width < 520 || ar.height < 300) continue   // only the big opened post, not feed thumbs
      const info = igInfoColumn(art)
      if (!info) continue
      const card = buildSaveCard(() => biggestMediaIn(art) || media, art, { resolveVideo: resolveIgVideoUrl, showDownload: true })
      try { info.col.insertBefore(card, info.header.nextSibling) } catch { info.col.insertBefore(card, info.col.firstChild) }
    }
  }

  // FB / TikTok Ad Library: put the full card (board + Save + Download) at the top of each ad card.
  function mountAdLibCard(cardEl) {
    if (!cardEl || cardEl.dataset.smFull || cardEl.querySelector('.sm-ig-card')) return
    if (cardEl.closest('[data-sm-full]')) return
    cardEl.dataset.smFull = '1'
    const card = buildSaveCard(() => biggestMediaIn(cardEl), cardEl, { resolveVideo: null, showDownload: true })
    card.style.margin = '0 0 8px'
    if (getComputedStyle(cardEl).position === 'static') cardEl.style.position = 'relative'
    cardEl.insertBefore(card, cardEl.firstChild)
  }

  // YouTube Shorts / watch: a hover overlay card on the player (Denote-style). Save uses the video's
  // thumbnail (YT streams the video, so no direct download — matches Denote, which offers Save only).
  function ytThumb() {
    const m = location.pathname.match(/\/shorts\/([\w-]{6,})/) || location.search.match(/[?&]v=([\w-]{6,})/)
    return m ? `https://i.ytimg.com/vi/${m[1]}/maxresdefault.jpg` : (document.querySelector('meta[property="og:image"]')?.getAttribute('content') || '')
  }
  const ytIsShorts = () => /\/shorts\//.test(location.pathname)
  // YouTube flags an in-stream (pre/mid/post-roll) AD by adding `ad-showing` to the player element.
  // That's the ONLY way to tell an ad from organic content — the URL still holds the main video's id.
  const ytAdPlayer = () => document.querySelector('#movie_player.ad-showing, .html5-video-player.ad-showing')
  function mountYtCard() {
    if (!IS_YT) return
    // ONLY Shorts + real YouTube ads — never organic watch pages (a 28-min video is not an ad).
    if (ytIsShorts()) {
      for (const p of document.querySelectorAll('ytd-reel-video-renderer, #shorts-player')) {
        const r = p.getBoundingClientRect()
        if (r.width < 200 || r.height < 200) continue
        if (p.querySelector('.sm-yt-host')) continue
        const host = document.createElement('div'); host.className = 'sm-yt-host'
        const card = buildSaveCard(() => p.querySelector('video'), p, { showDownload: false, overlay: true, forceUrl: ytThumb, forceType: 'image' })
        host.appendChild(card)
        if (getComputedStyle(p).position === 'static') p.style.position = 'relative'
        p.appendChild(host)
      }
      return
    }
    // Watch page: show ONLY while an ad is actually playing; remove it the instant the ad ends. The ad's
    // own thumbnail isn't in the URL (that's the main video), so we capture the current frame instead.
    const adPlayer = ytAdPlayer()
    if (!adPlayer) { document.querySelectorAll('.sm-yt-host').forEach((h) => h.remove()); return }
    const r = adPlayer.getBoundingClientRect()
    if (r.width < 200 || r.height < 200 || adPlayer.querySelector('.sm-yt-host')) return
    const host = document.createElement('div'); host.className = 'sm-yt-host'
    const card = buildSaveCard(() => adPlayer.querySelector('video'), adPlayer, { showDownload: false, overlay: true, forceType: 'image' })
    host.appendChild(card)
    if (getComputedStyle(adPlayer).position === 'static') adPlayer.style.position = 'relative'
    adPlayer.appendChild(host)
  }

  // Facebook Reels viewer (facebook.com/reel/…): a full-screen player, no feed articles — so the feed
  // scan never mounts here (only Denote's card showed). Drop an overlay save card on the reel's own
  // video, the same way we do for YouTube Shorts. Captures the current frame (reel MP4s aren't fetchable).
  function mountFbReelCard() {
    if (!IS_FB_REEL) return
    let best = null, bestArea = 0
    for (const v of document.querySelectorAll('video')) {
      const r = v.getBoundingClientRect()
      const a = r.width * r.height
      if (a > bestArea && r.width > 200 && r.height > 260) { best = v; bestArea = a }   // reels are tall
    }
    if (!best) return
    // Walk up to a container roughly the video's size (a stable overlay anchor, not a tiny wrapper).
    let holder = best
    for (let i = 0; i < 4 && holder.parentElement; i++) {
      const pr = holder.parentElement.getBoundingClientRect()
      if (pr.width >= best.getBoundingClientRect().width * 0.9) { holder = holder.parentElement; break }
      holder = holder.parentElement
    }
    if (holder.querySelector('.sm-yt-host')) return
    const host = document.createElement('div'); host.className = 'sm-yt-host'
    const card = buildSaveCard(() => best, holder, { showDownload: false, overlay: true, forceType: 'image' })
    host.appendChild(card)
    if (getComputedStyle(holder).position === 'static') holder.style.position = 'relative'
    holder.appendChild(host)
  }

  function scan() {
    if (IS_IG) mountIgCard()   // Denote-style in-post board picker (works on organic posts too, not just ads)
    if (IS_YT) mountYtCard()   // YouTube Shorts + ads only
    if (IS_FB_REEL) mountFbReelCard()   // FB Reels viewer — overlay save card on the reel
    if (IS_FB_ADLIB) {
      for (const label of document.querySelectorAll('span, div')) {
        const txt = label.textContent || ''
        if (txt.length > 40 || !/Library ID/i.test(txt) || label.children.length > 1) continue
        mountAdLibCard(cardFromLabel(label))
      }
    } else if (IS_TT_ADLIB) {
      for (const label of document.querySelectorAll('span, div')) {
        const txt = label.textContent || ''
        if (txt.length > 24 || !/First shown|Last shown/i.test(txt) || label.children.length > 1) continue
        mountAdLibCard(cardFromLabel(label, 180))
      }
    } else if (IS_IG) {
      for (const art of document.querySelectorAll('article')) {
        const r = art.getBoundingClientRect()
        // Only inject on SPONSORED posts — organic posts/reels get no button (they're not ads and
        // their blob video can't be saved anyway).
        if (r.width > 260 && (art.querySelector('img') || art.querySelector('video')) && looksLikeAd(art)) addCardButton(art, 'append')
      }
    } else if (IS_FB_FEED) {
      // One Save button per SPONSORED post — captures THAT ad's own media (fixes the FAB saving the
      // wrong ad / overwriting). FB feed posts are [role="article"] blocks.
      for (const art of document.querySelectorAll('[role="article"]')) {
        const r = art.getBoundingClientRect()
        if (r.width > 260 && r.height > 180 && (art.querySelector('img') || art.querySelector('video') || biggestMediaIn(art)) && looksLikeAd(art)) addCardButton(art, 'append')
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
    // Hover Save button — ONLY on supported surfaces that don't already have per-card buttons (the FB
    // feed). On the Ad Library / IG / TikTok it trailed the mouse everywhere. The static FAB below is
    // created on ALL supported surfaces as a reliable fallback (esp. IG, where per-card detection
    // misses some ads) — it's one fixed, movable button, not a trailing one.
    if (SUPPORTED && !HAS_CARDS) {
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
      if (!(el instanceof Element)) return
      // This hover button only ever runs on the Facebook feed (Ad Library / IG / TikTok use per-card
      // buttons). Only offer Save over a SPONSORED post — NOT over friends' photos, Marketplace, groups,
      // profile pics or any organic image. That over-showing (a Save button popping up on every image
      // and trailing the cursor) was the "save button everywhere / moves with scroll" bug.
      const box = el.closest('[role="article"], article, [data-ad-preview]')
      if (!box || !looksLikeAd(box)) return
      // FB paints the creative as an <img>/<video>, or as a background-image div under a click overlay.
      const media = (el instanceof HTMLImageElement || el instanceof HTMLVideoElement) ? el : biggestMediaIn(box)
      if (media) { clearTimeout(hideT); showFor(media) }
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
      const el = biggestVisibleMedia() || biggestMediaIn(document)
      // Save the ad's whole card as scope (so brand/caption/permalink come from the right post),
      // not the entire document.
      const scope = (el && el.closest && el.closest('[role="article"], article, [data-ad-preview]')) || document
      if (el) doSave(el, scope, fab, { saving: '…', done: '✓' }, { revert: true })
      else toast('No image or video found here', false)
    })
  }

  // ── Boot ────────────────────────────────────────────────────────────────────
  // Hover button + FAB only on supported surfaces that DON'T already get per-card buttons (i.e. the
  // plain Facebook feed). On the Ad Library / IG / TikTok the per-card buttons are the UX, so the
  // trailing hover button is suppressed. Nothing at all runs on YouTube/arbitrary sites.
  if (SUPPORTED) setupHover()
  if (IS_FB_ADLIB || IS_FB_FEED || IS_FB_REEL || IS_TT_ADLIB || IS_IG || IS_TT_FEED || IS_YT) {
    scan()
    const obs = new MutationObserver(() => { clearTimeout(window.__smT); window.__smT = setTimeout(scan, 350) })
    obs.observe(document.body, { childList: true, subtree: true })
    // YouTube ad start/end toggles a CLASS (attribute), which childList observation can miss — and during
    // playback the DOM is quiet. A 1s poll reliably shows the card when an ad starts and removes it when
    // it ends. Cheap: mountYtCard is one querySelector when there's no ad.
    if (IS_YT) setInterval(mountYtCard, 1000)
    if (IS_FB_REEL) setInterval(mountFbReelCard, 1000)   // reels swap via SPA nav — poll to re-mount
  }
})()
