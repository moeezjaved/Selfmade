/**
 * /story — PREVIEW of the retold landing ("you hired a marketing department", Hyper-style one-idea
 * sections). Hidden + noindex; the live homepage at `/` is untouched. Swap HireStory into
 * src/app/page.tsx only when the founder approves.
 */
import type { Metadata } from 'next'
import HireStory from '../hire/HireStory'

export const metadata: Metadata = {
  title: 'Selfmade — You just hired a marketing department (preview)',
  robots: { index: false, follow: false },
}

export default function StoryPreviewPage() {
  return <HireStory />
}
