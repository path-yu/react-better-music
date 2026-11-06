import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  X,
  XCircle,
} from 'lucide-react'
import { MenuSurface } from './MenuSurface'
import { subscribeToast, type ToastKind } from '../../lib/toast'
import { usePlayerMenuTint } from '../../lib/menuSurface'
import { usePlayerStore } from '../../store/player'
import { cn } from '../../lib/format'

interface ToastItem {
  id: string
  message: string
  title?: string
  kind: ToastKind
}

const TOAST_DURATION = 2600

function ToastIcon({ kind }: { kind: ToastKind }) {
  const className = 'h-4 w-4 shrink-0'
  switch (kind) {
    case 'success':
      return <CheckCircle2 className={cn(className, 'text-emerald-500')} />
    case 'warning':
      return <AlertTriangle className={cn(className, 'text-amber-500')} />
    case 'error':
      return <XCircle className={cn(className, 'text-red-500')} />
    default:
      return <Info className={cn(className, 'text-sky-500')} />
  }
}

/**
 * Renders toast messages with the same cover-tinted glass surface as the
 * queue context menu when the immersive player is open. The regular app keeps
 * the original light/dark Darwin toast treatment.
 */
export function ToastBridge() {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [live, setLive] = useState('')
  const timers = useRef(new Map<string, number>())
  const liveTimer = useRef<number | undefined>(undefined)
  const sequence = useRef(0)
  const immersive = usePlayerStore((state) => state.showNowPlaying)
  const currentSong = usePlayerStore(
    (state) => state.queue[state.currentIndex],
  )
  const tint = usePlayerMenuTint(immersive, currentSong?.al.picUrl)

  useEffect(() => {
    const activeTimers = timers.current
    const unsubscribe = subscribeToast((message, kind, title) => {
      const id = String(++sequence.current)
      setToasts((current) => [
        ...current.slice(-3),
        { id, message, title, kind },
      ])
      setLive('')
      if (liveTimer.current !== undefined) {
        window.clearTimeout(liveTimer.current)
      }
      liveTimer.current = window.setTimeout(
        () => setLive(title ? `${title}：${message}` : message),
        80,
      )
      const timer = window.setTimeout(() => {
        setToasts((current) => current.filter((toast) => toast.id !== id))
        activeTimers.delete(id)
      }, TOAST_DURATION)
      activeTimers.set(id, timer)
    })
    return () => {
      unsubscribe()
      activeTimers.forEach((timer) => window.clearTimeout(timer))
      activeTimers.clear()
      if (liveTimer.current !== undefined) {
        window.clearTimeout(liveTimer.current)
      }
    }
  }, [])

  const dismiss = (id: string) => {
    const timer = timers.current.get(id)
    if (timer !== undefined) window.clearTimeout(timer)
    timers.current.delete(id)
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }

  return (
    <>
      <div
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {live}
      </div>
      <div className="pointer-events-none fixed right-4 top-4 z-[2000] flex flex-col gap-2">
        {toasts.map((toast) => (
          <MenuSurface
            key={toast.id}
            active={immersive}
            tint={immersive ? tint : undefined}
            className={cn(
              'pointer-events-auto flex w-[min(380px,calc(100vw-24px))] items-start gap-3 rounded-xl p-4 animate-in slide-in-from-right duration-300',
              immersive
                ? 'text-white'
                : 'border border-black/10 bg-white/95 text-zinc-900 shadow-md backdrop-blur-md dark:border-white/10 dark:bg-zinc-900/95 dark:text-zinc-100',
            )}
          >
            <ToastIcon kind={toast.kind} />
            <div className="min-w-0 flex-1">
              {toast.title ? (
                <div
                  className={cn(
                    'mb-0.5 text-sm font-semibold',
                    immersive
                      ? 'text-white/90'
                      : 'text-zinc-900 dark:text-zinc-100',
                  )}
                >
                  {toast.title}
                </div>
              ) : null}
              <div
                className={cn(
                  'text-sm',
                  immersive
                    ? 'text-white/55'
                    : 'text-zinc-500 dark:text-zinc-400',
                )}
              >
                {toast.message}
              </div>
            </div>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              aria-label="Close"
              className={cn(
                'shrink-0 transition-colors',
                immersive
                  ? 'text-white/40 hover:text-white/80'
                  : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200',
              )}
            >
              <X className="h-4 w-4" />
            </button>
          </MenuSurface>
        ))}
      </div>
    </>
  )
}
