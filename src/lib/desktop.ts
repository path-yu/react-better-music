export function isDesktopShell() {
  return import.meta.env.VITE_DESKTOP === 'true'
}
