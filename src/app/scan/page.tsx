/**
 * /scan — the Ads Theater funnel (Ryze-style). Renders the client ScanTheater.
 * v1: logged-in only (reuses authed discovery + DNA endpoints). Preview/branch, not production.
 */
import type { Metadata } from 'next'
import ScanTheater from '@/components/scan/ScanTheater'
import AmbientAudio from '@/app/AmbientAudio'

export const metadata: Metadata = {
  title: { absolute: 'Free ad audit — how do your ads stack up? | Selfmade' },
  description: "Audit your ads in 90 seconds — your ad presence, your gaps, and what your rivals are winning with. No login.",
  robots: { index: false },   // preview: keep it out of search until productionized
}

export default function ScanPage() {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,600;0,9..144,700;1,9..144,600&display=swap" />
      <ScanTheater />
      {/* Same ambient track as the landing page — starts on first click, stop button bottom-right */}
      <AmbientAudio />
    </>
  )
}
