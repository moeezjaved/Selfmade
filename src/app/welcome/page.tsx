/**
 * /welcome — RETIRED. The employment agreement is no longer a post-signup gate; it appears only at the
 * upgrade wall (/upgrade), which uses the landing-page agreement design (HireAgreement). After signup the
 * app is freely viewable, so this route just forwards into it. Kept as a redirect so old links don't 404.
 */
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default function WelcomePage() {
  redirect('/hq')
}
