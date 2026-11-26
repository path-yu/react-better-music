const ytdlp = require('./util/ytdlp.js')
const youtube = require('./util/youtube.js')
;(async () => {
  const bin = (await ytdlp.resolveBinary()).path
  const meta = { name: '孤勇者', artist: '陈奕迅', durationMs: 256000 }
  const entries = await youtube.__test.search(bin, '孤勇者 陈奕迅')
  for (const e of entries) {
    console.log(`[${Math.round(e.duration)}s] ${e.channel} | ${e.title.slice(0, 60)}`)
  }
  process.exit(0)
})()
