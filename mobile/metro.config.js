const { getDefaultConfig } = require('expo/metro-config')
const { withNativeWind } = require('nativewind/metro')
const path = require('node:path')
const http = require('node:http')

const config = getDefaultConfig(__dirname)
// Shared domain helpers live in the web source tree; native packages resolve from mobile/.
config.watchFolders = [path.resolve(__dirname, '../src')]
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules')]
// Opt-in dev proxy: phone and API share the Expo tunnel when LAN access is blocked.
if (process.env.MAGAZYNIER_TUNNEL_API === '1') {
  config.server.enhanceMiddleware = middleware => (request, response, next) => {
    if (!request.url?.startsWith('/api/')) return middleware(request, response, next)
    const upstream = http.request({
      hostname: '127.0.0.1', port: 3000, path: request.url, method: request.method,
      headers: { ...request.headers, host: '127.0.0.1:3000' },
    }, result => {
      response.writeHead(result.statusCode ?? 502, result.headers)
      result.pipe(response)
    })
    upstream.setTimeout(35_000, () => upstream.destroy())
    upstream.on('error', () => {
      if (response.headersSent) return response.destroy()
      response.writeHead(502, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ detail: 'Backend lokalny nie odpowiada.' }))
    })
    request.on('aborted', () => upstream.destroy())
    request.pipe(upstream)
  }
}
module.exports = withNativeWind(config, { input: './global.css' })
