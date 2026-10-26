/**
 * Window controls for the Electrobun custom title bar.
 *
 * Dragging is handled natively by Electrobun's preload (see the
 * `electrobun-webkit-app-region-*` classes); the buttons below talk to the Bun
 * main process so the renderer can control the real window.
 */
import { requestJson } from './desktopBridge'

export type DesktopPlatform = 'windows' | 'macos' | 'linux'

export type WindowState = {
  maximized: boolean
  minimized: boolean
  fullScreen: boolean
}

export type WindowAction = 'minimize' | 'toggle-maximize' | 'close'

/**
 * Electrobun sets `__electrobunPlatform` in its preload before the page boots.
 * It is missing when the same bundle is opened outside the desktop shell.
 */
export function desktopPlatform(): DesktopPlatform | null {
  const platform = (window as typeof window & { __electrobunPlatform?: string })
    .__electrobunPlatform
  if (platform === 'windows' || platform === 'macos' || platform === 'linux') return platform
  return null
}

export function getWindowState() {
  return requestJson<WindowState>('/window-state')
}

async function windowAction(action: WindowAction) {
  return requestJson<WindowState>(`/window-action?action=${action}`, { method: 'POST' })
}

export function minimizeWindow() {
  return windowAction('minimize')
}

export function toggleMaximizeWindow() {
  return windowAction('toggle-maximize')
}

/** Asks the window to close; the main process hides it to the tray instead. */
export function closeWindow() {
  return windowAction('close')
}
