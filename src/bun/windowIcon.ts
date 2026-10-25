import { dlopen, FFIType } from 'bun:ffi'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const WINDOW_TITLE = '声屿'
const WM_SETICON = 0x0080
const IMAGE_ICON = 1
const LR_LOADFROMFILE = 0x0010
const ICON_BIG = 1

function findIconPath() {
  const candidates = [
    join(import.meta.dir, '..', 'app-icon.ico'),
    join(import.meta.dir, 'app', 'app-icon.ico'),
    join(import.meta.dir, 'app-icon.ico'),
    join(process.cwd(), 'Resources', 'app', 'app-icon.ico'),
    join(process.cwd(), 'assets', 'app-icon.ico'),
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

/**
 * Electrobun's `win.icon` only stamps the launcher/installer executables.
 * The actual window keeps WebView2's default document icon, so set
 * WM_SETICON on our window at runtime to fix the title bar and taskbar.
 */
export function applyWindowIcon() {
  if (process.platform !== 'win32') return

  const iconPath = findIconPath()
  if (!iconPath) {
    console.warn('[desktop] app icon file not found, keeping default window icon')
    return
  }

  try {
    const user32 = dlopen('user32.dll', {
      FindWindowW: {
        args: [FFIType.ptr, FFIType.ptr],
        returns: FFIType.ptr,
      },
      LoadImageW: {
        args: [
          FFIType.ptr,
          FFIType.ptr,
          FFIType.u32,
          FFIType.i32,
          FFIType.i32,
          FFIType.u32,
        ],
        returns: FFIType.ptr,
      },
      SendMessageW: {
        args: [FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr],
        returns: FFIType.ptr,
      },
    })

    const title = Buffer.from(`${WINDOW_TITLE}\0`, 'utf16le')
    const path = Buffer.from(`${iconPath}\0`, 'utf16le')
    const smallIcon = user32.symbols.LoadImageW(
      null,
      path,
      IMAGE_ICON,
      32,
      32,
      LR_LOADFROMFILE,
    )
    const largeIcon = user32.symbols.LoadImageW(
      null,
      path,
      IMAGE_ICON,
      256,
      256,
      LR_LOADFROMFILE,
    )

    if (!smallIcon && !largeIcon) {
      console.warn('[desktop] failed to load window icon:', iconPath)
      return
    }

    let attempts = 0
    const timer = setInterval(() => {
      attempts += 1
      const hwnd = user32.symbols.FindWindowW(null, title)
      if (hwnd) {
        if (smallIcon) user32.symbols.SendMessageW(hwnd, WM_SETICON, null, smallIcon)
        if (largeIcon) user32.symbols.SendMessageW(hwnd, WM_SETICON, ICON_BIG, largeIcon)
      }
      if (attempts >= 20) {
        clearInterval(timer)
        console.log('[desktop] window icon applied:', iconPath)
      }
    }, 300)
  } catch (error) {
    console.warn('[desktop] failed to apply window icon:', error)
  }
}
