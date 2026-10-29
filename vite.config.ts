import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { lingui } from '@lingui/vite-plugin'

const API_TARGET = process.env.API_TARGET ?? 'http://127.0.0.1:3000'

const proxy = {
  '/api': {
    target: API_TARGET,
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/api/, ''),
  },
}

export default defineConfig(({ mode }) => ({
  resolve: { tsconfigPaths: true },
  build: {
    // Keep desktop bundles separate so `desktop:build` never overwrites the web build.
    outDir: mode === 'electrobun' ? 'dist-electrobun' : 'dist',
  },
  server: {
    port: 5173,
    // Keep the API proxy reachable only from this machine.
    host: 'localhost',
    proxy,
  },
  preview: {
    port: 4173,
    host: 'localhost',
    proxy,
  },
  plugins: [
    devtools(),
    tailwindcss(),
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    viteReact(),
    // Lingui: native macro transform + `.po` imports. Macro transform is
    // opt-in in v6, and without it the macro runtime throws at load time.
    lingui({ macroTransform: true }),
  ],
}))
