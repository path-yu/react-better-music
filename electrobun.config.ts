import type { ElectrobunConfig } from 'electrobun'

export default {
  app: {
    name: '声屿',
    identifier: 'com.qimiao.music',
    version: '0.1.0',
  },
  // Keep the Bun process (and tray) alive even if the last window is destroyed.
  runtime: {
    exitOnLastWindowClosed: false,
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
      'assets/app-icon.ico': 'app-icon.ico',
      'assets/tray-icon.png': 'tray-icon.png',
      'assets/tray.ps1': 'tray.ps1',
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
      icon: 'assets/app-icon.ico',
    },
  },
} satisfies ElectrobunConfig
