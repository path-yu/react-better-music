import {
  app,
  BrowserWindow,
  BuildConfig,
  Tray,
  Utils,
  type ElectrobunEvent,
} from 'electrobun/main'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { acquireInstanceLock, releaseInstanceLock } from './instanceLock'
import { applyWindowIcon } from './windowIcon'

const APP_DATA_DIR = join(process.env.LOCALAPPDATA ?? homedir(), 'com.qimiao.music')
const BRIDGE_TOKEN = crypto.randomUUID()
const STARTED_AT = Date.now()
const STARTUP_LOG = join(APP_DATA_DIR, 'startup.log')

/**
 * Record a startup milestone in both the console and `startup.log`. The
 * packaged app has no visible console, so the log is the only way to check
 * whether an optimisation actually moved the needle.
 */
function markStartup(label: string) {
  const line = `${new Date().toISOString()} ${label} +${Date.now() - STARTED_AT}ms`
  console.log(`[startup] ${line}`)
  try {
    mkdirSync(APP_DATA_DIR, { recursive: true })
    appendFileSync(STARTUP_LOG, `${line}\n`)
  } catch {
    // Diagnostics must never break startup.
  }
}

/* --------------------------- developer tooling --------------------------- */

const DEVTOOLS_POLICY_FILE = join(APP_DATA_DIR, 'devtools.json')

/** Missing policy: keep DevTools in dev builds, disable them when packaged. */
function readDevToolsDisabled() {
  try {
    const parsed = JSON.parse(readFileSync(DEVTOOLS_POLICY_FILE, 'utf8')) as {
      disabled?: boolean
    }
    return parsed.disabled !== false
  } catch {
    return BuildConfig.getSync().isPackaged
  }
}

function persistDevToolsDisabled(disabled: boolean) {
  mkdirSync(APP_DATA_DIR, { recursive: true })
  writeFileSync(DEVTOOLS_POLICY_FILE, JSON.stringify({ disabled }), 'utf8')
}

// WebView2 reads this before creating its environment. The renderer also
// blocks the shortcuts and context menu as a fallback (see AppShell).
if (process.platform === 'win32' && readDevToolsDisabled()) {
  const existing = process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS?.trim()
  process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = existing
    ? `${existing} --disable-dev-tools`
    : '--disable-dev-tools'
  console.log('[desktop] WebView2 developer tools disabled for this launch')
}

if (!acquireInstanceLock(APP_DATA_DIR)) {
  console.log('[desktop] another instance is already running, exiting')
  process.exit(0)
}

process.on('exit', () => releaseInstanceLock(APP_DATA_DIR))

const API_PORT = Number(process.env.QIMIAO_API_PORT || 13000)
const API_READY_URL = `http://127.0.0.1:${API_PORT}/ping`

/** Packaged: copied next to this bundle. Dev: the generated file in server/. */
function resolveApiScript() {
  const candidates = [
    join(import.meta.dir, 'api.cjs'),
    join(process.cwd(), 'server/desktop-api.bundle.cjs'),
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

/** Resolve the packaged Bun runtime, falling back to the current executable. */
function resolveBunExecutable() {
  const candidates = [
    join(import.meta.dir, '..', '..', 'bin', 'bun.exe'),
    join(import.meta.dir, '..', '..', 'bin', 'bun'),
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? process.execPath
}

let apiProcess: ReturnType<typeof Bun.spawn> | null = null
let apiStarted = false

/**
 * Run the 12 MB API bundle in a child Bun process. Parsing it in this process
 * would block the thread that also serves views:// assets, so the child boots
 * in parallel while the renderer retries its first requests.
 */
function startApiServer() {
  if (apiStarted) return
  apiStarted = true
  const script = resolveApiScript()
  if (!script) {
    console.error('[desktop] bundled API script not found')
    return
  }
  try {
    apiProcess = Bun.spawn([resolveBunExecutable(), script], {
      env: {
        ...process.env,
        QIMIAO_API_PORT: String(API_PORT),
        QIMIAO_API_PARENT_PID: String(process.pid),
      },
      stdout: 'inherit',
      stderr: 'inherit',
    })
    markStartup('api-child-spawned')
    console.log(`[desktop] API child started (pid ${apiProcess.pid})`)
  } catch (error) {
    console.error('[desktop] failed to start API child:', error)
    return
  }
  void apiProcess.exited.then((code) => {
    apiProcess = null
    console.error(`[desktop] API child exited with code ${code}`)
  })
  // The renderer already retries; this only records readiness in startup.log.
  void (async () => {
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      try {
        const response = await fetch(API_READY_URL)
        if (response.ok) {
          markStartup('api-ready')
          return
        }
      } catch {
        // not listening yet
      }
      await Bun.sleep(120)
    }
  })()
}

function stopApiServer() {
  if (!apiProcess) return
  try {
    apiProcess.kill()
  } catch {
    // already gone
  }
  apiProcess = null
}

process.on('exit', stopApiServer)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    stopApiServer()
    process.exit(0)
  })
}

function createMainWindow() {
  const window = new BrowserWindow({
    title: '声屿',
    url: `views://mainview/index.html?bridgeToken=${encodeURIComponent(BRIDGE_TOKEN)}`,
    // The renderer draws its own title bar (drag region + window buttons).
    // `hiddenInset` keeps the native traffic lights on macOS and, on Windows /
    // Linux, removes the system caption while keeping the resize border.
    titleBarStyle: 'hiddenInset',
    frame: {
      width: 1440,
      height: 900,
      x: 80,
      y: 60,
    },
  })

  // Closing the titlebar hides the window to the tray: music keeps playing and
  // the app can be quit explicitly from the tray menu.
  window.on('will-close', (event) => {
    console.log('[desktop] will-close fired, hiding to tray')
    const closeEvent = event as ElectrobunEvent<{ id: number }, { allow: boolean }>
    closeEvent.response = { allow: false }
    window.hide()
  })

  applyWindowIcon()
  return window
}

let mainWindow: BrowserWindow | null = createMainWindow()
markStartup('window-created')
// The API runs in its own Bun process, so spawn it right away: it no longer
// competes with the WebView for the main thread.
startApiServer()

function showMainWindow() {
  if (!mainWindow) {
    mainWindow = createMainWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.unminimize()
  mainWindow.show()
  mainWindow.activate()
}

if (process.platform === 'win32') {
  // Electrobun's Windows tray opens its menu on left click. A tiny WinForms
  // helper gives the expected behavior instead: left click shows the window,
  // right click opens the menu with the quit action.
  const script = join(import.meta.dir, '..', 'tray.ps1')
  const icon = join(import.meta.dir, '..', 'app-icon.ico')
  if (existsSync(script)) {
    // Spawning PowerShell costs a burst of CPU; give the first paint a head
    // start instead of competing with the WebView for it.
    setTimeout(() => {
      try {
        Bun.spawn(
          [
            'powershell.exe',
            '-NoProfile',
            '-NonInteractive',
            '-WindowStyle',
            'Hidden',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            script,
            String(process.pid),
            '声屿',
            icon,
          ],
          { stdout: 'ignore', stderr: 'ignore', windowsHide: true },
        )
        console.log('[desktop] tray helper started')
      } catch (error) {
        console.error('[desktop] failed to start tray helper:', error)
      }
    }, 1200)
  }
} else {
  const trayImage = [
    join(import.meta.dir, '..', 'tray-icon.png'),
    join(import.meta.dir, '..', 'app-icon.ico'),
  ].find((candidate) => existsSync(candidate))

  const tray = new Tray({
    title: '声屿',
    image: trayImage ?? '',
    template: false,
    width: 16,
    height: 16,
  })

  tray.setMenu([
    { type: 'normal', label: '显示主窗口', action: 'show' },
    { type: 'divider' },
    { type: 'normal', label: '退出声屿', action: 'quit' },
  ])

  tray.on('tray-clicked', (event) => {
    const action = (event as { data?: { action?: string } } | undefined)?.data?.action
    if (action === 'quit') {
      tray.remove()
      Utils.quit()
      return
    }
    if (!action || action === 'show') showMainWindow()
  })
}

// If the window is destroyed anyway, keep the tray alive and recreate it on demand.
app.on('close', (payload) => {
  const id = (payload as { id?: number } | undefined)?.id
  if (id && mainWindow?.id === id) mainWindow = null
})

/* --------------------------- download directory --------------------------- */

const DOWNLOAD_DIR_FILE = join(APP_DATA_DIR, 'download-dir.json')
const DEFAULT_DOWNLOAD_DIR = join(homedir(), 'Downloads')
const DOWNLOAD_BRIDGE_PORT = 13002

function readDownloadDir() {
  try {
    const parsed = JSON.parse(readFileSync(DOWNLOAD_DIR_FILE, 'utf8')) as { dir?: string }
    if (parsed.dir && existsSync(parsed.dir)) return parsed.dir
  } catch {
    // no saved setting yet
  }
  return DEFAULT_DOWNLOAD_DIR
}

let downloadDir = readDownloadDir()

function persistDownloadDir(dir: string) {
  downloadDir = dir
  mkdirSync(APP_DATA_DIR, { recursive: true })
  writeFileSync(DOWNLOAD_DIR_FILE, JSON.stringify({ dir }), 'utf8')
}

function uniqueDownloadPath(name: string) {
  const safe = name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'download.opus'
  let target = join(downloadDir, safe)
  if (!existsSync(target)) return target
  const dot = safe.lastIndexOf('.')
  const base = dot > 0 ? safe.slice(0, dot) : safe
  const ext = dot > 0 ? safe.slice(dot) : ''
  let index = 1
  do {
    target = join(downloadDir, `${base} (${index})${ext}`)
    index += 1
  } while (existsSync(target))
  return target
}

/* ------------------------------ window controls ----------------------------- */

/** Mirrors the real window state so the custom title bar can render correctly. */
function currentWindowState() {
  const win = mainWindow
  return {
    maximized: win?.isMaximized() ?? false,
    minimized: win?.isMinimized() ?? false,
    fullScreen: win?.isFullScreen() ?? false,
  }
}

/**
 * Applies a window action requested by the renderer's custom title bar.
 * Returns null when the action is unknown.
 */
function applyWindowAction(action: string | null) {
  const win = mainWindow
  if (!win) return null

  switch (action) {
    case 'minimize':
      win.minimize()
      return currentWindowState()
    case 'toggle-maximize':
      if (win.isMaximized()) win.unmaximize()
      else win.maximize()
      return currentWindowState()
    case 'close':
      // Same path as the native close button: `will-close` hides the window to
      // the tray so playback keeps running.
      win.requestClose()
      return currentWindowState()
    default:
      return null
  }
}

const DEV_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/

function bridgeHeaders(request: Request) {
  const origin = request.headers.get('origin') ?? ''
  // Electrobun views use a custom scheme (sometimes surfaced as "null");
  // dev builds are served from localhost.
  const allowed =
    origin.startsWith('views://') || origin === 'null' || DEV_ORIGIN.test(origin)
  return {
    ...(allowed ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Bridge-Token',
    'Access-Control-Allow-Private-Network': 'true',
  }
}

function isBridgeAuthorized(request: Request) {
  return request.headers.get('x-bridge-token') === BRIDGE_TOKEN
}

try {
  Bun.serve({
    hostname: '127.0.0.1',
    port: DOWNLOAD_BRIDGE_PORT,
    async fetch(request) {
      const url = new URL(request.url)
      const headers = bridgeHeaders(request)
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers })
      }
      if (!isBridgeAuthorized(request)) {
        return new Response('Unauthorized', { status: 401, headers })
      }
      try {
        if (url.pathname === '/startup-report' && request.method === 'POST') {
          const body = (await request.json().catch(() => null)) as { paint?: number } | null
          markStartup(`renderer-first-paint webview=${Math.round(Number(body?.paint ?? 0))}ms`)
          return Response.json({ ok: true }, { headers })
        }
        if (url.pathname === '/devtools-policy' && request.method === 'GET') {
          return Response.json({ disabled: readDevToolsDisabled() }, { headers })
        }
        if (url.pathname === '/devtools-policy' && request.method === 'POST') {
          const disabled = url.searchParams.get('disabled') !== '0'
          persistDevToolsDisabled(disabled)
          return Response.json({ disabled }, { headers })
        }
        if (url.pathname === '/window-state' && request.method === 'GET') {
          return Response.json(currentWindowState(), { headers })
        }
        if (url.pathname === '/window-action' && request.method === 'POST') {
          const state = applyWindowAction(url.searchParams.get('action'))
          if (!state) {
            return Response.json(
              { error: 'unsupported window action' },
              { status: 400, headers },
            )
          }
          return Response.json(state, { headers })
        }
        if (url.pathname === '/download-dir' && request.method === 'GET') {
          return Response.json({ dir: downloadDir }, { headers })
        }
        if (url.pathname === '/pick-dir' && request.method === 'POST') {
          const chosen = await Utils.openFileDialog({
            startingFolder: downloadDir,
            canChooseFiles: false,
            canChooseDirectory: true,
            allowsMultipleSelection: false,
          })
          const picked = chosen?.[0]
          if (!picked) {
            return Response.json(
              { dir: downloadDir, cancelled: true },
              { headers },
            )
          }
          persistDownloadDir(picked)
          return Response.json({ dir: picked }, { headers })
        }
        if (url.pathname === '/open-dir' && request.method === 'POST') {
          mkdirSync(downloadDir, { recursive: true })
          Utils.openPath(downloadDir)
          return Response.json({ dir: downloadDir }, { headers })
        }
        if (url.pathname === '/save-file' && request.method === 'POST') {
          const name = url.searchParams.get('name') ?? 'download.opus'
          mkdirSync(downloadDir, { recursive: true })
          const target = uniqueDownloadPath(name)
          const bytes = await request.arrayBuffer()
          await Bun.write(target, bytes)
          return Response.json({ path: target }, { headers })
        }
      } catch (error) {
        return Response.json(
          { error: error instanceof Error ? error.message : 'download bridge error' },
          { status: 500, headers },
        )
      }
      return new Response('Not found', { status: 404, headers })
    },
  })
  console.log(`[desktop] download bridge ready on http://127.0.0.1:${DOWNLOAD_BRIDGE_PORT}`)
} catch (error) {
  console.error('[desktop] failed to start download bridge:', error)
}

console.log('[desktop] Electrobun app started')
