import {
  app,
  BrowserWindow,
  BuildConfig,
  GlobalShortcut,
  Screen,
  Tray,
  Utils,
  type ElectrobunEvent,
} from 'electrobun/main'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { acquireInstanceLock, releaseInstanceLock } from './instanceLock'
import { LYRICS_WINDOW_HTML } from './lyricsWindowHtml'
import { MINI_PLAYER_HTML } from './miniPlayerHtml'
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

/** Renderer <-> main-process bridge (downloads, window controls, lyrics). */
const BRIDGE_PORT = 13002

if (!acquireInstanceLock(APP_DATA_DIR)) {
  // A pinned taskbar icon launches a second process when the main window is
  // hidden to the tray (there is no taskbar button to click). Ask the running
  // instance to reveal its window, then exit; otherwise the click does nothing.
  console.log('[desktop] another instance is already running, activating it')
  void (async () => {
    // The first instance may still be bringing its bridge up; retry briefly.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        const response = await fetch(`http://127.0.0.1:${BRIDGE_PORT}/activate`, {
          method: 'POST',
          signal: AbortSignal.timeout(500),
        })
        if (response.ok) return
      } catch {
        // Bridge not ready yet; wait and retry.
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  })().finally(() => process.exit(0))
}

process.on('exit', () => releaseInstanceLock(APP_DATA_DIR))

// A single stray rejection (native bridge hiccup, closed window handle) must not
// tear down the whole desktop app and interrupt playback.
process.on('uncaughtException', (error) => {
  console.error('[desktop] uncaught exception:', error)
})
process.on('unhandledRejection', (reason) => {
  console.error('[desktop] unhandled rejection:', reason)
})

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

/**
 * Dev runs point the window at Vite so renderer edits hot-reload; packaged
 * builds keep loading the bundled views.
 */
function mainViewUrl() {
  const query = `bridgeToken=${encodeURIComponent(BRIDGE_TOKEN)}`
  const devUrl = process.env.QIMIAO_DEV_URL?.trim()
  if (devUrl) return `${devUrl.replace(/\/+$/, '')}/?${query}`
  return `views://mainview/index.html?${query}`
}

/** Reveals the current window; replaced whenever a window is created. */
let revealCurrentWindow: (() => void) | null = null

function revealMainWindow() {
  revealCurrentWindow?.()
}

function createMainWindow() {
  const window = new BrowserWindow({
    title: '声屿',
    url: mainViewUrl(),
    // The renderer draws its own title bar (drag region + window buttons).
    // `hiddenInset` keeps the native traffic lights on macOS and, on Windows /
    // Linux, removes the system caption while keeping the resize border.
    titleBarStyle: 'hiddenInset',
    // Created hidden so the first visible frame is the inline boot shell from
    // index.html, never the white native WebView surface.
    hidden: true,
    frame: {
      width: 1440,
      height: 900,
      x: 80,
      y: 60,
    },
  })

  let revealed = false
  const reveal = () => {
    if (revealed) return
    revealed = true
    try {
      window.show()
      window.activate()
      markStartup('window-shown')
    } catch (error) {
      console.error('[desktop] failed to reveal the main window:', error)
    }
  }
  revealCurrentWindow = reveal
  // The document is parsed: the inline background/skeleton is ready to paint.
  window.on('dom-ready', (event) => {
    const url = (event as { data?: { detail?: string } })?.data?.detail ?? ''
    // BrowserWindow may emit dom-ready for its initial about:blank first.
    if (!url || url === 'about:blank') return
    setTimeout(reveal, 40)
  })
  // Safety net: never leave a hidden window if dom-ready is missed.
  setTimeout(reveal, 2500)

  // Closing the titlebar hides the window to the tray: music keeps playing and
  // the app can be quit explicitly from the tray menu.
  window.on('will-close', (event) => {
    const closeEvent = event as ElectrobunEvent<{ id: number }, { allow: boolean }>
    try {
      console.log('[desktop] will-close fired, hiding to tray')
      closeEvent.response = { allow: false }
      window.hide()
    } catch (error) {
      // A destroyed handle cannot be hidden; allow the close so the tray can
      // recreate the window instead of throwing out of the event handler.
      console.error('[desktop] failed to hide the main window:', error)
      closeEvent.response = { allow: true }
    }
  })

  applyWindowIcon()
  enableNativeWindowControls('声屿')
  return window
}

let mainWindow: BrowserWindow | null = null
try {
  mainWindow = createMainWindow()
  markStartup('window-created')
} catch (error) {
  // Keep the process (and tray) alive; the tray can retry window creation.
  console.error('[desktop] failed to create the main window:', error)
}
// The API runs in its own Bun process, so spawn it right away: it no longer
// competes with the WebView for the main thread.
startApiServer()

function showMainWindow() {
  try {
    if (!mainWindow) {
      mainWindow = createMainWindow()
      return
    }
    if (mainWindow.isMinimized()) mainWindow.unminimize()
    mainWindow.show()
    mainWindow.activate()
  } catch (error) {
    console.error('[desktop] failed to show the main window:', error)
    try {
      mainWindow?.close()
    } catch {
      // already destroyed
    }
    mainWindow = null
    try {
      mainWindow = createMainWindow()
    } catch (recreateError) {
      console.error('[desktop] failed to recreate the main window:', recreateError)
    }
  }
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
            String(BRIDGE_PORT),
            BRIDGE_TOKEN,
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
  const isMac = process.platform === 'darwin'
  const trayImage = [
    join(import.meta.dir, '..', isMac ? 'tray-icon-template.png' : 'tray-icon.png'),
    join(import.meta.dir, '..', 'app-icon.ico'),
  ].find((candidate) => existsSync(candidate))

  const tray = new Tray({
    title: '声屿',
    image: trayImage ?? '',
    // macOS menu-bar symbols are template images: AppKit supplies the light /
    // dark tint. Windows and Linux keep the coloured icon.
    template: isMac,
    width: 16,
    height: 16,
  })

  tray.setMenu([
    { type: 'normal', label: '播放 / 暂停', action: 'play-pause' },
    { type: 'normal', label: '上一首', action: 'previous' },
    { type: 'normal', label: '下一首', action: 'next' },
    { type: 'divider' },
    { type: 'normal', label: '桌面歌词', action: 'lyrics' },
    { type: 'normal', label: '迷你播放器', action: 'mini' },
    { type: 'divider' },
    { type: 'normal', label: '显示主窗口', action: 'show-main' },
    { type: 'normal', label: '退出声屿', action: 'quit' },
  ])

  tray.on('tray-clicked', (event) => {
    const action = (event as { data?: { action?: string } } | undefined)?.data?.action
    if (action === 'quit') {
      tray.remove()
      Utils.quit()
      return
    }
    if (!action) {
      showMainWindow()
      return
    }
    applyCommand(action)
  })
}

// If the window is destroyed anyway, keep the tray alive and recreate it on demand.
app.on('close', (payload) => {
  const id = (payload as { id?: number } | undefined)?.id
  if (id && mainWindow?.id === id) mainWindow = null
  if (id && lyricsWindow?.id === id) lyricsWindow = null
  if (id && miniWindow?.id === id) miniWindow = null
})

/* ------------------------------ desktop lyrics ---------------------------- */

/**
 * A second, transparent and frameless window that floats above other apps and
 * renders nothing but the current lyric. Its page is served by the local bridge
 * (`/lyrics`); the main renderer pushes lyric/progress snapshots to
 * `/lyrics-state`, and the page polls them back.
 */
/**
 * Auxiliary windows must not create taskbar buttons or Alt-Tab entries.
 * Electrobun exposes no skipTaskbar option, so flip WS_EX_TOOLWINDOW on the
 * native HWND through a tiny PowerShell helper (same pattern as the tray).
 */
/**
 * Electrobun's hiddenInset title bar drops WS_MINIMIZEBOX on Windows. Restore
 * the native style bits so the taskbar button and window.minimize() work while
 * keeping the custom title bar.
 */
function enableNativeWindowControls(title: string) {
  if (process.platform !== 'win32') return
  const script = [
    join(import.meta.dir, '..', 'window-controls.ps1'),
    join(process.cwd(), 'assets/window-controls.ps1'),
  ].find((candidate) => existsSync(candidate))
  if (!script) return
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
        title,
      ],
      { stdout: 'ignore', stderr: 'ignore', windowsHide: true },
    )
  } catch (error) {
    console.warn('[desktop] failed to restore native window controls:', error)
  }
}

function hideAuxiliaryFromTaskbar(title: string) {
  if (process.platform !== 'win32') return
  const script = join(import.meta.dir, '..', 'hide-taskbar.ps1')
  if (!existsSync(script)) return
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
        title,
      ],
      { stdout: 'ignore', stderr: 'ignore', windowsHide: true },
    )
  } catch (error) {
    console.warn('[desktop] failed to hide window from taskbar:', error)
  }
}

const LYRICS_SHORTCUT = 'CommandOrControl+Shift+L'
const LYRICS_WINDOW_FILE = join(APP_DATA_DIR, 'lyrics-window.json')
const LYRICS_WINDOW_SIZE = { width: 960, height: 200 }
const LYRICS_WINDOW_MARGIN = 96

let lyricsWindow: BrowserWindow | null = null
let lyricsMoveTimer: ReturnType<typeof setTimeout> | null = null
/** Latest snapshot posted by the main window; polled by the HUD page. */
let lyricsState: Record<string, unknown> | null = null

function readLyricsPosition() {
  try {
    const parsed = JSON.parse(readFileSync(LYRICS_WINDOW_FILE, 'utf8')) as {
      x?: number
      y?: number
    }
    if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
      return { x: parsed.x, y: parsed.y }
    }
  } catch {
    // no saved position yet
  }
  return null
}

/** Persisted on drag end so the HUD returns to the same spot next launch. */
function persistLyricsPosition() {
  if (!lyricsWindow) return
  try {
    const { x, y } = lyricsWindow.getFrame()
    mkdirSync(APP_DATA_DIR, { recursive: true })
    writeFileSync(LYRICS_WINDOW_FILE, JSON.stringify({ x, y }), 'utf8')
  } catch {
    // Positioning is best effort.
  }
}

/** Native display queries can fail during startup; fall back to fixed coords. */
function primaryWorkArea() {
  try {
    const { workArea } = Screen.getPrimaryDisplay()
    if (workArea && workArea.width > 0 && workArea.height > 0) return workArea
  } catch (error) {
    console.warn('[desktop] failed to read the primary display:', error)
  }
  return null
}

function createLyricsWindow() {
  const workArea = primaryWorkArea()
  const width = workArea
    ? Math.min(LYRICS_WINDOW_SIZE.width, Math.max(420, workArea.width - 80))
    : LYRICS_WINDOW_SIZE.width
  const height = LYRICS_WINDOW_SIZE.height
  const saved = readLyricsPosition()
  const defaultX = workArea
    ? Math.round(workArea.x + (workArea.width - width) / 2)
    : 120
  const defaultY = workArea
    ? Math.round(workArea.y + workArea.height - height - LYRICS_WINDOW_MARGIN)
    : 120
  // A saved spot may belong to a monitor that is no longer connected; keep a
  // sliver of the window on screen so the shortcut can always bring it back.
  const clamp = (value: number, min: number, max: number) =>
    Math.min(Math.max(value, min), max)
  const x = workArea
    ? clamp(saved?.x ?? defaultX, workArea.x - width + 120, workArea.x + workArea.width - 120)
    : defaultX
  const y = workArea
    ? clamp(saved?.y ?? defaultY, workArea.y, workArea.y + workArea.height - 60)
    : defaultY
  const win = new BrowserWindow({
    title: '桌面歌词',
    // A plain page from the local bridge is far more reliable in a secondary
    // window than loading the SPA through `views://`.
    url: `http://127.0.0.1:${BRIDGE_PORT}/lyrics?token=${encodeURIComponent(BRIDGE_TOKEN)}`,
    frame: { width, height, x, y },
    // Transparent + frameless: the page draws a translucent glass plaque.
    titleBarStyle: 'hiddenInset',
    transparent: true,
    activate: false,
  })
  hideAuxiliaryFromTaskbar('桌面歌词')
  win.setAlwaysOnTop(true)
  win.setVisibleOnAllWorkspaces(true)
  // `move` fires continuously while dragging; only persist the final position.
  win.on('move', () => {
    if (lyricsMoveTimer) clearTimeout(lyricsMoveTimer)
    lyricsMoveTimer = setTimeout(() => {
      lyricsMoveTimer = null
      persistLyricsPosition()
    }, 500)
  })
  return win
}

function ensureLyricsWindow() {
  if (!lyricsWindow) lyricsWindow = createLyricsWindow()
  return lyricsWindow
}

function lyricsWindowVisible() {
  if (!lyricsWindow) return false
  try {
    return lyricsWindow.isVisible()
  } catch {
    lyricsWindow = null
    return false
  }
}

function showLyricsWindow() {
  // A destroyed window leaves a stale handle behind; retry once with a new one.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      ensureLyricsWindow().showInactive()
      return true
    } catch (error) {
      lyricsWindow = null
      if (attempt === 1) console.error('[desktop] failed to show lyrics window:', error)
    }
  }
  return false
}

function hideLyricsWindow() {
  if (!lyricsWindow) return false
  try {
    lyricsWindow.hide()
  } catch {
    lyricsWindow = null
  }
  return false
}

/** 'show' / 'hide' / 'toggle' → whether the HUD is visible afterwards. */
function applyLyricsAction(action: string | null) {
  if (action === 'hide') return hideLyricsWindow()
  if (action === 'show') return showLyricsWindow()
  return lyricsWindowVisible() ? hideLyricsWindow() : showLyricsWindow()
}

function registerShortcut(accelerator: string, handler: () => void) {
  try {
    if (GlobalShortcut.register(accelerator, handler)) return true
    console.warn(`[desktop] failed to register shortcut (${accelerator})`)
  } catch (error) {
    console.warn(`[desktop] shortcut registration threw (${accelerator}):`, error)
  }
  return false
}

registerShortcut(LYRICS_SHORTCUT, () => applyLyricsAction('toggle'))

/* ------------------------------- mini player ------------------------------- */

const MINI_WINDOW_SIZE = { width: 380, height: 140 }
let miniWindow: BrowserWindow | null = null

function createMiniWindow() {
  const workArea = primaryWorkArea()
  const { width, height } = MINI_WINDOW_SIZE
  const x = workArea ? Math.round(workArea.x + workArea.width - width - 24) : 120
  const y = workArea ? Math.round(workArea.y + workArea.height - height - 24) : 120
  const win = new BrowserWindow({
    title: '迷你播放器',
    url: `http://127.0.0.1:${BRIDGE_PORT}/mini?token=${encodeURIComponent(BRIDGE_TOKEN)}`,
    frame: { width, height, x, y },
    titleBarStyle: 'hiddenInset',
    transparent: true,
    activate: false,
  })
  hideAuxiliaryFromTaskbar('迷你播放器')
  win.setAlwaysOnTop(true)
  win.setVisibleOnAllWorkspaces(true)
  return win
}

function miniWindowVisible() {
  if (!miniWindow) return false
  try {
    return miniWindow.isVisible()
  } catch {
    miniWindow = null
    return false
  }
}

function showMiniWindow() {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      if (!miniWindow) miniWindow = createMiniWindow()
      miniWindow.showInactive()
      return true
    } catch (error) {
      miniWindow = null
      if (attempt === 1) console.error('[desktop] failed to show mini player:', error)
    }
  }
  return false
}

function hideMiniWindow() {
  if (!miniWindow) return false
  try {
    miniWindow.hide()
  } catch {
    miniWindow = null
  }
  return false
}

function applyMiniAction(action: string | null) {
  if (action === 'hide') return hideMiniWindow()
  if (action === 'show') return showMiniWindow()
  return miniWindowVisible() ? hideMiniWindow() : showMiniWindow()
}

/* ---------------------------- renderer commands ---------------------------- */

/**
 * Native surfaces (tray, global shortcuts, mini player) drive playback by
 * injecting a call into the main window; the renderer exposes
 * `window.__qimiaoDesktopCommand` from lib/desktopCommands.ts.
 */
function sendRendererCommand(action: string, value?: number) {
  const argument =
    typeof value === 'number' && Number.isFinite(value) ? `,${value}` : ''
  try {
    mainWindow?.webview.executeJavascript(
      `window.__qimiaoDesktopCommand&&window.__qimiaoDesktopCommand(${JSON.stringify(action)}${argument})`,
    )
  } catch (error) {
    console.warn(`[desktop] failed to send command "${action}":`, error)
  }
}

function applyCommand(action: string | null, value?: number) {
  if (!action) return false
  if (action === 'lyrics') return applyLyricsAction('toggle')
  if (action === 'mini') return applyMiniAction('toggle')
  if (action === 'show-main') {
    showMainWindow()
    return true
  }
  if (action === 'seek') {
    sendRendererCommand(action, value)
    return true
  }
  if (
    action === 'play-pause' ||
    action === 'next' ||
    action === 'previous' ||
    action === 'like-current' ||
    action === 'volume-up' ||
    action === 'volume-down'
  ) {
    sendRendererCommand(action)
    return true
  }
  return false
}

const GLOBAL_COMMANDS: Array<[accelerator: string, action: string]> = [
  ['CommandOrControl+Alt+P', 'play-pause'],
  ['CommandOrControl+Alt+L', 'like-current'],
  ['CommandOrControl+Alt+Up', 'volume-up'],
  ['CommandOrControl+Alt+Down', 'volume-down'],
]

for (const [accelerator, action] of GLOBAL_COMMANDS) {
  registerShortcut(accelerator, () => sendRendererCommand(action))
}

process.on('exit', () => {
  for (const accelerator of [LYRICS_SHORTCUT, ...GLOBAL_COMMANDS.map(([key]) => key)]) {
    try {
      GlobalShortcut.unregister(accelerator)
    } catch {
      // The native layer may already be tearing down.
    }
  }
})

/* --------------------------- download directory --------------------------- */

const DOWNLOAD_DIR_FILE = join(APP_DATA_DIR, 'download-dir.json')
const DEFAULT_DOWNLOAD_DIR = join(homedir(), 'Downloads')
const DOWNLOAD_BRIDGE_PORT = BRIDGE_PORT

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
      // The HUD page itself is a navigation request and cannot carry the header;
      // it holds no data and fetches state with the token from its query string.
      if (url.pathname === '/lyrics' && request.method === 'GET') {
        return new Response(LYRICS_WINDOW_HTML, {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        })
      }
      if (url.pathname === '/mini' && request.method === 'GET') {
        return new Response(MINI_PLAYER_HTML, {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        })
      }
      // Local, unauthenticated activation endpoint used by a second launch
      // (pinned taskbar icon) to reveal the already-running window. It exposes
      // no data and is bound to 127.0.0.1.
      if (url.pathname === '/activate' && request.method === 'POST') {
        // Taskbar semantics: a visible window toggles to minimized; a hidden
        // or minimized one is restored. Windows usually handles this itself,
        // but a pinned shortcut with no taskbar button launches this process.
        if (
          mainWindow &&
          mainWindow.isVisible() &&
          !mainWindow.isMinimized()
        ) {
          mainWindow.minimize()
        } else {
          showMainWindow()
        }
        return Response.json({ ok: true }, { headers })
      }
      if (!isBridgeAuthorized(request)) {
        return new Response('Unauthorized', { status: 401, headers })
      }
      try {
        if (url.pathname === '/startup-report' && request.method === 'POST') {
          const body = (await request.json().catch(() => null)) as {
            paint?: number
            secure?: boolean
            audioEncoder?: string
          } | null
          markStartup(
            `renderer-first-paint webview=${Math.round(Number(body?.paint ?? 0))}ms secure=${body?.secure === true} audioEncoder=${body?.audioEncoder ?? 'unknown'}`,
          )
          // Extra trigger: if the native dom-ready event was missed, the first
          // renderer report also reveals the hidden window.
          revealMainWindow()
          return Response.json({ ok: true }, { headers })
        }
        if (url.pathname === '/log' && request.method === 'POST') {
          const message = (await request.text()).slice(0, 500)
          markStartup(`renderer: ${message}`)
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
        if (url.pathname === '/lyrics-window' && request.method === 'GET') {
          return Response.json({ visible: lyricsWindowVisible() }, { headers })
        }
        if (url.pathname === '/lyrics-window' && request.method === 'POST') {
          return Response.json(
            { visible: applyLyricsAction(url.searchParams.get('action')) },
            { headers },
          )
        }
        if (url.pathname === '/mini-window' && request.method === 'GET') {
          return Response.json({ visible: miniWindowVisible() }, { headers })
        }
        if (url.pathname === '/mini-window' && request.method === 'POST') {
          return Response.json(
            { visible: applyMiniAction(url.searchParams.get('action')) },
            { headers },
          )
        }
        if (url.pathname === '/command' && request.method === 'POST') {
          const rawValue = url.searchParams.get('value')
          const value = rawValue === null ? undefined : Number(rawValue)
          return Response.json(
            { ok: applyCommand(url.searchParams.get('action'), value) },
            { headers },
          )
        }
        if (url.pathname === '/lyrics-state' && request.method === 'GET') {
          return Response.json(lyricsState, { headers })
        }
        if (url.pathname === '/lyrics-state' && request.method === 'POST') {
          const body = (await request.json().catch(() => null)) as {
            type?: string
            time?: number
            playing?: boolean
          } | null
          if (body?.type === 'time') {
            // Progress-only update; merge into the last full snapshot.
            if (lyricsState) {
              lyricsState = {
                ...lyricsState,
                time: typeof body.time === 'number' ? body.time : lyricsState.time,
                playing: Boolean(body.playing),
              }
            }
          } else if (body) {
            lyricsState = body as Record<string, unknown>
          }
          return Response.json({ ok: true }, { headers })
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
