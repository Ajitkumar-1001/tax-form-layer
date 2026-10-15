import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src'), 'server-only': path.resolve(__dirname, 'src/lib/server/test-server-only.ts') } },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
})
