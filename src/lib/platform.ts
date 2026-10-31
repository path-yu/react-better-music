/** Tauri v2 injects `__TAURI_INTERNALS__` into the webview. */
export function isTauriApp() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}
