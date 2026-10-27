#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const tmpPath = require('os').tmpdir()

async function start() {
  // 检测是否存在 anonymous_token 文件,没有则生成
  if (!fs.existsSync(path.resolve(tmpPath, 'anonymous_token'))) {
    fs.writeFileSync(path.resolve(tmpPath, 'anonymous_token'), '', 'utf-8')
  }
  // 启动时更新anonymous_token
  const generateConfig = require('./generateConfig')
  // The HTTP server does not need the network bootstrap to listen: request.js
  // caches the anonymous token at require time, so refresh it in the background
  // instead of delaying `pnpm dev:api` by a few external round-trips.
  void generateConfig().catch((error) => {
    console.error('[dev api] config bootstrap failed:', error)
  })
  require('./server').serveNcmApi({
    // `npm info` takes ~1.6 s and the package is not on the public registry;
    // the version warning is not worth blocking the dev server for.
    checkVersion: false,
  })
}
start()
