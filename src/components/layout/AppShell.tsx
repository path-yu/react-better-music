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

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const contentRef = useRef<HTMLElement>(null)
  const loginOpen = useUiStore((state) => state.loginOpen)
  const closeLogin = useUiStore((state) => state.closeLogin)
  const theme = useUiStore((state) => state.theme)
  const initSession = useUserStore((state) => state.initSession)
  const hasQueue = usePlayerStore((state) => state.queue.length > 0)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  useEffect(() => {
    void initSession()
  }, [initSession])

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
    const saved = sessionStorage.getItem(key)
    element.scrollTop = saved ? Number(saved) : 0
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
        <div className="app-body">
          <Sidebar />
          <div className="main-column relative overflow-hidden">
            <TopBar />
            <main ref={contentRef} className="apple-content relative">
              {children}
            </main>
          </div>
        </div>
        <NowPlaying />
        <QueuePanel />
        {hasQueue && <PlayerBar />}
        <LoginModal open={loginOpen} onOpenChange={(open) => !open && closeLogin()} />
      </div>
    </div>
  )
}
