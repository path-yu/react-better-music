import { defineConfig } from 'vitest/config'
import { lingui } from '@lingui/vite-plugin'

export default defineConfig({
  // Same macro transform and .po loader as the app build, so modules that use
  // Lingui (directly or through src/i18n.ts) can be imported by tests.
  plugins: [lingui({ macroTransform: true })],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    restoreMocks: true,
  },
})
