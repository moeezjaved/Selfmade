/**
 * One-off: confirm the Resend key + from-address work. Run with RESEND_API_KEY (+ EMAIL_FROM) set.
 *   docker run --rm -e RESEND_API_KEY=re_xxx -e EMAIL_FROM=onboarding@resend.dev \
 *     -v /opt/worker/src:/app/src selfmade-worker npx tsx src/test-email.mjs
 */
import { sendEmail, emailEnabled } from './email.mjs'

if (!emailEnabled) { console.error('❌ RESEND_API_KEY not set'); process.exit(1) }

const ok = await sendEmail({
  to: process.env.TEST_TO || 'moeez@virginteez.com',
  subject: 'Selfmade — email is working',
  html: '<p>Nice — your <strong>Resend setup works</strong>. New-ad alerts and the weekly digest will send through this.</p>',
})
console.log(ok ? '✅ sent — check the inbox' : '❌ failed — see the resend error above (key? verified from-domain?)')
process.exit(ok ? 0 : 1)
