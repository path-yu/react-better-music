/**
 * yt-dlp lookup + one-click install.
 *
 * YouTube cannot be resolved with plain HTTP (the player has to be run), so
 * the app shells out to `yt-dlp`. A user-provided binary wins, then the copy
 * this module installs into the app-data `bin` directory, then PATH.
 */
const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')
const axios = require('axios')

const INSTALL_DIR =
  process.env.QIMIAO_INSTALL_DIR && process.env.QIMIAO_INSTALL_DIR.trim()
    ? process.env.QIMIAO_INSTALL_DIR.trim()
    : process.cwd()
const DATA_DIR =
  process.env.QIMIAO_DATA_DIR && process.env.QIMIAO_DATA_DIR.trim()
    ? process.env.QIMIAO_DATA_DIR.trim()
    : path.join(INSTALL_DIR, 'local-data')

const IS_WINDOWS = process.platform === 'win32'
const BIN_NAME = IS_WINDOWS ? 'yt-dlp.exe' : 'yt-dlp'
const BIN_DIR = path.join(DATA_DIR, 'bin')
const BIN_PATH = path.join(BIN_DIR, BIN_NAME)
const DOWNLOAD_URL = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${BIN_NAME}`

let installing = false

/** Candidate binaries, most specific first. */
function binaries() {
  const list = []
  if (process.env.YT_DLP_PATH && process.env.YT_DLP_PATH.trim()) {
    list.push(process.env.YT_DLP_PATH.trim())
  }
  list.push(BIN_PATH)
  list.push('yt-dlp')
  return [...new Set(list.filter(Boolean))]
}

function readVersion(bin) {
  return new Promise((resolve) => {
    execFile(
      bin,
      ['--version'],
      { timeout: 10_000, windowsHide: true },
      (error, stdout) => {
        if (error) {
          resolve(null)
          return
        }
        const value = String(stdout || '').trim().split(/\s+/)[0]
        resolve(value || null)
      },
    )
  })
}

/** `{ path, version }` for the first working binary, or null. */
async function resolveBinary() {
  for (const bin of binaries()) {
    const version = await readVersion(bin)
    if (version) return { path: bin, version }
  }
  return null
}

async function status() {
  const resolved = await resolveBinary()
  return {
    installed: Boolean(resolved),
    version: resolved ? resolved.version : '',
    path: resolved ? resolved.path : '',
    downloadUrl: DOWNLOAD_URL,
    installing,
  }
}

/** Download the official release into the app-data bin directory. */
async function install() {
  if (installing) {
    const error = new Error('yt-dlp is already being installed')
    error.status = 409
    throw error
  }
  installing = true
  try {
    fs.mkdirSync(BIN_DIR, { recursive: true })
    const response = await axios.get(DOWNLOAD_URL, {
      responseType: 'arraybuffer',
      timeout: 120_000,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      headers: { 'User-Agent': 'react-music' },
      validateStatus: (code) => code === 200,
    })
    const temporary = `${BIN_PATH}.download`
    fs.writeFileSync(temporary, Buffer.from(response.data))
    fs.renameSync(temporary, BIN_PATH)
    if (!IS_WINDOWS) fs.chmodSync(BIN_PATH, 0o755)

    const version = await readVersion(BIN_PATH)
    if (!version) {
      throw new Error('下载的 yt-dlp 无法运行，请稍后重试')
    }
    return { installed: true, version, path: BIN_PATH }
  } finally {
    installing = false
  }
}

module.exports = { resolveBinary, status, install, BIN_PATH }
