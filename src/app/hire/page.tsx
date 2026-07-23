import type { Metadata } from 'next'
import HireKeynote from './HireKeynote'

const SITE = (process.env.NEXT_PUBLIC_APP_URL || 'https://tryselfmade.ai').replace(/\/$/, '')
const TITLE = 'Hire Mello — your first AI marketer'
const DESC = 'Mello reads millions of ads while you sleep, watches your competitors, and reports for work every morning. Read its offer, and countersign to hire your first AI marketer.'

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESC,
  alternates: { canonical: '/hire' },
  openGraph: { type: 'website', siteName: 'Selfmade', url: `${SITE}/hire`, title: TITLE, description: DESC },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESC },
}

export default function HirePage() {
  return <HireKeynote />
}
