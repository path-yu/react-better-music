import { apiUrl } from './http'

/**
 * Open a URL in the system browser.
 *
 * The desktop shell is a WebView2 window with no shell bridge, so a plain
 * `window.open` would spawn a chromeless window instead of the user's browser.
 * The local API opens it (only bilibili / YouTube pages are allowed) and the
 * web build falls back to a normal new tab.
 */
export async function openExternal(url: string) {
  if (!url) return
  try {
    const response = await fetch(apiUrl('/open-url', { url }))
    if (response.ok) return
  } catch {
    // The API may be unavailable in a plain browser build.
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}
