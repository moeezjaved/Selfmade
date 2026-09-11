import { redirect } from 'next/navigation'

/**
 * The old 8-step M4 launch wizard was removed — it was too complex for users. Quick Launch (/m4/quick) is
 * now the ONLY launch flow. This route just forwards there, preserving any ?img=<creative-url> so a
 * "Run on Facebook" deep-link from a specific ad still lands on that ad pre-selected.
 */
export default async function M4Redirect({ searchParams }: { searchParams: Promise<{ img?: string }> }) {
  const sp = await searchParams
  const img = typeof sp?.img === 'string' ? sp.img : ''
  redirect(img ? `/m4/quick?img=${encodeURIComponent(img)}` : '/m4/quick')
}
