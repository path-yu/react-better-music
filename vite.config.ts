import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { lingui } from '@lingui/vite-plugin'

export default defineConfig(({ mode }) => {
  const API_TARGET =
    process.env.API_TARGET ??
    (mode === 'tauri' ? 'http://127.0.0.1:13000' : 'http://127.0.0.1:3000')

  const proxy = {
    '/api': {
      target: API_TARGET,
      changeOrigin: true,
      rewrite: (path: string) => path.replace(/^\/api/, ''),
    },
  }

  return {
    resolve: { tsconfigPaths: true },
    build: {
      // Keep desktop bundles separate so desktop builds never overwrite the web build.
      outDir:
        mode === 'electrobun'
          ? 'dist-electrobun'
          : mode === 'tauri'
            ? 'dist-tauri'
            : 'dist',
    },
  server: {
    port: 5173,
    // Tauri's devUrl is fixed to 5173. Without strictPort a stale Vite process
    // silently moves to 5174, while Tauri keeps showing the old page — HMR
    // updates then go to the new server that the WebView never connects to.
    strictPort: true,
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
    // Routes ship in the main bundle on purpose. Splitting saved ~16KB gzip on
    // first paint but left the content area blank for 150-300ms on the first
    // visit to each page (the old view unmounts before the chunk lands). On a
    // desktop app the extra bytes load from disk, so no blank frames wins.
    tanstackRouter({ target: 'react', autoCodeSplitting: false }),
    viteReact(),
    // Lingui: native macro transform + `.po` imports. Macro transform is
    // opt-in in v6, and without it the macro runtime throws at load time.
    lingui({ macroTransform: true }),
  ],
  }
})
