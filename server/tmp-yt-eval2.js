const ytdlp = require('./util/ytdlp.js')
const youtube = require('./util/youtube.js')
const cases = [
  { name: 'Blank Space', artist: 'Taylor Swift', durationMs: 231000 },
  { name: '稻香', artist: '周杰伦', durationMs: 223000 },
  { name: 'How You Like That', artist: 'BLACKPINK', durationMs: 182000 },
  { name: '孤勇者', artist: '陈奕迅', durationMs: 256000 },
  { name: 'Hello', artist: 'Adele', durationMs: 295000 },
  { name: 'New Jeans', artist: 'NewJeans', durationMs: 108000 },
]
;(async () => {
  const bin = (await ytdlp.resolveBinary()).path
  for (const item of cases) {
    const t0 = Date.now()
    try {
      const first = (await youtube.__test.search(bin, `${item.name} ${item.artist}`))[0]
      const r = await youtube.matchSong(item)
      console.log(`\n${item.name} (expect ${Math.round(item.durationMs / 1000)}s)`)
      console.log(`  naive:  ${first ? `[${Math.round(first.duration)}s ${first.channel}] ${first.title.slice(0, 50)}` : 'no hit'}`)
      console.log(`  scored: ${r ? `[${Math.round(r.duration)}s score=${r.score} ${r.channel}] ${r.title.slice(0, 50)}` : 'NONE'}  (${Date.now() - t0}ms)`)
    } catch (e) {
      console.log(`${item.name} ERR ${e && e.message}`)
    }
  }
  process.exit(0)
})()
