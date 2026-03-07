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
      '/api': 'http://127.0.0.1:3001',
    },
  },
})
