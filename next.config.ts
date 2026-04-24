import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  images: {
    domains: ['graph.facebook.com', 'scontent.example.com'],
  },
  experimental: {
    serverActions: { allowedOrigins: ['localhost:3000'] },
  },
}

export default nextConfig
