import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // PGlite loads its WASM/data files from disk; postgres.js uses Node sockets.
  serverExternalPackages: ['@electric-sql/pglite', 'postgres'],
  // Uploads (XLSX/CSV, audio) go through route handlers; Vercel caps bodies at 4.5 MB.
  poweredByHeader: false,
}

export default nextConfig
