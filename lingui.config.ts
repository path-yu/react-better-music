import { defineConfig } from '@lingui/cli'

export default defineConfig({
  locales: ['zh-CN', 'en'],
  sourceLocale: 'zh-CN',
  catalogs: [
    {
      path: '<rootDir>/src/locales/{locale}',
      include: ['<rootDir>/src'],
      exclude: ['**/*.test.ts', '**/*.test.tsx'],
    },
  ],
})
