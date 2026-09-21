/** @type {import('next').NextConfig} */
const nextConfig = {
  // Workspace packages ship TypeScript source directly (no separate build
  // step) — Next.js needs to transpile them itself.
  transpilePackages: ['@algotrader/shared-types', '@algotrader/strategy-kernel', '@algotrader/db'],
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET,POST,OPTIONS' },
        ],
      },
    ]
  },
  images: {
    domains: ['query1.finance.yahoo.com'],
  },
}

export default nextConfig
