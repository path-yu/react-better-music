export default {
  scripts: {
    // Vite dev server (HMR) + Electrobun; see scripts/desktop-dev.mjs.
    dev: 'node scripts/desktop-dev.mjs',
    build:
      'hutch electrobun sync && pnpm build:electrobun && hutch electrobun build --env=stable',
  },
  electrobun: {
    version: '2.0.4',
  },
}
