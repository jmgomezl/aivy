/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  define: {
    global: 'globalThis',
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: [
      'tests/**/*.test.ts',
      'tests/**/*.test.tsx',
    ],
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'text-summary'],
      include: [
        'server/auth.ts',
        'server/crypto.ts',
        'server/middleware.ts',
        'server/scheduler.ts',
        'src/utils.ts',
        'src/lib/auth.ts',
        'src/data.ts',
      ],
    },
  },
})
