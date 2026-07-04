/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    domains: ['graph.facebook.com', 'scontent.example.com'],
  },
  async redirects() {
    return [
      // The brief redirect-era /ads/meta/* structure → back to the canonical flat /ads/* URLs.
      // (Meta is the only platform today; TikTok will get a literal /ads/tiktok/* prefix.)
      { source: '/ads/meta/format/:format', destination: '/ads/format/:format', permanent: true },
      { source: '/ads/meta/:category', destination: '/ads/:category', permanent: true },
      { source: '/ads/meta', destination: '/ads', permanent: true },
    ]
  },
}

module.exports = nextConfig
