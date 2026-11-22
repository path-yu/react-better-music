/**
 * One CDN download per signed media URL, shared by every request for it.
 *
 * The audio element streams a track through /audio/proxy, and ten seconds
 * later the offline cache asks /audio/proxy for the same URL again so it can
 * transcode the whole file. The element's buffer is not readable from JS, so
 * that second request used to download the full track from the CDN again.
 *
 * Now the first full request (no Range, or `bytes=0-`) downloads the file into
 * a temp file at network speed, regardless of how fast the audio element reads,
 * and every request for that URL (playback, seeks inside the downloaded part,
 * the cache job, a replay) reads from the file while it is still growing.
 */
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { EventEmitter } = require('events')
const { Readable } = require('stream')

const ROOT = path.join(os.tmpdir(), 'qimiao-audio-proxy')
const DIR = path.join(ROOT, String(process.pid))
const MAX_ENTRIES = 8
const MAX_TOTAL_BYTES = 300 * 1024 * 1024
const MAX_FILE_BYTES = 80 * 1024 * 1024
/** Signed NetEase media URLs expire after roughly 20 minutes. */
const ENTRY_TTL = 25 * 60 * 1000
/** A seek this far past the downloaded bytes goes to the CDN directly. */
const FAR_SEEK_BYTES = 2 * 1024 * 1024
/**
 * An unfinished download nobody is reading is dropped after this long, so
 * skipping through tracks does not keep downloading every one of them. The
 * audio element stays connected while it plays (it pauses reading instead of
 * disconnecting), and the cache job reads the file ten seconds in.
 */
const IDLE_ABORT_MS = 5000
const CHUNK = 64 * 1024

const entries = new Map()
const starting = new Map()
let prepared = false
/** False when the temp folder cannot be created: plain streaming then. */
let usable = true
let sequence = 0

function prepareDir() {
  if (prepared) return
  prepared = true
  try {
    fs.mkdirSync(DIR, { recursive: true })
    // Folders left by API processes that are gone: the desktop app ends its
    // API child without a normal exit, so 'exit' cleanup does not run there.
    for (const name of fs.readdirSync(ROOT)) {
      if (name === String(process.pid)) continue
      const pid = Number(name)
      let alive = false
      if (Number.isSafeInteger(pid) && pid > 0) {
        try {
          process.kill(pid, 0)
          alive = true
        } catch (error) {
          alive = error && error.code === 'EPERM'
        }
      }
      if (alive) continue
      try {
        fs.rmSync(path.join(ROOT, name), { recursive: true, force: true })
      } catch {
        // in use or already gone
      }
    }
  } catch {
    // The proxy falls back to plain streaming when the temp dir is unusable.
    usable = fs.existsSync(DIR)
  }
  process.once('exit', () => {
    try {
      fs.rmSync(DIR, { recursive: true, force: true })
    } catch {
      // ignore
    }
  })
}

function keyFor(url) {
  return crypto.createHash('sha1').update(url).digest('hex')
}

/** Full file length of a response to a request starting at byte 0. */
function fullLength(response) {
  if (response.status === 200) {
    const length = Number(response.headers['content-length'])
    return Number.isFinite(length) && length > 0 ? length : 0
  }
  const match = /^bytes 0-(\d+)\/(\d+)$/.exec(
    String(response.headers['content-range'] || ''),
  )
  if (!match) return 0
  const total = Number(match[2])
  return Number(match[1]) === total - 1 ? total : 0
}

function evict(entry) {
  if (entries.get(entry.key) === entry) entries.delete(entry.key)
  if (entry.idleTimer) clearTimeout(entry.idleTimer)
  entry.idleTimer = null
  entry.evicted = true
  // An unfinished download is aborted (streams closed, file removed).
  if (!entry.done && !entry.failed) {
    entry.abort()
    return
  }
  entry.events.emit('progress')
  // Open readers keep their handle; the file disappears once they close.
  fs.unlink(entry.file, () => undefined)
}

function armIdleAbort(entry) {
  if (entry.done || entry.failed || entry.readers || entry.idleTimer) return
  entry.idleTimer = setTimeout(() => {
    entry.idleTimer = null
    if (!entry.readers && !entry.done && !entry.failed) evict(entry)
  }, IDLE_ABORT_MS)
  if (typeof entry.idleTimer.unref === 'function') entry.idleTimer.unref()
}

function prune() {
  const now = Date.now()
  for (const entry of [...entries.values()]) {
    if (!entry.readers && now - entry.lastUsed > ENTRY_TTL) evict(entry)
  }
  const idle = [...entries.values()]
    .filter((entry) => !entry.readers)
    .sort((a, b) => a.lastUsed - b.lastUsed)
  let total = 0
  for (const entry of entries.values()) total += entry.size
  while ((entries.size > MAX_ENTRIES || total > MAX_TOTAL_BYTES) && idle.length) {
    const victim = idle.shift()
    total -= victim.size
    evict(victim)
  }
}

function createEntry(url, response) {
  const size = fullLength(response)
  if (!size || size > MAX_FILE_BYTES) return null
  prepareDir()
  if (!usable) return null
  const key = keyFor(url)
  const now = Date.now()
  const entry = {
    key,
    // Unique per download: on Windows a file pending deletion keeps its name.
    file: path.join(DIR, `${key}-${(sequence += 1)}.bin`),
    size,
    written: 0,
    done: false,
    failed: false,
    evicted: false,
    contentType: response.headers['content-type'] || 'audio/mpeg',
    readers: 0,
    idleTimer: null,
    abort: () => undefined,
    createdAt: now,
    lastUsed: now,
    events: new EventEmitter(),
    source: response.data,
  }
  entry.events.setMaxListeners(0)
  let out
  try {
    out = fs.createWriteStream(entry.file)
  } catch {
    return null
  }
  const fail = () => {
    if (entry.done || entry.failed) return
    entry.failed = true
    if (entry.idleTimer) clearTimeout(entry.idleTimer)
    entry.idleTimer = null
    response.data.destroy()
    out.destroy()
    if (entries.get(key) === entry) entries.delete(key)
    fs.unlink(entry.file, () => undefined)
    entry.events.emit('progress')
  }
  entry.abort = fail
  // Only the disk applies backpressure here, never a slow client.
  response.data.on('data', (chunk) => {
    if (entry.failed) return
    const ok = out.write(chunk, (error) => {
      if (error) {
        fail()
        return
      }
      entry.written += chunk.length
      entry.events.emit('progress')
    })
    if (!ok) response.data.pause()
  })
  out.on('drain', () => response.data.resume())
  response.data.on('end', () => {
    out.end(() => {
      if (entry.failed) return
      if (entry.written !== entry.size) {
        fail()
        return
      }
      entry.done = true
      entry.source = null
      if (entry.idleTimer) clearTimeout(entry.idleTimer)
      entry.idleTimer = null
      entry.events.emit('progress')
    })
  })
  response.data.on('error', fail)
  out.on('error', fail)
  // Make room first so the new download is never the one evicted.
  prune()
  entries.set(key, entry)
  // Covers a caller that never attaches a reader.
  armIdleAbort(entry)
  return entry
}

/** Usable cached/in-progress download for this URL, if any. */
function getEntry(url) {
  const entry = entries.get(keyFor(url))
  if (!entry) return null
  if (entry.failed || Date.now() - entry.createdAt > ENTRY_TTL) {
    if (!entry.readers) evict(entry)
    return null
  }
  entry.lastUsed = Date.now()
  return entry
}

/**
 * Start the shared download. Resolves to `{ entry }`, or to `{ response }` when
 * the upstream answer cannot be shared (error status, unknown length) and must
 * be streamed as-is. Concurrent callers for one URL share a single request.
 */
async function startDownload(url, fetchUpstream) {
  const key = keyFor(url)
  const pending = starting.get(key)
  if (pending) {
    const entry = await pending
    return entry ? { entry } : {}
  }
  const task = (async () => {
    const response = await fetchUpstream()
    if (response.status !== 200 && response.status !== 206) return { response }
    const entry = createEntry(url, response)
    return entry ? { entry } : { response }
  })()
  starting.set(
    key,
    task.then(
      (result) => result.entry || null,
      () => null,
    ),
  )
  try {
    return await task
  } finally {
    starting.delete(key)
  }
}

/** Stream bytes [start, end] of a download, waiting for them as they arrive. */
function createReader(entry, start, end) {
  let position = start
  let handle = null
  let reading = false
  let waiting = false
  let released = false
  entry.readers += 1
  if (entry.idleTimer) {
    clearTimeout(entry.idleTimer)
    entry.idleTimer = null
  }
  const release = () => {
    if (released) return
    released = true
    entry.events.off('progress', onProgress)
    entry.readers -= 1
    entry.lastUsed = Date.now()
    if (handle) handle.close().catch(() => undefined)
    armIdleAbort(entry)
  }
  const stream = new Readable({
    highWaterMark: CHUNK,
    read() {
      void pull()
    },
    destroy(error, callback) {
      release()
      callback(error)
    },
  })
  function onProgress() {
    if (!waiting) return
    waiting = false
    void pull()
  }
  entry.events.on('progress', onProgress)

  async function pull() {
    if (reading || stream.destroyed) return
    reading = true
    try {
      if (!handle) handle = await fs.promises.open(entry.file, 'r')
      for (;;) {
        if (stream.destroyed) return
        if (position > end) {
          stream.push(null)
          release()
          return
        }
        const available = Math.min(entry.written, end + 1) - position
        if (available <= 0) {
          if (entry.failed) {
            stream.destroy(new Error('audio download failed'))
            return
          }
          // Resumed by the next 'progress' event.
          waiting = true
          return
        }
        const length = Math.min(CHUNK, available)
        const buffer = Buffer.allocUnsafe(length)
        const { bytesRead } = await handle.read(buffer, 0, length, position)
        if (stream.destroyed) return
        if (!bytesRead) {
          if (entry.done || entry.failed) {
            stream.destroy(new Error('audio cache file is incomplete'))
            return
          }
          waiting = true
          return
        }
        position += bytesRead
        const more = stream.push(
          bytesRead === length ? buffer : buffer.subarray(0, bytesRead),
        )
        // Backpressure: wait for the next read() call.
        if (!more) return
      }
    } catch (error) {
      stream.destroy(error)
    } finally {
      reading = false
    }
  }
  return stream
}

function parseRange(header, size) {
  if (!header) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim())
  if (!match) return undefined
  let start
  let end
  if (match[1] === '') {
    const suffix = Number(match[2])
    if (!suffix) return undefined
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(match[1])
    end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1)
  }
  if (start >= size || start > end) return false
  return { start, end }
}

/**
 * Answer a request from the shared download. Returns false when the caller
 * should go to the CDN instead (multi-range, or a seek far past the bytes
 * that have arrived).
 */
function serve(entry, req, res) {
  const range = parseRange(req.headers.range, entry.size)
  if (range === undefined) return false
  if (range === false) {
    res.status(416)
    res.setHeader('Content-Range', `bytes */${entry.size}`)
    res.end()
    return true
  }
  const start = range ? range.start : 0
  const end = range ? range.end : entry.size - 1
  if (!entry.done && start > entry.written + FAR_SEEK_BYTES) return false
  res.status(range ? 206 : 200)
  res.setHeader('Content-Type', entry.contentType)
  res.setHeader('Content-Length', String(end - start + 1))
  res.setHeader('Accept-Ranges', 'bytes')
  if (range) res.setHeader('Content-Range', `bytes ${start}-${end}/${entry.size}`)
  res.setHeader('Cache-Control', 'private, max-age=300')
  const reader = createReader(entry, start, end)
  reader.on('error', () => res.destroy())
  res.on('close', () => reader.destroy())
  reader.pipe(res)
  return true
}

/** A request for the whole file, which is what starts a shared download. */
function isFullRequest(rangeHeader) {
  return !rangeHeader || /^bytes=0-$/.test(String(rangeHeader).trim())
}

module.exports = { getEntry, startDownload, serve, isFullRequest }
