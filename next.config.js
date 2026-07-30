/** @type {import('next').NextConfig} */
const nextConfig = {
  // Remotion ships ESM that Next must transpile, or the @remotion/player chunk silently fails to
  // evaluate (the editor hangs on "Loading…"). Required per Remotion's Next.js integration docs.
  transpilePackages: ['remotion', '@remotion/player'],
  images: {
    domains: ['graph.facebook.com', 'scontent.example.com'],
  },
  async redirects() {
    return [
      // NOTE: /home serves HomeLanding — the full "how it works + pricing" page (with #pricing).
      // It must NOT redirect to / (the hire landing has no pricing section), or the footer's
      // "How Mello works & pricing" link dead-ends. Root / = hire pitch; /home = how-it-works+pricing.
      // The brief redirect-era /ads/meta/* structure → back to the canonical flat /ads/* URLs.
      // (Meta is the only platform today; TikTok will get a literal /ads/tiktok/* prefix.)
      { source: '/ads/meta/format/:format', destination: '/ads/format/:format', permanent: true },
      { source: '/ads/meta/:category', destination: '/ads/:category', permanent: true },
      { source: '/ads/meta', destination: '/ads', permanent: true },
    ]
  },
}

module.exports = nextConfig
