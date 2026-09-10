import { defineConfig } from 'vite'
import basicSsl from '@vitejs/plugin-basic-ssl'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), ...(process.env.VITE_NO_SSL ? [] : [basicSsl()])],
  define: {
    global: 'globalThis',
  },
  resolve: {
    alias: {
      buffer: 'buffer/',
    },
  },
  optimizeDeps: {
    include: ['buffer'],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Keep shared preload/Buffer helpers out of the multi-megabyte wallet
          // chunk so the standalone cover canvas can load independently.
          if (id.includes('vite/preload-helper') || id.includes('commonjsHelpers') || /node_modules\/(buffer|base64-js|ieee754)\//.test(id)) return 'polyfills'
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/')) {
            return 'react-vendor'
          }
          // NOTE: Do NOT split @hashgraph/sdk into its own chunk — it has internal
          // circular dependencies that cause "Cannot access 'BN$9' before initialization"
          if (
            id.includes('node_modules/hashconnect/') ||
            id.includes('node_modules/@walletconnect/') ||
            id.includes('node_modules/@hashgraph/hedera-wallet-connect/')
          ) {
            return 'wallet'
          }
        },
      },
    },
  },
  server: {
    host: 'localhost',
    port: 5173,
    strictPort: true,
    ...(process.env.VITE_NO_SSL ? {} : { https: {} }),
    proxy: {
      '/api/quorum': {target:'https://quorum.aivylabs.xyz',changeOrigin:true,rewrite:path=>path.replace(/^\/api\/quorum/, '/api/cover-agents')},
      '/api': 'http://127.0.0.1:3001',
    },
  },
})
