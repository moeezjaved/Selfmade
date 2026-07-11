'use client'
/** Mounts the once-per-session logo boot splash + the global saved-toast host. Placed in the dashboard layout. */
import { useEffect, useState } from 'react'
import LogoIntro from './LogoIntro'
import { SavedToastHost } from './SavedToast'

export default function BootMotion() {
  const [splash, setSplash] = useState(false)
  useEffect(() => {
    try {
      if (!sessionStorage.getItem('sm_boot_splash')) {
        sessionStorage.setItem('sm_boot_splash', '1')
        setSplash(true)
      }
    } catch { /* sessionStorage blocked → skip splash */ }
  }, [])
  return (
    <>
      {splash && <LogoIntro onDone={() => setSplash(false)} />}
      <SavedToastHost />
    </>
  )
}
