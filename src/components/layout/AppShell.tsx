import { lazy, Suspense, useEffect, useRef, type ReactNode } from 'react'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { useRouterState } from '@tanstack/react-router'
import { TitleBar } from './TitleBar'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { PlayerBar } from '../player/PlayerBar'
import { NowPlaying } from '../player/NowPlaying'
import { useUiStore } from '../../store/ui'
import { useUserStore } from '../../store/user'
import { usePlayerStore } from '../../store/player'
import { useSettingsStore } from '../../store/settings'
import { useLocalLibraryStore } from '../../store/localLibrary'
import { isDesktopShell } from '../../lib/desktop'
import { useDesktopCommands } from '../../lib/desktopCommands'
import { useDesktopLyricsPublisher } from '../../lib/desktopLyrics'
import { applyTheme } from '../../lib/theme'
import { getLastLoginRefreshAt, getLoginCookie, refreshLogin } from '../../lib/session'

// The queue panel and login dialog are only needed after a user action; keep
// them out of the first-paint parse. NowPlaying stays eager because it owns
// the player effects and is cheap to mount (it renders null while closed).
const QueuePanel = lazy(() =>
  import('../player/QueuePanel').then((module) => ({ default: module.QueuePanel })),
)
const LoginModal = lazy(() =>
  import('./LoginModal').then((module) => ({ default: module.LoginModal })),
)

/** Rotate the login cookie every few hours so the persisted session never dies. */
const LOGIN_REFRESH_INTERVAL = 6 * 60 * 60 * 1000

export function AppShell({ children }: { children: ReactNode }) {
  const { i18n } = useLingui()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  // Playback/user detail pages are destinations, not list positions. They must
  // start at the top and must not write a scroll entry that would be restored
  // when the same page is opened again.
  const resetScrollOnEnter =
    pathname.startsWith('/mv/') ||
    pathname.startsWith('/video/') ||
    pathname.startsWith('/users/')
  const contentRef = useRef<HTMLElement>(null)
  const loginOpen = useUiStore((state) => state.loginOpen)
  const closeLogin = useUiStore((state) => state.closeLogin)
  const sidebarOpen = useUiStore((state) => state.sidebarOpen)
  const sidebarCollapsed = useUiStore((state) => state.sidebarCollapsed)
  const closeSidebar = useUiStore((state) => state.closeSidebar)
  const theme = useUiStore((state) => state.theme)
  const palette = useUiStore((state) => state.palette)
  const initSession = useUserStore((state) => state.initSession)
  const hasQueue = usePlayerStore((state) => state.queue.length > 0)
  const showQueue = usePlayerStore((state) => state.showQueue)
  const ensureLyrics = usePlayerStore((state) => state.ensureLyrics)
  const loadLocalLibrary = useLocalLibraryStore((state) => state.load)
  const disableDevTools = useSettingsStore((state) => state.disableDevTools)

  useDesktopLyricsPublisher()
  useDesktopCommands()

  useEffect(() => {
    applyTheme(theme, palette)
  }, [theme, palette])

  useEffect(() => {
    closeSidebar()
  }, [pathname, closeSidebar])

  // The mobile drawer is a floating layer, so Escape must dismiss it and hand
  // focus back to the menu button that opened it.
  useEffect(() => {
    if (!sidebarOpen) return
    const trigger =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeSidebar()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      trigger?.focus()
    }
  }, [sidebarOpen, closeSidebar])

  useEffect(() => {
    void initSession()
  }, [initSession])

  // Guest library is read once per launch; mutations keep the store in sync.
  useEffect(() => {
    void loadLocalLibrary()
  }, [loadLocalLibrary])

  // The persisted queue only keeps ids/metadata, so after a refresh the current
  // track has no lyric text until something calls loadAt (i.e. pressing play).
  // Fetch it up front so the immersive view is already populated.
  useEffect(() => {
    void ensureLyrics()
  }, [ensureLyrics])

  // Warm the lazy queue/login chunks after the first paint so opening them does
  // not pay a module download.
  useEffect(() => {
    const preload = () => {
      void import('../player/QueuePanel')
      void import('./LoginModal')
    }
    const id = window.requestIdleCallback(preload, { timeout: 2500 })
    return () => window.cancelIdleCallback(id)
  }, [])

  // Desktop lockdown. The main process disables WebView2 DevTools for the next
  // launch (see src/bun/index.ts); this blocks the in-page shortcuts and the
  // context menu immediately for the current session.
  useEffect(() => {
    if (!isDesktopShell() || !disableDevTools) return
    const onContextMenu = (event: MouseEvent) => event.preventDefault()
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()
      const blocked =
        event.key === 'F12' ||
        (event.ctrlKey && event.shiftKey && ['i', 'j', 'c'].includes(key)) ||
        (event.metaKey && event.altKey && ['i', 'j', 'c'].includes(key)) ||
        (event.ctrlKey && key === 'u')
      if (!blocked) return
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    window.addEventListener('contextmenu', onContextMenu, true)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('contextmenu', onContextMenu, true)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [disableDevTools])

  useEffect(() => {
    const keepAlive = () => {
      if (!getLoginCookie()) return
      if (Date.now() - getLastLoginRefreshAt() < LOGIN_REFRESH_INTERVAL) return
      void refreshLogin()
    }
    const timer = window.setInterval(keepAlive, 30 * 60 * 1000)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') keepAlive()
    }
    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('focus', keepAlive)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('focus', keepAlive)
    }
  }, [])

  useEffect(() => {
    // 滚动条仅在滚动时显示：标记当前正在滚动的容器，停止滚动后自动移除。
    let hideTimer: number | undefined
    let activeElement: HTMLElement | null = null

    const clearActive = () => {
      activeElement?.classList.remove('is-scrolling')
      activeElement = null
    }

    const handleScroll = (event: Event) => {
      const element =
        event.target instanceof HTMLElement ? event.target : document.documentElement
      if (activeElement !== element) {
        activeElement?.classList.remove('is-scrolling')
        activeElement = element
      }
      element.classList.add('is-scrolling')
      if (hideTimer) window.clearTimeout(hideTimer)
      hideTimer = window.setTimeout(() => {
        hideTimer = undefined
        clearActive()
      }, 700)
    }

    document.addEventListener('scroll', handleScroll, true)
    return () => {
      document.removeEventListener('scroll', handleScroll, true)
      if (hideTimer) window.clearTimeout(hideTimer)
      clearActive()
    }
  }, [])

  useEffect(() => {
    const element = contentRef.current
    if (!element) return
    const key = `scroll:${pathname}`

    if (resetScrollOnEnter) {
      sessionStorage.removeItem(key)
      const previous = element.style.scrollBehavior
      element.style.scrollBehavior = 'auto'
      element.scrollTop = 0
      element.style.scrollBehavior = previous
      return
    }

    const saved = Number(sessionStorage.getItem(key) ?? 0)

    // `.apple-content` has smooth scrolling in CSS. Restoring must be instant:
    // a smooth assignment can keep animating after a new playback page has
    // already reset the container, leaving the old offset in place.
    const setScroll = (top: number) => {
      const previous = element.style.scrollBehavior
      element.style.scrollBehavior = 'auto'
      element.scrollTop = top
      element.style.scrollBehavior = previous
    }

    if (!saved) {
      setScroll(0)
      return
    }

    let retryTimer: number | undefined
    let guard: number | undefined
    let stopped = false

    const stop = () => {
      stopped = true
      if (retryTimer !== undefined) window.clearInterval(retryTimer)
      if (guard !== undefined) window.clearTimeout(guard)
    }

    const restore = () => {
      if (stopped) return
      setScroll(saved)
      // Pages render skeletons before their data arrives, so the saved offset
      // is often unreachable at first; keep retrying while the content grows.
      if (Math.abs(element.scrollTop - saved) <= 1) stop()
    }

    restore()
    if (Math.abs(element.scrollTop - saved) > 1) {
      retryTimer = window.setInterval(restore, 100)
      guard = window.setTimeout(stop, 2500)
    }

    return stop
  }, [pathname, resetScrollOnEnter])

  useEffect(() => {
    const element = contentRef.current
    if (!element) return
    // Do not persist a playback page's scroll; the route above always resets
    // to the top when it is entered.
    if (resetScrollOnEnter) return
    const key = `scroll:${pathname}`
    const handleScroll = () => {
      sessionStorage.setItem(key, String(element.scrollTop))
    }
    element.addEventListener('scroll', handleScroll, { passive: true })
    return () => element.removeEventListener('scroll', handleScroll)
  }, [pathname, resetScrollOnEnter])

  return (
    <div className="app-shell">
      <div className="app-window">
        <TitleBar />
        <div
          className={[
            'app-body',
            sidebarOpen ? 'nav-open' : '',
            sidebarCollapsed ? 'sidebar-collapsed' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <Sidebar />
          <div className="main-column relative overflow-hidden">
            <TopBar />
            <main ref={contentRef} className="apple-content relative">
              {/* Keyed by route so each navigation fades in from scratch. */}
              <div key={pathname} className="route-fade">
                {children}
              </div>
            </main>
          </div>
        </div>
        {sidebarOpen ? (
          <button
            type="button"
            aria-label={i18n._(msg`关闭导航`)}
            className="sidebar-backdrop"
            onClick={closeSidebar}
          />
        ) : null}
        <NowPlaying />
        {showQueue ? (
          <Suspense fallback={null}>
            <QueuePanel />
          </Suspense>
        ) : null}
        {hasQueue && <PlayerBar />}
        {loginOpen ? (
          <Suspense fallback={null}>
            <LoginModal open onOpenChange={(open) => !open && closeLogin()} />
          </Suspense>
        ) : null}
      </div>
    </div>
  )
}
