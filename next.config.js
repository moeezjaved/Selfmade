/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    domains: ['graph.facebook.com', 'scontent.example.com'],
  },
  async redirects() {
    return [
      // Legacy ad-gallery URLs → platform-scoped structure (future-proofs TikTok).
      { source: '/ads/format/:format', destination: '/ads/meta/format/:format', permanent: true },
      { source: '/ads/meta', destination: '/ads', permanent: false },
      { source: '/ads/tiktok', destination: '/ads', permanent: false },
      { source: '/ads/:category((?!meta$|tiktok$|format$)[^/]+)', destination: '/ads/meta/:category', permanent: true },
    ]
  },
}

module.exports = nextConfig
