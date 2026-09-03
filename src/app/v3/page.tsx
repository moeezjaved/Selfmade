import type { Metadata } from 'next'
import LandingV3 from './LandingV3'

// Preview-only route for the redesign. Not linked, noindex — the live landing at / is untouched.
export const metadata: Metadata = {
  title: 'Selfmade — v3 preview',
  robots: { index: false, follow: false },
}

export default function Page() {
  return <LandingV3 />
}
