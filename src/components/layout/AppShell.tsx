import { useEffect, useRef, type ReactNode } from 'react'
import { useRouterState } from '@tanstack/react-router'
import { TitleBar } from './TitleBar'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { LoginModal } from './LoginModal'
import { PlayerBar } from '../player/PlayerBar'
import { NowPlaying } from '../player/NowPlaying'
import { QueuePanel } from '../player/QueuePanel'
import { useUiStore } from '../../store/ui'
import { useUserStore } from '../../store/user'
import { usePlayerStore } from '../../store/player'
import { applyTheme } from '../../lib/theme'
import { getLastLoginRefreshAt, getLoginCookie, refreshLogin } from '../../lib/session'

/** Rotate the login cookie every few hours so the persisted session never dies. */
const LOGIN_REFRESH_INTERVAL = 6 * 60 * 60 * 1000

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const contentRef = useRef<HTMLElement>(null)
  const loginOpen = useUiStore((state) => state.loginOpen)
  const closeLogin = useUiStore((state) => state.closeLogin)
  const sidebarOpen = useUiStore((state) => state.sidebarOpen)
  const closeSidebar = useUiStore((state) => state.closeSidebar)
  const theme = useUiStore((state) => state.theme)
  const initSession = useUserStore((state) => state.initSession)
  const hasQueue = usePlayerStore((state) => state.queue.length > 0)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

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
    const saved = Number(sessionStorage.getItem(key) ?? 0)

    // `.apple-content` uses smooth scrolling; restoring must be instant or
    // reading scrollTop right after the assignment returns a stale value.
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
  }, [pathname])

  useEffect(() => {
    const element = contentRef.current
    if (!element) return
    const key = `scroll:${pathname}`
    const handleScroll = () => {
      sessionStorage.setItem(key, String(element.scrollTop))
    }
    element.addEventListener('scroll', handleScroll, { passive: true })
    return () => element.removeEventListener('scroll', handleScroll)
  }, [pathname])

  return (
    <div className="app-shell">
      <div className="app-window">
        <TitleBar />
        <div className={sidebarOpen ? 'app-body nav-open' : 'app-body'}>
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
            aria-label="关闭导航"
            className="sidebar-backdrop"
            onClick={closeSidebar}
          />
        ) : null}
        <NowPlaying />
        <QueuePanel />
        {hasQueue && <PlayerBar />}
        <LoginModal open={loginOpen} onOpenChange={(open) => !open && closeLogin()} />
      </div>
    </div>
  )
}
