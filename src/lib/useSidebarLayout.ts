import { useCallback, useSyncExternalStore } from 'react'
import { useUiStore } from '../store/ui'

/**
 * Desktop widths where the full 232px sidebar leaves the content under
 * ~790px: the player bar, song tables and detail headers start to crowd
 * (the playlist header's buttons wrapped at ~990px). Below 768px the sidebar
 * is a drawer instead, so the rule stops there.
 */
export const SIDEBAR_AUTO_COLLAPSE_QUERY =
  '(min-width: 768px) and (max-width: 1023.98px)'

function subscribe(onChange: () => void) {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {}
  const query = window.matchMedia(SIDEBAR_AUTO_COLLAPSE_QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

function isNarrowDesktop() {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(SIDEBAR_AUTO_COLLAPSE_QUERY).matches
  )
}

export function useNarrowDesktop() {
  return useSyncExternalStore(subscribe, isNarrowDesktop, () => false)
}

type SidebarPrefs = { sidebarCollapsed: boolean; sidebarAutoCollapse: boolean }

/** What the user sees: their own choice, or the automatic narrow-window rail. */
export function resolveSidebarCollapsed(prefs: SidebarPrefs, narrow: boolean) {
  return prefs.sidebarCollapsed || (prefs.sidebarAutoCollapse && narrow)
}

/**
 * The collapse button. Expanding in a narrow window is an explicit "keep it
 * open here", so it also turns automatic collapsing off (and stays off until
 * re-enabled in Settings). Collapsing is always a plain manual collapse.
 */
export function nextSidebarPrefs(prefs: SidebarPrefs, narrow: boolean): SidebarPrefs {
  if (resolveSidebarCollapsed(prefs, narrow)) {
    return {
      sidebarCollapsed: false,
      sidebarAutoCollapse: narrow ? false : prefs.sidebarAutoCollapse,
    }
  }
  return { ...prefs, sidebarCollapsed: true }
}

export function useSidebarCollapsed() {
  const narrow = useNarrowDesktop()
  const sidebarCollapsed = useUiStore((state) => state.sidebarCollapsed)
  const sidebarAutoCollapse = useUiStore((state) => state.sidebarAutoCollapse)
  return resolveSidebarCollapsed({ sidebarCollapsed, sidebarAutoCollapse }, narrow)
}

export function useToggleSidebarCollapsed() {
  return useCallback(() => {
    const { sidebarCollapsed, sidebarAutoCollapse } = useUiStore.getState()
    useUiStore.setState(
      nextSidebarPrefs({ sidebarCollapsed, sidebarAutoCollapse }, isNarrowDesktop()),
    )
  }, [])
}
