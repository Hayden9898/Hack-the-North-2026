import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// Same-origin API: the dev server proxies /api and /health to the FastAPI process on loopback.
// No secrets reach the browser. Shared hosting requires an authenticated server-side gateway;
// the existing API accepts an operator bearer token, not a browser login session.
export default defineConfig(({ mode }) => {
  // Unprefixed: this target is used by the server and never bundled into client code.
  const target = loadEnv(mode, process.cwd(), '').API_PROXY_TARGET || 'http://127.0.0.1:8000'
  const proxy = {
    '/api': { target, changeOrigin: true },
    '/health': { target, changeOrigin: true },
  }
  return {
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      proxy,
    },
    preview: {
      host: '127.0.0.1',
      port: 5173,
      proxy,
    },
  }
})
