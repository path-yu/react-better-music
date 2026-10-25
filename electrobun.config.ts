import type { ElectrobunConfig } from 'electrobun'

export default {
  app: {
    name: 'Qimiao Music',
    identifier: 'com.qimiao.music',
    version: '0.1.0',
  },
  build: {
    mainProcess: 'bun',
    bun: {
      entrypoint: 'src/bun/index.ts',
    },
    // Vite builds to dist-electrobun/, Electrobun serves these through views://
    copy: {
      'dist-electrobun/index.html': 'views/mainview/index.html',
      'dist-electrobun/assets': 'views/mainview/assets',
    },
    watchIgnore: ['dist-electrobun/**'],
    mac: {
      bundleCEF: false,
    },
    linux: {
      bundleCEF: false,
    },
    win: {
      bundleCEF: false,
    },
  },
} satisfies ElectrobunConfig
