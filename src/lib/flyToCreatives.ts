/**
 * "Saved to My Creatives" flourish — when a generation completes, a small thumbnail flies from the
 * screen toward the My Creatives nav item and the nav item pulses, so the user knows where to find
 * their new ad. Pure DOM (works from inside a portal modal); no-ops on the server.
 */
export function flyToCreatives(srcUrl?: string) {
  if (typeof document === 'undefined' || typeof window === 'undefined') return
  try {
    const target = (document.querySelector('[data-nav="creatives"]') || document.querySelector('a[href="/creative-studio"]')) as HTMLElement | null
    const tRect = target?.getBoundingClientRect()
    const endX = tRect ? tRect.left + tRect.width / 2 : 60
    const endY = tRect ? tRect.top + tRect.height / 2 : 60
    const startX = window.innerWidth / 2, startY = window.innerHeight / 2
    const w = 120, h = 120

    const el = document.createElement('div')
    el.style.cssText = `position:fixed;left:${startX - w / 2}px;top:${startY - h / 2}px;width:${w}px;height:${h}px;border-radius:16px;z-index:5000;pointer-events:none;box-shadow:0 16px 48px rgba(0,0,0,.45);border:2px solid #dffe95;background:#1a3a1a center/cover no-repeat;`
    if (srcUrl) el.style.backgroundImage = `url("${srcUrl}")`
    document.body.appendChild(el)

    const dx = endX - startX, dy = endY - startY
    const anim = el.animate([
      { transform: 'translate(0,0) scale(1)', opacity: 1, offset: 0 },
      { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 40}px) scale(0.6)`, opacity: 1, offset: 0.6 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.1)`, opacity: 0.1, offset: 1 },
    ], { duration: 900, easing: 'cubic-bezier(.5,-0.1,.3,1)', fill: 'forwards' })

    anim.onfinish = () => {
      el.remove()
      if (target) {
        target.animate([
          { transform: 'scale(1)', boxShadow: '0 0 0 0 rgba(223,254,149,0)' },
          { transform: 'scale(1.12)', boxShadow: '0 0 0 6px rgba(223,254,149,.35)' },
          { transform: 'scale(1)', boxShadow: '0 0 0 0 rgba(223,254,149,0)' },
        ], { duration: 550, easing: 'ease-out' })
      }
    }

    // Tiny toast near the nav so it reads even if the modal covers the sidebar.
    const toast = document.createElement('div')
    toast.textContent = '✓ Saved to My Creatives'
    toast.style.cssText = 'position:fixed;left:24px;bottom:24px;z-index:5001;background:#1a3a1a;color:#dffe95;font:600 13px/1.2 system-ui,sans-serif;padding:11px 15px;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.35);border:1px solid rgba(223,254,149,.3);pointer-events:none;'
    document.body.appendChild(toast)
    toast.animate([
      { opacity: 0, transform: 'translateY(8px)' },
      { opacity: 1, transform: 'translateY(0)', offset: 0.12 },
      { opacity: 1, transform: 'translateY(0)', offset: 0.8 },
      { opacity: 0, transform: 'translateY(8px)', offset: 1 },
    ], { duration: 2600, easing: 'ease' }).onfinish = () => toast.remove()
  } catch { /* animation is cosmetic; never let it break the flow */ }
}
