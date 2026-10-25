export default {
  scripts: {
    dev: 'hutch electrobun sync && pnpm build:electrobun && hutch electrobun dev --watch',
    build:
      'hutch electrobun sync && pnpm build:electrobun && hutch electrobun build --env=stable',
  },
  electrobun: {
    version: '2.0.4',
  },
}
