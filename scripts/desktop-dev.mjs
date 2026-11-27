/**
 * Desktop dev with renderer HMR.
 *
 * `hutch electrobun dev` alone only watches the Bun main process: the window
 * loads the prebuilt `views://` bundle, so renderer edits never hot-reload.
 * This script starts Vite (mode `electrobun`, so VITE_DESKTOP / API base are
 * present) and points the Electrobun window at it through QIMIAO_DEV_URL.
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'

const DEV_URL = 'http://localhost:5173'
const DEV_PORT = 5173
const isWindows = process.platform === 'win32'
const pnpm = isWindows ? 'pnpm.cmd' : 'pnpm'

let vite = null
let app = null
let stopping = false

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} ${args.join(' ')} exited with ${code}`))
    })
  })
}

async function waitForServer(url, timeout = 30_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.status < 500) return
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  throw new Error(`Vite dev server did not start at ${url}`)
}

/** `kill()` leaves the Electrobun child process alive on Windows. */
function killTree(child) {
  if (!child) return
  try {
    if (isWindows) {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    } else {
      child.kill('SIGTERM')
    }
  } catch {
    // already gone
  }
}

function listeningPids(port) {
  if (isWindows) {
    try {
      // Do not restrict to `-p tcp`: Vite may listen on the IPv6 loopback
      // (`[::1]:5173`), which would be missed by the IPv4-only table.
      const output = execFileSync('netstat', ['-ano'], {
        encoding: 'utf8',
      })
      const pids = new Set()
      for (const line of output.split(/\r?\n/)) {
        if (!/LISTENING/i.test(line)) continue
        const fields = line.trim().split(/\s+/)
        if (!fields[1]?.endsWith(`:${port}`)) continue
        const pid = Number(fields.at(-1))
        if (Number.isInteger(pid) && pid > 0) pids.add(pid)
      }
      return [...pids]
    } catch {
      return []
    }
  }
  try {
    const output = execFileSync(
      'lsof',
      ['-tiTCP:' + port, '-sTCP:LISTEN'],
      { encoding: 'utf8' },
    )
    return [...new Set(output.split(/\s+/).map(Number).filter(Boolean))]
  } catch {
    return []
  }
}

function killPid(pid) {
  if (isWindows) {
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], {
      stdio: 'ignore',
    })
  } else {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      // Already gone.
    }
  }
}

/**
 * A previous `desktop:dev` keeps Vite on :5173. Kill that listener first; its
 * parent desktop-dev process notices Vite exiting and shuts down the old
 * Electrobun window. Then wait for the port before StrictPort starts Vite.
 */
async function stopStaleDevServer() {
  const pids = listeningPids(DEV_PORT)
  if (!pids.length) return
  console.log(
    `[desktop-dev] stopping previous dev server on :${DEV_PORT} (pid ${pids.join(', ')})…`,
  )
  for (const pid of pids) killPid(pid)

  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    if (!listeningPids(DEV_PORT).length) return
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`Port ${DEV_PORT} is still in use after stopping old dev server`)
}

/**
 * Electrobun patches the app icon into `launcher.exe` and `bun.exe` on every
 * dev start. If a previous run died mid-patch (or left the Win32 `.old`
 * replacement behind), the next start aborts with `EndResourceUpdateFailed`
 * and no window opens. Removing the patched executables makes hutch copy
 * pristine templates again — cheaper than wiping the whole dev bundle, and it
 * covers both binaries (resetting only the launcher just moves the failure to
 * bun.exe).
 */
function resetDevBinaries() {
  const devRoot = path.join(process.cwd(), 'build', 'dev-win-x64')
  if (!existsSync(devRoot)) return
  let reset = 0
  for (const appDir of readdirSync(devRoot)) {
    const binDir = path.join(devRoot, appDir, 'bin')
    if (!existsSync(binDir)) continue
    for (const file of readdirSync(binDir)) {
      if (!/\.exe(\.old)?$/i.test(file)) continue
      rmSync(path.join(binDir, file), { force: true })
      reset += 1
    }
  }
  if (reset) console.log(`[desktop-dev] reset ${reset} patched binar(ies)`)
}

function shutdown(code = 0) {
  if (stopping) return
  stopping = true
  killTree(app)
  killTree(vite)
  // Give taskkill a moment before the shell tears down.
  setTimeout(() => process.exit(code), 300)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

try {
  await stopStaleDevServer()
  resetDevBinaries()
  console.log('[desktop-dev] syncing Electrobun…')
  await run('hutch', ['electrobun', 'sync'], { shell: isWindows })

  // Views/app bundle are still produced once so hutch has something to copy;
  // renderer edits after this point are served by Vite.
  console.log('[desktop-dev] preparing desktop bundles…')
  await run(pnpm, ['run', 'build:electrobun'], { shell: isWindows })

  console.log('[desktop-dev] starting Vite (HMR)…')
  vite = spawn(
    process.execPath,
    [
      'node_modules/vite/bin/vite.js',
      'dev',
      '--mode',
      'electrobun',
      '--port',
      '5173',
      '--strictPort',
    ],
    { stdio: 'inherit', env: process.env },
  )
  vite.on('exit', (code) => {
    if (stopping) return
    console.error(`[desktop-dev] Vite exited (${code ?? 0})`)
    shutdown(code ?? 1)
  })

  await waitForServer(DEV_URL)

  console.log('[desktop-dev] starting Electrobun…')
  app = spawn('hutch', ['electrobun', 'dev', '--watch'], {
    stdio: 'inherit',
    shell: isWindows,
    // The window loads this URL instead of views://; see src/bun/index.ts.
    env: { ...process.env, QIMIAO_DEV_URL: DEV_URL },
  })
  app.on('exit', (code) => {
    if (stopping) return
    shutdown(code ?? 0)
  })
} catch (error) {
  console.error('[desktop-dev]', error instanceof Error ? error.message : error)
  shutdown(1)
}
