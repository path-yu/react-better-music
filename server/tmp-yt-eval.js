const ytdlp = require('./util/ytdlp.js')
const youtube = require('./util/youtube.js')
const cases = [
  { name: 'Attention', artist: 'NewJeans', durationMs: 167000 },
  { name: 'Ditto', artist: 'NewJeans', durationMs: 185000 },
  { name: '说谎', artist: '林宥嘉', durationMs: 264000 },
  { name: '起风了', artist: '买辣椒也用券', durationMs: 325000 },
  { name: '晴天', artist: '周杰伦', durationMs: 269000 },
]
;(async () => {
  let st = await ytdlp.status()
  if (!st.installed) {
    const installed = await ytdlp.install()
    console.log('installed yt-dlp', installed.version)
  }
  const bin = (await ytdlp.resolveBinary()).path
  for (const item of cases) {
    const t0 = Date.now()
    try {
      const first = (await youtube.__test.search(bin, `${item.name} ${item.artist}`))[0]
      const r = await youtube.matchSong(item)
      const chosen = r
        ? `[${Math.round(r.duration)}s score=${r.score} ${r.channel}] ${r.title.slice(0, 55)}`
        : 'NONE'
      const naive = first
        ? `[${Math.round(first.duration)}s ${first.channel}] ${first.title.slice(0, 55)}`
        : 'no search hit'
      console.log(`\n${item.name} (expect ${Math.round(item.durationMs / 1000)}s)`)
      console.log(`  naive:  ${naive}`)
      console.log(`  scored: ${chosen}  (${Date.now() - t0}ms)`)
    } catch (e) {
      console.log(`${item.name} ERR ${e && e.message}`)
    }
  }
  process.exit(0)
})()
