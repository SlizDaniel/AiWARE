import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Keep the running offline demo separate from ordinary builds and dev HMR.
  distDir: process.env.MAGAZYNIER_DEMO_BUILD === '1' ? '.next-demo' : '.next',
  // PGlite loads its WASM/data files from disk; postgres.js uses Node sockets.
  serverExternalPackages: ['@electric-sql/pglite', 'postgres'],
  // Uploads (XLSX/CSV, audio) go through route handlers; Vercel caps bodies at 4.5 MB.
  poweredByHeader: false,
}

export default nextConfig
