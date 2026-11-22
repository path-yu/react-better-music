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

/** Below this the sidebar is a slide-in drawer, never the icon rail. */
export const SIDEBAR_DRAWER_QUERY = '(max-width: 767.98px)'

function matches(query: string) {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(query).matches
  )
}

function subscribeTo(query: string) {
  return (onChange: () => void) => {
    if (typeof window === 'undefined' || !window.matchMedia) return () => {}
    const list = window.matchMedia(query)
    list.addEventListener('change', onChange)
    return () => list.removeEventListener('change', onChange)
  }
}

const subscribeNarrow = subscribeTo(SIDEBAR_AUTO_COLLAPSE_QUERY)
const subscribeDrawer = subscribeTo(SIDEBAR_DRAWER_QUERY)
const isNarrowDesktop = () => matches(SIDEBAR_AUTO_COLLAPSE_QUERY)
const isDrawerLayout = () => matches(SIDEBAR_DRAWER_QUERY)

export function useNarrowDesktop() {
  return useSyncExternalStore(subscribeNarrow, isNarrowDesktop, () => false)
}

export function useDrawerLayout() {
  return useSyncExternalStore(subscribeDrawer, isDrawerLayout, () => false)
}

type SidebarPrefs = { sidebarCollapsed: boolean; sidebarAutoCollapse: boolean }

/**
 * What the user sees: their own choice, or the automatic narrow-window rail.
 * The mobile drawer always shows the full sidebar: a collapse made in a wide
 * window used to turn the drawer into a 232px panel of bare icons.
 */
export function resolveSidebarCollapsed(
  prefs: SidebarPrefs,
  narrow: boolean,
  drawer = false,
) {
  if (drawer) return false
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
  const drawer = useDrawerLayout()
  const sidebarCollapsed = useUiStore((state) => state.sidebarCollapsed)
  const sidebarAutoCollapse = useUiStore((state) => state.sidebarAutoCollapse)
  return resolveSidebarCollapsed(
    { sidebarCollapsed, sidebarAutoCollapse },
    narrow,
    drawer,
  )
}

export function useToggleSidebarCollapsed() {
  return useCallback(() => {
    const { sidebarCollapsed, sidebarAutoCollapse } = useUiStore.getState()
    useUiStore.setState(
      nextSidebarPrefs({ sidebarCollapsed, sidebarAutoCollapse }, isNarrowDesktop()),
    )
  }, [])
}
