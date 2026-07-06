'use client'

import { useEffect, useState } from 'react'

/**
 * Viewport-width hook for our inline-styled pages. Inline React styles can't hold @media
 * queries, so components that need to change LAYOUT on mobile (collapse a sidebar, stack a
 * grid, resize a modal) read this and swap style objects instead.
 *
 * SSR-safe: returns `false` on the server and first client render (desktop-first), then
 * corrects after mount — so there's no hydration mismatch, just a post-mount update.
 *
 * @param breakpoint px width at/under which we consider it "mobile" (default 768 = tablet & phones)
 */
export function useIsMobile(breakpoint = 768): boolean {
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`)
    const update = () => setIsMobile(mq.matches)
    update()
    // addEventListener('change') is the modern API; fall back for older Safari.
    if (mq.addEventListener) mq.addEventListener('change', update)
    else mq.addListener(update)
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', update)
      else mq.removeListener(update)
    }
  }, [breakpoint])
  return isMobile
}
