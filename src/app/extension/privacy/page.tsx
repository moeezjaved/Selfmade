/**
 * Privacy policy for the Selfmade Chrome extension. Chrome Web Store requires a public privacy
 * policy URL for any extension that requests host/identity access. Keep this URL stable:
 * https://tryselfmade.ai/extension/privacy
 */
export const metadata = {
  title: 'Selfmade Extension — Privacy Policy',
  description: 'How the Selfmade browser extension handles your data.',
}

export default function ExtensionPrivacyPage() {
  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '56px 24px 80px', fontFamily: "'Inter',-apple-system,sans-serif", color: '#1a2b1a', lineHeight: 1.65 }}>
      <h1 style={{ fontSize: 30, fontWeight: 800, margin: '0 0 6px' }}>Selfmade Extension — Privacy Policy</h1>
      <p style={{ color: '#6b7280', fontSize: 14, margin: '0 0 32px' }}>Last updated: July 2026</p>

      <Section title="What the extension does">
        The Selfmade browser extension lets you save ads and posts you choose — from the Facebook Ad
        Library, Instagram, TikTok, and other pages — into your Selfmade account (your boards). You
        trigger every save yourself by clicking a “Save to Selfmade” button.
      </Section>

      <Section title="What we collect">
        <ul style={UL}>
          <li><b>Ads you explicitly save.</b> When you click Save, we send the media URL (and, for
            images, the image data) plus visible context — brand/advertiser name, ad caption, and the
            page URL — to Selfmade so it can be stored on your boards.</li>
          <li><b>Your account token.</b> After you sign in, an authentication token is stored locally
            in the extension and sent with your save requests to prove the save is yours. It is never
            shared with third parties.</li>
        </ul>
      </Section>

      <Section title="What we do NOT do">
        <ul style={UL}>
          <li>We do not read, collect, or transmit page content unless you click Save on a specific item.</li>
          <li>We do not track your browsing history or activity across sites.</li>
          <li>We do not sell or rent your data, and we do not use it for advertising.</li>
          <li>We do not collect passwords, payment details, or form inputs.</li>
        </ul>
      </Section>

      <Section title="Permissions, and why">
        <ul style={UL}>
          <li><b>Host access (all sites):</b> so the “Save” button can appear on the pages where ads
            live. The extension only acts when you click Save.</li>
          <li><b>identity:</b> for the one-click sign-in to your Selfmade account.</li>
          <li><b>storage:</b> to keep you signed in and remember your default board.</li>
        </ul>
      </Section>

      <Section title="Where your saved media is stored">
        Saved images/videos are copied to Selfmade’s storage (Cloudflare R2) so they persist in your
        boards even after the original platform’s links expire. They are visible only to you and, for
        team boards, your organization.
      </Section>

      <Section title="Deleting your data">
        You can remove saved ads from your boards at any time in the app, and revoke the extension’s
        access from Settings → “Save ads anywhere”. Revoking invalidates the extension’s token.
      </Section>

      <Section title="Contact">
        Questions? Email <a href="mailto:support@tryselfmade.ai" style={{ color: '#c2410c', fontWeight: 700 }}>support@tryselfmade.ai</a>.
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 26 }}>
      <h2 style={{ fontSize: 18, fontWeight: 800, margin: '0 0 8px' }}>{title}</h2>
      <div style={{ fontSize: 15, color: '#334155' }}>{children}</div>
    </div>
  )
}

const UL: React.CSSProperties = { margin: '0', paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }
