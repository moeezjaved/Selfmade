/**
 * Publish a built page to Shopify as NATIVE Online Store 2.0 sections + a JSON template — so it replaces
 * the real product PDP / store home (not a standalone /pages blob), and the merchant can reorder,
 * duplicate, or delete each section inside Shopify's own theme customizer (Atlas-style).
 *
 * How it works:
 *   1. Split the page body (our `.pgbld` HTML) into top-level SECTIONS. Each slice is re-wrapped in the
 *      `.pgbld`(/`.wrap`) context it needs so the shared CSS still applies, making every section
 *      self-contained and safely reorderable.
 *   2. Emit one shared CSS asset (assets/…css) — each section loads it via {{ … | stylesheet_tag }},
 *      deduped by URL, so it survives reorder/removal.
 *   3. Emit one `.liquid` section file per slice, each with a {% schema %} so it appears (named) in the
 *      customizer with move/duplicate/remove.
 *   4. Emit a JSON template listing the sections in order (templates/product.<suffix>.json /
 *      templates/index.json / templates/page.<suffix>.json).
 *
 * Assigning the template + choosing which products it covers lives in publish-theme.ts.
 */

const FONT_IMPORT = "@import url('https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');\n"

export type PageKind = 'product' | 'home' | 'advertorial' | 'listicle'
export type PageSection = { key: string; name: string; html: string }
export type ThemeAssets = {
  cssKey: string
  cssValue: string
  sections: { key: string; value: string }[]   // sections/<key>.liquid
  templateKey: string                            // templates/…json
  templateValue: string
  sectionOrder: string[]                         // section ids used in the JSON template
}

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])

/** Return the innerHTML of the first element matching `class` (single class, top-level scan). */
function innerOf(html: string, className: string): { inner: string; start: number; end: number } | null {
  const open = new RegExp(`<(\\w+)([^>]*\\bclass=["'][^"']*\\b${className}\\b[^"']*["'][^>]*)>`, 'i')
  const m = open.exec(html)
  if (!m) return null
  const tag = m[1].toLowerCase()
  let i = m.index + m[0].length
  const innerStart = i
  let depth = 1
  const tagRe = new RegExp(`<(/?)(${tag})\\b[^>]*?(/?)>`, 'gi')
  tagRe.lastIndex = i
  let t: RegExpExecArray | null
  while ((t = tagRe.exec(html))) {
    if (t[3] === '/' || VOID.has(t[2].toLowerCase())) continue
    if (t[1] === '/') { depth--; if (depth === 0) return { inner: html.slice(innerStart, t.index), start: innerStart, end: t.index } }
    else depth++
  }
  return null
}

/** Split a container's inner HTML into its TOP-LEVEL element children (depth-aware, no DOM lib). */
function topLevelChildren(inner: string): string[] {
  const out: string[] = []
  const tagRe = /<(\/?)([a-zA-Z][\w-]*)\b[^>]*?(\/?)>/g
  let depth = 0, startIdx = -1, m: RegExpExecArray | null
  while ((m = tagRe.exec(inner))) {
    const closing = m[1] === '/', selfClose = m[3] === '/' || VOID.has(m[2].toLowerCase())
    if (!closing && selfClose) { if (depth === 0) out.push(inner.slice(m.index, m.index + m[0].length)); continue }
    if (closing) { depth--; if (depth === 0 && startIdx >= 0) { out.push(inner.slice(startIdx, m.index + m[0].length)); startIdx = -1 } }
    else { if (depth === 0) startIdx = m.index; depth++ }
  }
  return out.filter((s) => s.trim())
}

const stripMd = (s: string) => String(s || '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*/g, '').trim()

/** A human name for a section, inferred from its content so the customizer list is readable. */
function nameFor(html: string, i: number): string {
  const cls = /class=["']([^"']+)["']/.exec(html)?.[1] || ''
  const h = stripMd(/<h[1-3][^>]*>([^<]{2,60})/i.exec(html.replace(/<span[^>]*>|<\/span>/g, ''))?.[1]?.trim() || '')
  if (/\bhero\b/.test(cls)) return 'Hero'
  if (/\bfloatcta\b/.test(cls)) return 'Sticky buy bar'
  if (/\b(faqacc|faq)\b/.test(cls)) return 'FAQ'
  if (/\b(revs|gcar|testimonial)\b/.test(cls) || /review|customer/i.test(h || '')) return 'Reviews'
  if (/\b(cmp|compare)\b/.test(cls)) return 'Comparison'
  if (/\b(stats|statgrid)\b/.test(cls)) return 'Stats'
  if (/\b(trio|transband|transform)\b/.test(cls)) return 'Transformation'
  if (/\b(bgrid|benefit)\b/.test(cls)) return 'Benefits'
  return h ? h.slice(0, 40) : `Section ${i + 1}`
}

/**
 * Split the page body into self-contained sections. Each slice is re-wrapped so the shared CSS applies:
 *   • a child of `.wrap`  → `<div class="pgbld"><div class="wrap">…</div></div>`  (contained width)
 *   • a full-bleed band (direct child of `.pgbld`, e.g. a gradient band) → `<div class="pgbld">…</div>`
 */
export function splitPageIntoSections(body: string): PageSection[] {
  const pg = innerOf(body, 'pgbld')
  if (!pg) return [{ key: 'sf-1', name: 'Page', html: body }]   // fallback: whole thing as one section
  const kids = topLevelChildren(pg.inner)
  const slices: { html: string; contained: boolean }[] = []
  for (const kid of kids) {
    const isWrap = /^<\w+[^>]*\bclass=["'][^"']*\bwrap\b/.test(kid)
    if (isWrap) {
      const wi = innerOf(kid, 'wrap')
      if (wi) { for (const inner of topLevelChildren(wi.inner)) slices.push({ html: inner, contained: true }); continue }
    }
    slices.push({ html: kid, contained: false })
  }
  return slices.map((s, i) => ({
    key: `sf-${i + 1}`,
    name: nameFor(s.html, i),
    html: s.contained ? `<div class="pgbld"><div class="wrap">${s.html}</div></div>` : `<div class="pgbld">${s.html}</div>`,
  }))
}

// ── Dynamic product Liquid ────────────────────────────────────────────────────────────────────────
// On a PRODUCT template each section renders with a live `product` object. We rewrite the buy-box bits so
// each product shows its OWN data + a working Add-to-Cart:
//   'cart' (single product) → keep the built copy/images, but wire a real cart form.
//   'full' (all products)   → also swap title / price / featured image to {{ product.* }} so every product
//                             renders its own.
export type DynamicMode = 'none' | 'cart' | 'full'

// A proper Shopify product form: per-option pickers (Size / Colour / …), a quantity stepper, and a real
// Add-to-Cart. A scoped script resolves the chosen variant id and updates the live price + availability;
// it is no-JS-safe (the hidden id defaults to the first available variant). `withOptions=false` for the
// slim sticky bar (id + qty only).
// Native-style variant picker: option values render as pills (colour options get a swatch dot). Clicking a
// pill resolves the matching variant → sets the hidden id, updates the live price + sold-out state, and
// switches the gallery to that variant's image. No-JS-safe (hidden id defaults to the first available variant).
const FORM_JS = `<script>(function(){var f=document.currentScript.closest('form');if(!f)return;var vid=f.querySelector('[data-sf-vid]');var dataEl=f.querySelector('[data-sf-vdata]');if(!vid||!dataEl)return;var variants;try{variants=JSON.parse(dataEl.textContent);}catch(e){return;}var rows=[].slice.call(f.querySelectorAll('.sf-optrow'));var priceEl=document.querySelector('[data-sf-price]');var btn=f.querySelector('button[name=add]');var cur=(window.Shopify&&Shopify.currency&&Shopify.currency.active)||'USD';function chosen(){return rows.map(function(r){var on=r.querySelector('.sf-pill.on');return on?on.getAttribute('data-value'):null;});}function fits(v,c){var o=v.options||[];for(var i=0;i<c.length;i++){if(c[i]!=null&&o[i]!==c[i])return false;}return true;}function match(){var c=chosen();return variants.filter(function(v){return fits(v,c);})[0]||variants[0];}function switchImg(v){if(!v||!v.featured_image||!v.featured_image.src)return;var tr=document.querySelector('.gtrack');if(!tr)return;var t=v.featured_image.src.split('?')[0].split('/').pop();var s=tr.children;for(var i=0;i<s.length;i++){var im=s[i].querySelector('img');if(im){var fn=(im.getAttribute('src')||'').split('?')[0].split('/').pop();if(fn===t){tr.scrollTo({left:i*tr.clientWidth,behavior:'smooth'});break;}}}}function refreshAvail(){var c=chosen();rows.forEach(function(r,ri){[].slice.call(r.querySelectorAll('.sf-pill')).forEach(function(p){var t=c.slice();t[ri]=p.getAttribute('data-value');var ok=variants.some(function(v){return v.available&&fits(v,t);});p.classList.toggle('sf-soldout',!ok);});});}function fillSwatches(){[].slice.call(f.querySelectorAll('.sf-dot[data-sw]')).forEach(function(d){if(d.style.backgroundImage)return;var val=d.getAttribute('data-sw');var vv=variants.filter(function(v){return (v.options||[]).indexOf(val)>=0&&v.featured_image&&v.featured_image.src;})[0];if(vv){d.style.backgroundImage='url('+vv.featured_image.src+')';d.style.backgroundSize='cover';d.style.backgroundPosition='center';}});}function apply(){var v=match();if(!v)return;vid.value=v.id;if(priceEl&&v.price!=null){try{priceEl.textContent=(v.price/100).toLocaleString(undefined,{style:'currency',currency:cur});}catch(e){}}if(btn){if(v.available===false){btn.setAttribute('disabled','');if(!btn.dataset.label)btn.dataset.label=btn.textContent;btn.textContent='Sold out';}else{btn.removeAttribute('disabled');if(btn.dataset.label)btn.textContent=btn.dataset.label;}}switchImg(v);try{var u=new URL(location.href);u.searchParams.set('variant',v.id);history.replaceState({},'',u);}catch(e){}refreshAvail();}rows.forEach(function(r){r.addEventListener('click',function(e){var p=e.target.closest('.sf-pill');if(!p||!r.contains(p))return;e.preventDefault();[].slice.call(r.querySelectorAll('.sf-pill')).forEach(function(x){x.classList.remove('on');});p.classList.add('on');var lbl=r.querySelector('.sf-optval');if(lbl)lbl.textContent=p.getAttribute('data-value');apply();});});fillSwatches();apply();})();</script>`

// opts (block path only): labelLiquid = a Liquid expr for the button text (so a `cta_label` block setting
// can override it); dynamicCond = a Liquid condition gating the "Buy it now" dynamic-checkout button (so a
// `show_dynamic` block setting can hide it). Both default to the plain baked behaviour when omitted.
const productForm = (label: string, cls: string, withOptions = true, opts: { labelLiquid?: string; dynamicCond?: string } = {}): string => {
  const iStyle = 'padding:12px 14px;border:1px solid #e7e4ee;border-radius:10px;font-size:15px;font-family:inherit;background:#fff;color:#181720'
  const pickers = withOptions
    ? `{% unless product.has_only_default_variant %}<div class="sf-variants" style="margin:0 0 14px">{% for opt in product.options_with_values %}{% assign sfcolor = false %}{% if opt.name contains 'olor' or opt.name contains 'olour' %}{% assign sfcolor = true %}{% endif %}<div class="sf-optrow" data-opt="{{ forloop.index0 }}"><div class="sf-optname">{{ opt.name }}: <b class="sf-optval">{{ opt.selected_value }}</b></div><div class="sf-optvals">{% for val in opt.values %}{% assign vv = val.name | default: val %}<button type="button" class="sf-pill{% if sfcolor %} sf-color{% endif %}{% if opt.selected_value == vv %} on{% endif %}" data-value="{{ vv | escape }}">{% if sfcolor %}<span class="sf-dot" data-sw="{{ vv | escape }}"{% if val.swatch.image %} style="background-image:url({{ val.swatch.image | image_url: width: 64 }});background-size:cover;background-position:center"{% elsif val.swatch.color %} style="background:{{ val.swatch.color }}"{% else %} style="background:{{ vv | downcase | replace: ' ','' | replace: '/','' }}"{% endif %}></span>{% endif %}{{ vv }}</button>{% endfor %}</div></div>{% endfor %}</div><script type="application/json" data-sf-vdata>{{ product.variants | json }}</script>{% endunless %}`
    : ''
  const qty = withOptions
    ? `<label class="sf-qty" style="display:flex;align-items:center;gap:12px;margin:0 0 12px;font-size:13px;font-weight:700;color:#181720"><span>Quantity</span><input type="number" name="quantity" value="1" min="1" style="width:78px;text-align:center;${iStyle}"></label>`
    : `<input type="hidden" name="quantity" value="1">`
  // Shopify's NATIVE product form ({% form 'product' %}) — so the theme's cart JS / cart drawer picks up
  // the add-to-cart (name="add"), and we get a real dynamic-checkout button (Shop Pay / "Buy it now")
  // via {{ form | payment_button }}. Our option pickers + resolver still set the hidden variant id.
  const dynBtn = `<div class="sf-dyncheckout">{{ form | payment_button }}</div>`
  const dynamicCheckout = withOptions
    ? (opts.dynamicCond ? `{% if ${opts.dynamicCond} %}${dynBtn}{% endif %}` : dynBtn)
    : ''
  const btnLabel = opts.labelLiquid || (label.trim() || 'Add to cart')
  return `{% form 'product', product, class: 'sf-cart-form' %}` +
    pickers +
    `<input type="hidden" name="id" value="{{ product.selected_or_first_available_variant.id }}" data-sf-vid>` +
    qty +
    `<button type="submit" name="add" class="${cls}">${btnLabel}</button>` +
    dynamicCheckout +
    (withOptions ? FORM_JS : '') +
    `{% endform %}`
}

// Replace the inner content of the first element carrying `cls` with a Liquid expression.
function replaceInner(html: string, cls: string, liquid: string): string {
  const re = new RegExp(`(<(\\w+)[^>]*\\bclass=["'][^"']*\\b${cls}\\b[^"']*["'][^>]*>)([\\s\\S]*?)(<\\/\\2>)`, 'i')
  return html.replace(re, `$1${liquid}$4`)
}
// Point every <img class="cls"> at a Liquid image url.
function replaceImgSrc(html: string, cls: string, liquidSrc: string): string {
  const re = new RegExp(`<img\\b([^>]*\\bclass=["'][^"']*\\b${cls}\\b[^"']*["'][^>]*)>`, 'gi')
  return html.replace(re, (_m, attrs) => `<img${String(attrs).replace(/\ssrc=["'][^"']*["']/i, '').replace(/\ssrcset=["'][^"']*["']/i, '')} src="${liquidSrc}">`)
}
// Replace the inner HTML of the first container with class `cls` (spliced via innerOf).
function replaceContainerInner(html: string, cls: string, newInner: string): string {
  const found = innerOf(html, cls)
  return found ? html.slice(0, found.start) + newInner + html.slice(found.end) : html
}
// Turn the product-template gallery (fixed 4 slides of the built product) into a loop over EACH
// product's own images — main slides + thumbnails. Falls back to the featured image if there's no gallery.
function galleryLoop(html: string): string {
  if (!innerOf(html, 'gtrack')) return replaceImgSrc(html, 'gimg', '{{ product.featured_image | image_url: width: 1200 }}')
  let s = replaceContainerInner(html, 'gtrack',
    `{% for image in product.images %}<div class="gslide"><img class="gimg" src="{{ image | image_url: width: 1400 }}" alt="{{ product.title | escape }}"></div>{% endfor %}`)
  s = replaceContainerInner(s, 'thumbs',
    `{% for image in product.images %}<button class="gthumb{% if forloop.first %} on{% endif %}" data-i="{{ forloop.index0 }}"><img src="{{ image | image_url: width: 160 }}" alt=""></button>{% endfor %}`)
  // keep the dots in step with the product's own image count
  s = replaceContainerInner(s, 'gdots',
    `{% for image in product.images %}<span class="gdot{% if forloop.first %} on{% endif %}"></span>{% endfor %}`)
  return s
}

function dynamizeProduct(html: string, mode: DynamicMode): string {
  if (mode === 'none') return html
  let s = html
  // Primary CTA (a.buy) → a full product form (options + quantity + add-to-cart); sticky bar (a.fc-btn) → slim form.
  s = s.replace(/<a\b[^>]*\bclass=["']([^"']*\bbuy\b[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, cls, label) => productForm(label, cls, true))
  s = s.replace(/<a\b[^>]*\bclass=["']([^"']*\b(?:fc-btn|bag)\b[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, cls, label) => productForm(label, cls, false))
  // The product form is ALWAYS live from the real Shopify product — in both 'this product' and 'all
  // products' modes — so title / price / description / gallery reflect the actual product, never static.
  s = replaceInner(s, 'ptitle', '{{ product.title }}')
  s = replaceInner(s, 'now', '{{ product.price | money }}')
  s = replaceInner(s, 'was', '{% if product.compare_at_price > product.price %}{{ product.compare_at_price | money }}{% endif %}')
  s = replaceInner(s, 'fc-name', '{{ product.title }}')
  s = replaceInner(s, 'pdesc', '{{ product.description }}')
  s = s.replace('<span class="now">', '<span class="now" data-sf-price>')   // live-price target for the variant script
  s = galleryLoop(s)                                                        // main gallery → loop the product's own images
  s = replaceImgSrc(s, 'fc-thumb', '{{ product.featured_image | image_url: width: 120 }}')
  return s
}

/** Wrap one section's HTML into a Liquid section file, loading the shared CSS + a schema so it's native. */
// ── Editability: lift a section's static text + images into Shopify schema settings, so the merchant can
// edit the copy and swap images natively in the theme customizer (Atlas-style). Dynamic `{{ product.* }}`
// bits and loops are left untouched, and elements with nested markup stay static (edited in Selfmade). ──
type Setting = { type: string; id: string; label: string; default?: string }
const TEXT_TAGS = 'h1|h2|h3|h4|h5|h6|p|li|a|button|figcaption|blockquote|summary'
const hasLiquid = (x: string) => /\{\{|\{%/.test(x)

// Real editable copy, not chrome: must contain a letter/number and be more than a lone symbol. Filters
// out gallery arrows (‹ ›), check/star/emoji icons (✓ ★ ✦), and stray punctuation.
const isRealText = (s: string) => /[a-z0-9]/i.test(s) && s.replace(/[^a-z0-9]/gi, '').length >= 2

function editablize(html: string): { html: string; settings: Setting[] } {
  const settings: Setting[] = []
  let tn = 0, imn = 0, vn = 0
  let s = html
  const addText = (clean: string) => { tn++; const id = `t${tn}`; settings.push({ type: clean.length > 70 ? 'textarea' : 'text', id, label: (clean.slice(0, 38) || `Text ${tn}`), default: clean }); return id }
  // Templatize an <img> into an editable image_picker (original renders as fallback). Returns null if not eligible.
  const templatizeImg = (imgTag: string): string | null => {
    const mm = /<img\b([^>]*?)\ssrc=["']([^"']+)["']([^>]*)>/i.exec(imgTag)
    if (!mm || hasLiquid(imgTag) || imn >= 8 || !/^(https?:|\/\/)/.test(mm[2])) return null
    imn++; const id = `img${imn}`; settings.push({ type: 'image_picker', id, label: `Image ${imn}` })
    const attrs = `${mm[1]}${mm[3]}`.replace(/\ssrcset=["'][^"']*["']/i, '')
    return `{% if section.settings.${id} %}<img${attrs} src="{{ section.settings.${id} | image_url: width: 1600 }}">{% else %}<img${attrs} src="${mm[2]}">{% endif %}`
  }
  const videoTag = (id: string) => `{{ section.settings.${id} | video_tag: controls: true, muted: true, loop: true, playsinline: true }}`
  const addVideo = () => { vn++; const id = `vid${vn}`; settings.push({ type: 'video', id, label: `Video ${vn}` }); return id }

  // FAQ + press-logo pass — question spans (.fqq), answer divs (.fqa) and "as seen on" text logos
  // (.plogo) become editable text. The generic text passes below only match TEXT_TAGS (no span/div), so
  // without this an FAQ shows "No customizable settings" and press names couldn't be edited.
  s = s.replace(/<(span|div)\b([^>]*\bclass=["'][^"']*\b(?:fqq|fqa|plogo)\b[^"']*["'][^>]*)>([^<]{1,600}?)<\/\1>/gi, (m, tag, attrs, text) => {
    const clean = stripMd(text)
    if (!clean || hasLiquid(text) || tn >= 40 || !isRealText(clean)) return m
    return `<${tag}${attrs}>{{ section.settings.${addText(clean)} }}</${tag}>`
  })

  // BUTTON pass — CTA anchors (.buy/.cta/.fc-btn/.btn) get an editable label AND an editable link (a
  // Shopify `url` setting). The generic text pass below would make only the label editable and leave the
  // href hard-coded. (On product templates these anchors are already forms, so this mainly hits home /
  // advertorial / listicle CTAs.)
  let bn = 0
  s = s.replace(/<a\b([^>]*)>([^<]{1,120})<\/a>/gi, (m, attrs, label) => {
    const clean = stripMd(label)
    if (hasLiquid(m) || !isRealText(clean) || bn >= 4 || tn >= 40) return m
    if (!/\bclass=["'][^"']*\b(?:buy|cta|fc-btn|btn)\b/i.test(attrs)) return m
    bn++
    const urlId = `btn${bn}url`
    settings.push({ type: 'url', id: urlId, label: `Button ${bn} link` })
    const orig = (/\shref=["']([^"']*)["']/i.exec(attrs)?.[1] || '#').replace(/'/g, '')
    const withHref = /\shref=/i.test(attrs)
      ? attrs.replace(/\shref=["'][^"']*["']/i, ` href="{{ section.settings.${urlId} | default: '${orig}' }}"`)
      : `${attrs} href="{{ section.settings.${urlId} | default: '${orig}' }}"`
    return `<a${withHref}>{{ section.settings.${addText(clean)} }}</a>`
  })

  // TEXT pass 1 — pure-text leaves (no nested tags). Skip dynamic bits + icon/arrow noise.
  s = s.replace(new RegExp(`(<(?:${TEXT_TAGS})\\b[^>]*>)([^<]{1,400}?)(</(?:${TEXT_TAGS})>)`, 'gi'), (m, open, text, close) => {
    const clean = stripMd(text)
    if (!clean || hasLiquid(text) || tn >= 20 || !isRealText(clean)) return m
    return `${open}{{ section.settings.${addText(clean)} }}${close}`
  })

  // TEXT pass 2 — headings that still have inner markup (e.g. a two-tone accent <span>). Make them
  // editable as PLAIN text (the accent styling is dropped in Shopify; edit the styled version in Selfmade).
  s = s.replace(/<(h[1-6])\b([^>]*)>([\s\S]*?)<\/\1>/gi, (m, tag, attrs, inner) => {
    if (hasLiquid(inner) || tn >= 20) return m
    const clean = stripMd(inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '))
    if (!clean || !isRealText(clean)) return m
    return `<${tag}${attrs}>{{ section.settings.${addText(clean)} }}</${tag}>`
  })

  // TEXT pass 3 — paragraphs / list items that carry INLINE markup (a bold <strong>, a link, an accent
  // <span>). Pass 1 only matched pure-text leaves, so these copy blocks had NO editable setting (QA: "no
  // input to change existing text"). Lift them as PLAIN editable text; skip anything with block/media
  // children (that's a container, not a copy block).
  s = s.replace(/<(p|li|blockquote|figcaption)\b([^>]*)>([\s\S]*?)<\/\1>/gi, (m, tag, attrs, inner) => {
    if (hasLiquid(inner) || tn >= 20) return m
    if (!/<(?:strong|em|b|i|a|span|br|mark|u)\b/i.test(inner)) return m                               // pure text → pass 1 already handled it
    if (/<(?:div|ul|ol|table|section|h[1-6]|img|svg|button|input|details|video|iframe)\b/i.test(inner)) return m  // container → leave alone
    const clean = stripMd(inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '))
    if (!clean || !isRealText(clean)) return m
    return `<${tag}${attrs}>{{ section.settings.${addText(clean)} }}</${tag}>`
  })

  // VIDEO pass (before images) — video slots become uploadable: a Shopify `video` setting (upload to
  // Content → Files, then pick it). Covers real <video> and the poster+▶ placeholder cards (mediaCard).
  //  (a) real <video src="…">…</video>
  s = s.replace(/<video\b[^>]*>[\s\S]*?<\/video>/gi, (m) => {
    if (hasLiquid(m) || vn >= 6) return m
    const id = addVideo()
    return `{% if section.settings.${id} %}${videoTag(id)}{% else %}${m}{% endif %}`
  })
  //  (b) poster image + play badge (no video uploaded yet) → a video field + keep the poster editable.
  s = s.replace(/(<img\b[^>]*>)(\s*<div class="play">[\s\S]*?<\/div>)/gi, (m, imgTag, playDiv) => {
    if (hasLiquid(m) || vn >= 6) return m
    const id = addVideo()
    const poster = templatizeImg(imgTag) || imgTag
    return `{% if section.settings.${id} %}${videoTag(id)}{% else %}${poster}${playDiv}{% endif %}`
  })

  // IMAGES — remaining static <img src="url"> → editable image_picker (original renders as fallback).
  s = s.replace(/<img\b[^>]*?\ssrc=["'][^"']+["'][^>]*>/gi, (m) => templatizeImg(m) || m)

  return { html: s, settings }
}

// The built page's gallery is driven by a page-level <script> that's dropped when we split into sections,
// so in Shopify the hero couldn't slide/loop and later images never showed. Inject a SELF-CONTAINED,
// section-scoped driver (arrows, dots, thumbs + auto-advance loop) into any section that has a .gtrack.
// Scoped via the section's own `.pgbld` wrapper, so duplicating the section keeps each gallery independent.
const GALLERY_SCRIPT = `<script>(function(){var s=document.currentScript;var root=s?s.parentElement:document;var tr=(root&&root.querySelector('.gtrack'))||document.querySelector('.gtrack');if(!tr)return;var scope=tr.closest('.pgbld')||root||document;var dots=[].slice.call(scope.querySelectorAll('.gdots .gdot'));var ths=[].slice.call(scope.querySelectorAll('.thumbs .gthumb'));var n=tr.children.length;if(n<2)return;function cur(){return Math.round(tr.scrollLeft/Math.max(1,tr.clientWidth));}function u(){var i=cur();dots.forEach(function(d,j){d.classList.toggle('on',j===i);});ths.forEach(function(x,j){x.classList.toggle('on',j===i);});}tr.addEventListener('scroll',function(){requestAnimationFrame(u);},{passive:true});ths.forEach(function(x){x.addEventListener('click',function(){tr.scrollTo({left:(+x.getAttribute('data-i'))*tr.clientWidth,behavior:'smooth'});});});var pv=scope.querySelector('.gprev'),nx=scope.querySelector('.gnext');function go(d){var i=((cur()+d)%n+n)%n;tr.scrollTo({left:i*tr.clientWidth,behavior:'smooth'});}if(pv)pv.addEventListener('click',function(){go(-1);});if(nx)nx.addEventListener('click',function(){go(1);});var t=setInterval(function(){go(1);},4500);var h=scope.querySelector('.gallery')||tr;h.addEventListener('mouseenter',function(){clearInterval(t);});})();</script>`
const withGalleryDriver = (html: string): string => (/\bgtrack\b/.test(html) ? html + GALLERY_SCRIPT : html)

// Review / testimonial carousels (.gcar with .gprev/.gnext arrows) are a horizontal scroller, not a
// full-width slider — the page-level script that drove their arrows is dropped when we split into sections,
// so the arrows did nothing. This self-contained, section-scoped driver scrolls by one card per click.
const CAROUSEL_SCRIPT = `<script>(function(){var s=document.currentScript;var scope=(s&&s.closest('.pgbld'))||document;var car=scope.querySelector('.gcar');if(!car)return;var pv=scope.querySelector('.gprev'),nx=scope.querySelector('.gnext');function step(){var c=car.children[0];return (c?c.getBoundingClientRect().width+16:car.clientWidth*0.85);}function go(d){car.scrollBy({left:d*step(),behavior:'smooth'});}if(pv)pv.addEventListener('click',function(e){e.preventDefault();go(-1);});if(nx)nx.addEventListener('click',function(e){e.preventDefault();go(1);});})();</script>`
const withCarouselDriver = (html: string): string => (/\bgcar\b/.test(html) ? html + CAROUSEL_SCRIPT : html)

// Every section gets a native "Section style" settings group — background, text colour, alignment,
// spacing and text size — editable in Shopify's theme editor like a real theme. Applied via a scoped
// {% style %} block on the section's own `.pgbld` root so it can't leak into other sections.
const SECTION_STYLE_SETTINGS: any[] = [
  { type: 'header', content: 'Section style' },
  { type: 'color', id: 'sf_bg', label: 'Background' },
  { type: 'color', id: 'sf_text', label: 'Text colour' },
  { type: 'select', id: 'sf_align', label: 'Text alignment', default: 'default', options: [
    { value: 'default', label: 'Default' }, { value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }] },
  { type: 'select', id: 'sf_space', label: 'Spacing (top & bottom)', default: 'default', options: [
    { value: 'default', label: 'Theme default' }, { value: '0', label: 'None' }, { value: '24', label: 'Small' }, { value: '48', label: 'Medium' }, { value: '80', label: 'Large' }, { value: '120', label: 'X-Large' }] },
  { type: 'select', id: 'sf_scale', label: 'Text size', default: '100', options: [
    { value: '85', label: 'Smaller' }, { value: '100', label: 'Default' }, { value: '115', label: 'Larger' }, { value: '130', label: 'Largest' }] },
]
const sectionStyleCss = `{% style %}
#shopify-section-{{ section.id }} > .pgbld{
{% if section.settings.sf_bg != blank %}background:{{ section.settings.sf_bg }} !important;{% endif %}
{% if section.settings.sf_align != 'default' %}text-align:{{ section.settings.sf_align }};{% endif %}
{% if section.settings.sf_space != 'default' %}padding-top:{{ section.settings.sf_space }}px !important;padding-bottom:{{ section.settings.sf_space }}px !important;{% endif %}
{% unless section.settings.sf_scale == '100' %}font-size:{{ section.settings.sf_scale }}%;{% endunless %}
}
{% if section.settings.sf_text != blank %}
/* Text colour must beat the template's own per-element colours (headings, marquee spans, …), hence the
   descendant list + !important. Buttons/links keep their own colour so CTAs stay legible. */
#shopify-section-{{ section.id }} > .pgbld,
#shopify-section-{{ section.id }} > .pgbld :where(h1,h2,h3,h4,h5,h6,p,span,li,strong,em,blockquote,figcaption,small,label,dt,dd,summary){color:{{ section.settings.sf_text }} !important}
{% endif %}
{% endstyle %}`

// ── Phase 1: native theme-blocks product section ────────────────────────────────────────────────
// The buy-box slice becomes a Shopify main-product-style section whose INFO column is composed of native
// section BLOCKS (title, price, highlights, buy buttons, description) the merchant can add / remove /
// reorder in the theme editor — plus `@app` blocks (reviews, upsells). The gallery stays as the media
// column. Uses the classic section-blocks model ({% for block in section.blocks %}) for max theme support.
function outerEl(html: string, cls: string): string {
  const f = innerOf(html, cls); if (!f) return ''
  const openStart = html.lastIndexOf('<', f.start - 1)   // f.start-1 is the opening tag's '>'; step back to its '<'
  const closeEnd = html.indexOf('>', f.end)
  return openStart >= 0 && closeEnd >= f.end ? html.slice(openStart, closeEnd + 1) : ''
}

// Phase 2 — native media gallery. Loops product.MEDIA (not just images) so the gallery handles image,
// video, external video and 3D/AR models like a stock theme, plus a click-to-zoom lightbox on images.
const ZOOM_SCRIPT = `<script>(function(){var s=document.currentScript;var g=s&&s.parentElement?(s.parentElement.closest('.gallery')||s.parentElement):null;if(!g)return;function open(src){var o=document.createElement('div');o.className='gzoom';var im=document.createElement('img');im.src=src;o.appendChild(im);o.addEventListener('click',function(){o.remove();});document.addEventListener('keydown',function esc(e){if(e.key==='Escape'){o.remove();document.removeEventListener('keydown',esc);}});document.body.appendChild(o);}[].slice.call(g.querySelectorAll('.gimg[data-zoom]')).forEach(function(im){im.style.cursor='zoom-in';im.addEventListener('click',function(e){e.preventDefault();open(im.getAttribute('data-zoom')||im.src);});});})();</script>`

function mediaGallery(galleryHtml: string): string {
  if (!innerOf(galleryHtml, 'gtrack')) return galleryLoop(galleryHtml)
  let s = galleryHtml
  s = replaceContainerInner(s, 'gtrack',
    `{% for media in product.media %}<div class="gslide" data-mtype="{{ media.media_type }}">{% case media.media_type %}{% when 'image' %}<img class="gimg" src="{{ media | image_url: width: 1400 }}" alt="{{ media.alt | escape }}" loading="lazy" data-zoom="{{ media | image_url: width: 2048 }}">{% when 'external_video' %}{{ media | external_video_tag }}{% when 'video' %}{{ media | video_tag: controls: true, muted: true, loop: true, playsinline: true }}{% when 'model' %}{{ media | model_viewer_tag }}{% else %}{{ media | media_tag }}{% endcase %}</div>{% endfor %}`)
  s = replaceContainerInner(s, 'thumbs',
    `{% for media in product.media %}<button class="gthumb{% if forloop.first %} on{% endif %}" data-i="{{ forloop.index0 }}" type="button">{% if media.media_type == 'model' %}<span class="gbadge">3D</span>{% elsif media.media_type == 'video' or media.media_type == 'external_video' %}<span class="gbadge">▶</span>{% endif %}<img src="{{ media.preview_image | image_url: width: 200 }}" alt=""></button>{% endfor %}`)
  s = replaceContainerInner(s, 'gdots',
    `{% for media in product.media %}<span class="gdot{% if forloop.first %} on{% endif %}"></span>{% endfor %}`)
  const modelLib = `{% assign sf_has_model = product.media | where: 'media_type', 'model' | first %}{% if sf_has_model %}<script src="{{ 'model-viewer-ui.min.js' | shopify_asset_url }}" defer></script>{% endif %}`
  return withGalleryDriver(s) + ZOOM_SCRIPT + modelLib
}

function mainProductSection(hero: string, cssKey: string, name: string): { value: string; blocks: Record<string, any>; blockOrder: string[] } {
  const cssHandle = cssKey.replace(/^assets\//, '')
  const nm = (name || 'Product').slice(0, 25)
  const galleryLiquid = mediaGallery(outerEl(hero, 'gallery'))
  const highlightsHtml = ['pills', 'buyopt'].map((c) => outerEl(hero, c)).filter(Boolean).join('\n')
  const trustHtml = ['pay', 'social', 'trust'].map((c) => outerEl(hero, c)).filter(Boolean).join('\n')
  const ctaLabel = (/(<a[^>]*\bclass=["'][^"']*\bbuy\b[^"']*["'][^>]*>)([^<]{1,60})<\/a>/i.exec(hero)?.[2] || 'Add to cart').trim()
  const strip = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  const eyebrow = strip(innerOf(hero, 'rpill')?.inner || '').replace(/[★☆]+/g, '').replace(/\s+/g, ' ').trim()
  const tagline = strip(innerOf(hero, 'newline')?.inner || '')
  // Buy-buttons block is editable: `cta_label` overrides the Add-to-cart text, `show_dynamic` toggles the
  // "Buy it now" dynamic-checkout button. Both read from block.settings (in scope inside the block case).
  const form = productForm(ctaLabel, 'buy grad', true, {
    labelLiquid: `{{ block.settings.cta_label | default: '${ctaLabel.replace(/'/g, '')}' }}`,
    dynamicCond: 'block.settings.show_dynamic',
  })

  const value = `{{ '${cssHandle}' | asset_url | stylesheet_tag }}
${sectionStyleCss}
<div class="pgbld"><div class="wrap"><div class="hero">
<div class="gallery">${galleryLiquid}</div>
<div class="buybox">
{% for block in section.blocks %}{% case block.type %}
{% when 'title' %}<div {{ block.shopify_attributes }}>{% if block.settings.eyebrow != blank %}<div class="rpill">{{ block.settings.eyebrow }}</div>{% endif %}<h1 class="ptitle">{{ product.title }}</h1>{% if block.settings.tagline != blank %}<div class="newline">{{ block.settings.tagline }}</div>{% endif %}</div>
{% when 'price' %}<div class="priceRow" {{ block.shopify_attributes }}><span class="now" data-sf-price>{{ product.price | money }}</span>{% if product.compare_at_price > product.price %}<span class="was">{{ product.compare_at_price | money }}</span>{% endif %}</div>
{% when 'highlights' %}<div {{ block.shopify_attributes }}>{{ block.settings.content }}</div>
{% when 'buy_buttons' %}<div {{ block.shopify_attributes }}>${form}</div>
{% when 'trust' %}<div {{ block.shopify_attributes }}>{{ block.settings.content }}</div>
{% when 'description' %}<details class="pdetails" {{ block.shopify_attributes }}><summary>{{ block.settings.label | default: 'Product details' }}</summary><div class="pdesc">{{ product.description }}</div></details>
{% when '@app' %}{% render block %}
{% endcase %}{% endfor %}
</div>
</div></div></div>
{% schema %}
${JSON.stringify({
    name: nm,
    tag: 'section',
    settings: SECTION_STYLE_SETTINGS,
    blocks: [
      { type: 'title', name: 'Title', settings: [{ type: 'text', id: 'eyebrow', label: 'Eyebrow' }, { type: 'text', id: 'tagline', label: 'Tagline' }] },
      { type: 'price', name: 'Price', settings: [] },
      { type: 'highlights', name: 'Highlights', settings: [{ type: 'liquid', id: 'content', label: 'Content' }] },
      { type: 'buy_buttons', name: 'Buy buttons', settings: [
        { type: 'text', id: 'cta_label', label: 'Add-to-cart text' },
        { type: 'checkbox', id: 'show_dynamic', label: 'Show “Buy it now” button', default: true },
      ] },
      { type: 'trust', name: 'Trust & payment', settings: [{ type: 'liquid', id: 'content', label: 'Content' }] },
      { type: 'description', name: 'Description', settings: [{ type: 'text', id: 'label', label: 'Toggle label', default: 'Product details' }] },
      { type: '@app' },
    ],
    presets: [{ name: nm, blocks: [{ type: 'title' }, { type: 'price' }, { type: 'highlights' }, { type: 'buy_buttons' }, { type: 'trust' }, { type: 'description' }] }],
  })}
{% endschema %}`

  const blocks: Record<string, any> = {
    title: { type: 'title', settings: { eyebrow, tagline } },
    price: { type: 'price', settings: {} },
    highlights: { type: 'highlights', settings: { content: highlightsHtml } },
    buy_buttons: { type: 'buy_buttons', settings: { cta_label: ctaLabel, show_dynamic: true } },
    trust: { type: 'trust', settings: { content: trustHtml } },
    description: { type: 'description', settings: { label: 'Product details' } },
  }
  return { value, blocks, blockOrder: ['title', 'price', 'highlights', 'buy_buttons', 'trust', 'description'] }
}

// Home HERO → a native theme section composed of BLOCKS (eyebrow / heading / text / button / image + @app),
// the same model Shopify's own themes use (Horizon's home hero is text + button blocks with a block_order).
// The merchant can add / remove / reorder each block and edit its content in the theme editor; the generated
// copy is baked into the template-JSON block settings, and the hero image renders from an image_picker with
// the original as fallback (identical to editablize's image handling).
function homeHeroSection(hero: string, cssKey: string, name: string): { value: string; blocks: Record<string, any>; blockOrder: string[] } {
  const cssHandle = cssKey.replace(/^assets\//, '')
  const nm = (name || 'Hero').slice(0, 25)
  const strip = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  const eyebrow = strip(innerOf(hero, 'rpill')?.inner || '')
  const heading = strip(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(hero)?.[1] || '') || 'Your headline'
  const lead = strip(innerOf(hero, 'lead')?.inner || '')
  const ctaM = /<a\b[^>]*\bclass=["'][^"']*\bcta\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/i.exec(hero)
  const ctaLabel = strip(ctaM?.[1] || '')
  const ctaHref = (ctaM ? (/\shref=["']([^"']*)["']/i.exec(ctaM[0])?.[1] || '') : '') || '#'
  const imgM = /<img\b[^>]*\bclass=["'][^"']*\bhimg\b[^"']*["'][^>]*>/i.exec(hero)
  const bakedImg = (imgM ? (/\ssrc=["']([^"']*)["']/i.exec(imgM[0])?.[1] || '') : '').replace(/"/g, '&quot;')

  const blockDefs: any[] = []
  const blocks: Record<string, any> = {}
  const order: string[] = []
  const presetBlocks: any[] = []
  const add = (type: string, def: any, settings: Record<string, any>) => { blockDefs.push(def); blocks[type] = { type, settings }; order.push(type); presetBlocks.push({ type }) }

  if (eyebrow) add('eyebrow', { type: 'eyebrow', name: 'Eyebrow', settings: [{ type: 'text', id: 'text', label: 'Text' }] }, { text: eyebrow })
  add('heading', { type: 'heading', name: 'Heading', settings: [{ type: 'text', id: 'text', label: 'Heading' }] }, { text: heading })
  if (lead) add('text', { type: 'text', name: 'Text', settings: [{ type: 'textarea', id: 'text', label: 'Text' }] }, { text: lead })
  if (ctaLabel) add('button', { type: 'button', name: 'Button', settings: [{ type: 'text', id: 'label', label: 'Label' }, { type: 'url', id: 'url', label: 'Link' }] }, { label: ctaLabel, url: ctaHref })
  if (bakedImg) add('image', { type: 'image', name: 'Image', settings: [{ type: 'image_picker', id: 'image', label: 'Image' }] }, {})
  blockDefs.push({ type: '@app' })

  const value = `{{ '${cssHandle}' | asset_url | stylesheet_tag }}
${sectionStyleCss}
<div class="pgbld"><section class="hero">
<div class="herocol">
{% for block in section.blocks %}{% case block.type %}
{% when 'eyebrow' %}<div class="rpill" {{ block.shopify_attributes }}>{{ block.settings.text }}</div>
{% when 'heading' %}<h1 {{ block.shopify_attributes }}>{{ block.settings.text }}</h1>
{% when 'text' %}<p class="lead" {{ block.shopify_attributes }}>{{ block.settings.text }}</p>
{% when 'button' %}<a class="cta" href="{{ block.settings.url | default: '#' }}" {{ block.shopify_attributes }}>{{ block.settings.label }}</a>
{% when '@app' %}{% render block %}
{% endcase %}{% endfor %}
</div>
{% for block in section.blocks %}{% if block.type == 'image' %}{% if block.settings.image %}<img class="himg" src="{{ block.settings.image | image_url: width: 1400 }}" alt="{{ block.settings.image.alt | escape }}" {{ block.shopify_attributes }}>{% else %}<img class="himg" src="${bakedImg}" alt="" {{ block.shopify_attributes }}>{% endif %}{% endif %}{% endfor %}
</section></div>
{% schema %}
${JSON.stringify({ name: nm, tag: 'section', settings: SECTION_STYLE_SETTINGS, blocks: blockDefs, presets: [{ name: nm, blocks: presetBlocks }] })}
{% endschema %}`

  return { value, blocks, blockOrder: order }
}

// Phase 4 — block-ify marketing list sections. A section whose main content is a uniform list (review
// cards, FAQ items, feature/benefit cards, …) becomes a native section with one BLOCK per item, so the
// merchant can add / remove / reorder items in the theme editor. Each item's markup is preserved as an
// editable `liquid` block setting and the item's wrapper tag+class is kept so the grid layout stays intact.
const LIST_CONTAINERS: Array<[string, string]> = [
  ['faqacc', 'Question'], ['revs', 'Review'], ['bgrid', 'Feature'], ['trio', 'Card'],
  ['wall', 'Media'], ['pcards', 'Card'], ['statgrid', 'Stat'], ['logos', 'Logo'],
  // home template list containers (so its reviews / benefits / transformation / services / FAQ sections
  // become add/remove/reorder blocks too, matching the product page). Item must carry a class (see below).
  ['blurbs', 'Benefit'], ['tlist', 'Step'], ['gcar', 'Review'], ['svc', 'Service'], ['faq', 'Question'],
]
const firstClass = (attrs: string) => (/\bclass=["']([^"']*)["']/.exec(attrs)?.[1] || '').trim().split(/\s+/)[0]

// Turn a uniform list item into TYPED block settings — real text inputs + an image picker per <img> — instead
// of one raw-HTML `content` box (which showed markup like `<div class="ic">✦</div>…` in the theme editor).
// The render template + field schema come from item[0] (all items are uniform, so they share it); each item
// then supplies its own values. Images get an image_picker (choose a file) plus a per-block URL text that
// carries the generated image as the fallback — so every card keeps its own photo AND can be swapped.
// `div` is included because item sub-fields are often leaf divs (.q, .bt, .rtt, .rwho); the `[^<]` guard in
// the regex means only TEXT-ONLY divs match, never container divs.
const ITEM_TEXT_TAGS = 'h1|h2|h3|h4|h5|h6|p|span|strong|em|li|summary|blockquote|figcaption|b|i|div|a'
function structuredItem(items: string[], opts: { logoImgClass?: string } = {}): { itemSettings: any[]; blocks: Record<string, any>; blockOrder: string[]; template: string } | null {
  let imgN = 0, txtN = 0
  const itemSettings: any[] = []
  const imgRe = /<img\b([^>]*?)\ssrc=["']([^"']+)["']([^>]*)>/gi
  const txtRe = new RegExp(`(<(?:${ITEM_TEXT_TAGS})\\b[^>]*>)([^<]{1,400}?)(</(?:${ITEM_TEXT_TAGS})>)`, 'gi')
  const editableText = (t: string) => { const c = t.trim(); return !!c && !/{{|{%/.test(t) && /[a-zA-Z0-9]/.test(c) }
  // Template + schema from the first item.
  let template = items[0]
    .replace(imgRe, (_m, a, _src, b) => {
      imgN++; const pid = `img${imgN}`, uid = `img${imgN}u`
      itemSettings.push({ type: 'image_picker', id: pid, label: `Image ${imgN}` })
      itemSettings.push({ type: 'text', id: uid, label: `Image ${imgN} URL`, info: 'Used until you choose an image above' })
      const attrs = `${a}${b}`.replace(/\ssrcset=["'][^"']*["']/i, '')
      return `{% if block.settings.${pid} != blank %}<img${attrs} src="{{ block.settings.${pid} | image_url: width: 1000 }}">{% else %}<img${attrs} src="{{ block.settings.${uid} }}">{% endif %}`
    })
  template = template.replace(txtRe, (m, open, text, close) => {
    if (!editableText(text)) return m
    txtN++; const id = `f${txtN}`
    itemSettings.push({ type: text.trim().length > 60 ? 'textarea' : 'text', id, label: text.trim().slice(0, 32) })
    return `${open}{{ block.settings.${id} }}${close}`
  })
  if (itemSettings.length === 0) return null   // nothing structured → caller keeps the raw-content fallback
  // Per-item values, extracted with the SAME ordered passes so ids line up.
  const extract = (html: string): Record<string, any> => {
    const v: Record<string, any> = {}; let ii = 0, ti = 0
    html.replace(imgRe, (_m, _a, src) => { ii++; v[`img${ii}u`] = src; return _m })
    html.replace(txtRe, (m, _o, text) => { if (editableText(text)) { ti++; v[`f${ti}`] = text.trim() } return m })
    return v
  }
  const blocks: Record<string, any> = {}, order: string[] = []
  items.forEach((it, i) => { const id = `item${i + 1}`; blocks[id] = { type: 'item', settings: extract(it) }; order.push(id) })
  // Give the item's outer tag a shopify_attributes hook so the block is selectable in the editor.
  let templateWithAttrs = template.replace(/^(<\w+)(\s|>)/, '$1 {{ block.shopify_attributes }}$2')
  // Logos ("As seen on") default to a wordmark, but merchants want to drop in a press LOGO IMAGE. Add an
  // optional image_picker per block that renders as the logo when set, falling back to the text otherwise.
  if (opts.logoImgClass) {
    itemSettings.unshift({ type: 'image_picker', id: 'logo_image', label: 'Logo image', info: 'Overrides the text logo below' })
    templateWithAttrs = `{% if block.settings.logo_image != blank %}<img class="${opts.logoImgClass}" src="{{ block.settings.logo_image | image_url: width: 300 }}" alt="" {{ block.shopify_attributes }}>{% else %}${templateWithAttrs}{% endif %}`
  }
  return { itemSettings, blocks, blockOrder: order, template: templateWithAttrs }
}

function blockifyList(html: string): { html: string; blocks: Record<string, any>; blockOrder: string[]; itemName: string; itemSettings?: any[] } | null {
  for (const [cc, itemName] of LIST_CONTAINERS) {
    const inner = innerOf(html, cc); if (!inner) continue
    const items = topLevelChildren(inner.inner).map((s) => s.trim()).filter((s) => /^<\w/.test(s))
    if (items.length < 2) continue
    const tm = /^<(\w+)([^>]*)>/.exec(items[0]); if (!tm) continue
    const itemTag = tm[1], itemClass = (/\bclass=["']([^"']*)["']/.exec(tm[2])?.[1] || '').trim()
    if (!itemClass) continue
    const c0 = firstClass(tm[2])
    // require a UNIFORM list (same tag + same lead class) so we don't mangle mixed containers
    const uniform = items.every((it) => { const m = /^<(\w+)([^>]*)>/.exec(it); return !!m && m[1] === itemTag && firstClass(m[2]) === c0 })
    if (!uniform) continue
    // Preferred: typed settings (text inputs + image pickers). Fallback: the raw-HTML `content` box.
    // Logo strips ("As seen on") also get an optional per-block logo image that overrides the wordmark.
    const isLogo = cc === 'logos' || /\blogo|plogo\b/i.test(itemClass)
    const structured = structuredItem(items, isLogo ? { logoImgClass: itemClass } : {})
    if (structured) {
      const loop = `{% for block in section.blocks %}{% case block.type %}{% when '@app' %}{% render block %}{% else %}${structured.template}{% endcase %}{% endfor %}`
      return { html: html.slice(0, inner.start) + loop + html.slice(inner.end), blocks: structured.blocks, blockOrder: structured.blockOrder, itemName, itemSettings: structured.itemSettings }
    }
    const blocks: Record<string, any> = {}, order: string[] = []
    items.forEach((it, i) => {
      const content = it.replace(/^<\w+[^>]*>/, '').replace(/<\/\w+>\s*$/, '')
      const id = `item${i + 1}`; blocks[id] = { type: 'item', settings: { content } }; order.push(id)
    })
    const loop = `{% for block in section.blocks %}{% case block.type %}{% when '@app' %}{% render block %}{% else %}<${itemTag} class="${itemClass}" {{ block.shopify_attributes }}>{{ block.settings.content }}</${itemTag}>{% endcase %}{% endfor %}`
    return { html: html.slice(0, inner.start) + loop + html.slice(inner.end), blocks, blockOrder: order, itemName }
  }
  return null
}

function liquidSection(cssKey: string, name: string, html: string, settings: Setting[] = [], blockDefs?: any[]): string {
  const cssHandle = cssKey.replace(/^assets\//, '')
  const nm = name.slice(0, 25)
  const schema: any = { name: nm, settings: [...settings, ...SECTION_STYLE_SETTINGS], presets: [{ name: nm }] }
  if (blockDefs && blockDefs.length) schema.blocks = blockDefs
  return `{{ '${cssHandle}' | asset_url | stylesheet_tag }}
${sectionStyleCss}
${html}
{% schema %}
${JSON.stringify(schema)}
{% endschema %}`
}

// Phase 5 — native "You may also like" recommendations, using Shopify's Product Recommendations API
// (routes.product_recommendations_url + the Section Rendering API). Renders empty on first paint, then a
// tiny script fetches the section rendered WITH recommendations and swaps it in — the stock-theme pattern.
function recommendationsSection(cssKey: string): string {
  const cssHandle = cssKey.replace(/^assets\//, '')
  const nm = 'You may also like'
  return `{{ '${cssHandle}' | asset_url | stylesheet_tag }}
${sectionStyleCss}
<div class="pgbld"><div class="wrap"><section class="sf-recs" data-sf-recs data-url="{{ routes.product_recommendations_url }}?section_id={{ section.id }}&product_id={{ product.id }}&limit={{ section.settings.sf_count | default: 4 }}&intent={{ section.settings.sf_intent | default: 'related' }}">{% if recommendations.performed and recommendations.products_count > 0 %}<h2 class="sf-recs-h">{{ section.settings.sf_heading | default: 'You may also like' }}</h2><div class="sf-recs-grid">{% for product in recommendations.products %}<a class="sf-rec" href="{{ product.url }}"><span class="sf-rec-img">{% if product.featured_image %}<img src="{{ product.featured_image | image_url: width: 500 }}" alt="{{ product.title | escape }}" loading="lazy">{% endif %}</span><span class="sf-rec-t">{{ product.title }}</span><span class="sf-rec-p">{% if product.compare_at_price > product.price %}<del>{{ product.compare_at_price | money }}</del> {% endif %}{{ product.price | money }}</span></a>{% endfor %}</div>{% endif %}</section></div></div>
<script>(function(){var el=document.querySelector('[data-sf-recs]');if(!el||el.querySelector('.sf-rec'))return;var url=el.getAttribute('data-url');if(!url)return;fetch(url).then(function(r){return r.text();}).then(function(t){var d=new DOMParser().parseFromString(t,'text/html');var f=d.querySelector('[data-sf-recs]');if(f&&f.querySelector('.sf-rec'))el.innerHTML=f.innerHTML;}).catch(function(){});})();</script>
{% schema %}
${JSON.stringify({
    name: nm,
    tag: 'section',
    settings: [
      { type: 'text', id: 'sf_heading', label: 'Heading', default: 'You may also like' },
      { type: 'range', id: 'sf_count', label: 'Products to show', min: 2, max: 10, step: 1, default: 4 },
      { type: 'select', id: 'sf_intent', label: 'Recommendation type', default: 'related', options: [{ value: 'related', label: 'Related' }, { value: 'complementary', label: 'Complementary' }] },
      ...SECTION_STYLE_SETTINGS,
    ],
    blocks: [{ type: '@app' }],
    presets: [{ name: nm }],
  })}
{% endschema %}`
}

/** Build every theme asset for a page: the CSS, one section per slice, and the JSON template. */
export function buildThemeAssets(opts: { pageId: string; kind: PageKind; css: string; body: string; templateSuffix: string; dynamic?: DynamicMode }): ThemeAssets {
  const slug = `sf-${opts.pageId.replace(/[^a-z0-9]/gi, '').slice(0, 12)}`
  const cssKey = `assets/${slug}.css`
  const cssValue = FONT_IMPORT + opts.css
  const parts = splitPageIntoSections(opts.body)
  // Product templates get live `{{ product.* }}` data + a real Add-to-Cart form.
  const dyn: DynamicMode = opts.kind === 'product' ? (opts.dynamic || 'none') : 'none'

  const sections = parts.map((p, i) => {
    const key = `${slug}-${i + 1}`
    // The product buy-box slice → a native main-product section composed of theme BLOCKS (add/remove/
    // reorder + @app). Every other slice → the normal dynamize + editablize pipeline.
    const isBuyBox = dyn !== 'none' && /\bclass=["'][^"']*\bbuybox\b/.test(p.html) && /\bgtrack\b/.test(p.html)
    if (isBuyBox) {
      const mp = mainProductSection(p.html, cssKey, p.name)
      return { id: key, key: `sections/${key}.liquid`, value: mp.value, blocks: mp.blocks, blockOrder: mp.blockOrder }
    }
    // The home HERO slice → a native section built from add/remove/reorder blocks (heading/text/button/
    // image/@app), matching how Shopify's own themes compose the home hero.
    const isHomeHero = opts.kind === 'home' && /\bclass=["'][^"']*\bhero\b/.test(p.html) && /<h1\b/i.test(p.html)
    if (isHomeHero) {
      const hh = homeHeroSection(p.html, cssKey, p.name)
      return { id: key, key: `sections/${key}.liquid`, value: hh.value, blocks: hh.blocks, blockOrder: hh.blockOrder }
    }
    // Phase 4: turn a uniform list section (reviews / FAQ / feature cards / …) into add/remove/reorder blocks.
    const bl = blockifyList(p.html)
    const dynamized = dynamizeProduct(bl ? bl.html : p.html, dyn)
    const { html, settings } = editablize(dynamized)
    const blockDefs = bl ? [{ type: 'item', name: bl.itemName, settings: bl.itemSettings || [{ type: 'liquid', id: 'content', label: 'Content' }] }, { type: '@app' }] : undefined
    return { id: key, key: `sections/${key}.liquid`, value: liquidSection(cssKey, p.name, withCarouselDriver(withGalleryDriver(html)), settings, blockDefs), blocks: bl?.blocks as any, blockOrder: bl?.blockOrder as any }
  })

  // Product templates get a native "You may also like" recommendations section at the end.
  if (opts.kind === 'product' && dyn !== 'none') {
    const rk = `${slug}-recs`
    sections.push({ id: rk, key: `sections/${rk}.liquid`, value: recommendationsSection(cssKey), blocks: undefined as any, blockOrder: undefined as any })
  }

  // JSON template: order + reference each section. Home replaces templates/index.json; product/page use a suffix.
  const order: Record<string, any> = {}
  const orderArr: string[] = []
  for (const s of sections) {
    order[s.id] = s.blocks ? { type: s.id, blocks: s.blocks, block_order: s.blockOrder } : { type: s.id }
    orderArr.push(s.id)
  }
  const templateValue = JSON.stringify({ sections: order, order: orderArr }, null, 2)

  const templateKey =
    opts.kind === 'home' ? 'templates/index.json'
    : opts.kind === 'product' ? `templates/product.${opts.templateSuffix}.json`
    : `templates/page.${opts.templateSuffix}.json`

  return {
    cssKey, cssValue,
    sections: sections.map((s) => ({ key: s.key, value: s.value })),
    templateKey, templateValue,
    sectionOrder: orderArr,
  }
}
