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
      // The landing now lives at the root `/`; keep the old /home URL working.
      { source: '/home', destination: '/', permanent: true },
      // The brief redirect-era /ads/meta/* structure → back to the canonical flat /ads/* URLs.
      // (Meta is the only platform today; TikTok will get a literal /ads/tiktok/* prefix.)
      { source: '/ads/meta/format/:format', destination: '/ads/format/:format', permanent: true },
      { source: '/ads/meta/:category', destination: '/ads/:category', permanent: true },
      { source: '/ads/meta', destination: '/ads', permanent: true },
    ]
  },
}

module.exports = nextConfig
