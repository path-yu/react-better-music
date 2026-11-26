import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { Trans } from '@lingui/react/macro'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ListMusic, LocateFixed, Trash2, X } from 'lucide-react'
import { Button } from '@pikoloo/darwin-ui'
import { ArtistLinks } from '../common/ArtistLinks'
import { usePlayerStore } from '../../store/player'
import { usePlayerMenuTint } from '../../lib/menuSurface'
import { hexToRgb } from '../../lib/color'
import { formatDuration } from '../../lib/format'
import { cn } from '../../lib/format'
import { availabilityTag } from '../../lib/songs'
import { isDesktopShell } from '../../lib/desktop'
import { desktopPlatform } from '../../lib/desktopWindow'

const ROW_HEIGHT = 56

export function QueuePanel() {
  const { i18n } = useLingui()
  const show = usePlayerStore((state) => state.showQueue)
  const immersive = usePlayerStore((state) => state.showNowPlaying)
  const queue = usePlayerStore((state) => state.queue)
  const currentIndex = usePlayerStore((state) => state.currentIndex)
  const currentSong = queue[currentIndex]
  const playing = usePlayerStore((state) => state.playing)
  const toggleQueue = usePlayerStore((state) => state.toggleQueue)
  const playAt = usePlayerStore((state) => state.playAt)
  const togglePlay = usePlayerStore((state) => state.togglePlay)
  const clearQueue = usePlayerStore((state) => state.clearQueue)
  const scrollRef = useRef<HTMLDivElement>(null)
  const locateTimerRef = useRef<number | null>(null)
  const [showLocate, setShowLocate] = useState(false)
  // 清空 asks once: the first click arms it for a few seconds.
  const [confirmClear, setConfirmClear] = useState(false)
  useEffect(() => {
    if (!confirmClear) return
    const timer = window.setTimeout(() => setConfirmClear(false), 3000)
    return () => window.clearTimeout(timer)
  }, [confirmClear])
  const queueTint = usePlayerMenuTint(
    immersive && show,
    currentSong?.al.picUrl,
  )

  // Long queues used to render every row; virtualise so opening the panel with
  // a thousand tracks stays cheap.
  const virtualizer = useVirtualizer({
    count: queue.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  })

  // Open on the track that is playing, not at the top of a long queue. Only
  // on open: following every track change would fight the user's scrolling.
  useEffect(() => {
    if (!show) return
    const frame = window.requestAnimationFrame(() => {
      const index = usePlayerStore.getState().currentIndex
      if (index > 0) virtualizer.scrollToIndex(index, { align: 'center' })
    })
    return () => window.cancelAnimationFrame(frame)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show])

  // Escape closes the panel, matching every other macOS overlay; focus returns
  // to whatever opened it (the queue button in the player bar).
  useEffect(() => {
    if (!show) return
    const trigger =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') toggleQueue(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      trigger?.focus()
    }
  }, [show, toggleQueue])

  useEffect(() => {
    setShowLocate(false)
    if (!show) return
    const target = scrollRef.current
    if (!target) return
    const reveal = () => {
      setShowLocate(true)
      if (locateTimerRef.current !== null) {
        window.clearTimeout(locateTimerRef.current)
      }
      locateTimerRef.current = window.setTimeout(() => {
        setShowLocate(false)
        locateTimerRef.current = null
      }, 2000)
    }
    target.addEventListener('scroll', reveal, { passive: true })
    return () => {
      target.removeEventListener('scroll', reveal)
      if (locateTimerRef.current !== null) {
        window.clearTimeout(locateTimerRef.current)
        locateTimerRef.current = null
      }
    }
  }, [queue.length, show])

  if (!show) return null

  const virtualItems = virtualizer.getVirtualItems()
  const tintRgb = queueTint ? hexToRgb(queueTint) : null
  // Over the song page the sheet covers the window's own title bar; keep its
  // buttons out of that strip (and let the strip still drag the window).
  const titleBarInset =
    immersive && isDesktopShell() ? (desktopPlatform() === 'macos' ? 30 : 38) : 0
  const panelStyle = immersive
    ? ({
        borderLeftColor: 'rgba(255, 255, 255, 0.1)',
        ...(tintRgb
          ? {
              '--queue-tint-rgb': `${tintRgb.r} ${tintRgb.g} ${tintRgb.b}`,
            }
          : {}),
      } as CSSProperties)
    : undefined

  const handleRowPlay = (index: number) => {
    // Clicking the active row should pause/resume, not restart from zero.
    if (index === currentIndex) {
      void togglePlay()
      return
    }
    void playAt(index)
  }

  return (
    <div
      className={cn(
        'absolute flex justify-end',
        // In the song detail overlay the queue sheet owns the full window
        // height and must also cover the custom title bar's window buttons.
        immersive
          ? 'inset-0 z-[90]'
          : 'inset-0 z-[70]',
      )}
    >
      <button
        type="button"
        aria-label={i18n._(msg`关闭播放列表`)}
        className={cn(
          'queue-backdrop absolute inset-0 backdrop-blur-[2px]',
          immersive ? 'bg-black/35' : 'bg-black/20',
        )}
        onClick={() => toggleQueue(false)}
      />
      <aside
        role="dialog"
        aria-label={i18n._(msg`播放列表`)}
        className={cn(
          'relative flex h-full w-[min(360px,100%)] flex-col border-l',
          // The immersive sheet must be flush with the top/bottom edges; the
          // normal panel keeps its small upward entrance.
          !immersive && 'fade-up',
          immersive
            ? 'queue-panel-immersive border-white/10 shadow-[-24px_0_70px_-24px_rgba(0,0,0,0.8)]'
            : 'border-black/10 bg-[#fbfbfd]/95 shadow-[-20px_0_50px_-20px_rgba(0,0,0,0.3)] backdrop-blur-xl',
        )}
        style={panelStyle}
      >
        {titleBarInset ? (
          <div
            aria-hidden="true"
            className="electrobun-webkit-app-region-drag flex-none"
            style={{ height: titleBarInset }}
          />
        ) : null}
        <div
          className={cn(
            'flex items-center justify-between px-4',
            titleBarInset ? 'pb-3 pt-1' : 'py-3.5',
            immersive ? 'border-b-0' : 'border-b border-black/8',
          )}
        >
          <div className="flex items-center gap-2">
            <ListMusic
              className={cn('h-4 w-4', immersive ? 'text-white/70' : 'text-accent')}
            />
            <p
              className={cn(
                'text-[13px] font-semibold',
                immersive ? 'text-white/85' : 'text-ink-1',
              )}
            >
              <Trans>播放列表</Trans>
            </p>
            <span
              className={cn(
                'text-[11px]',
                immersive ? 'text-white/40' : 'text-ink-4',
              )}
            >
              <Trans>{queue.length} 首</Trans>
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              className={cn(
                'h-7 rounded-full px-2 text-[11px]',
                immersive
                  ? 'text-white/45 hover:bg-white/8 hover:text-white/80'
                  : 'text-ink-3',
              )}
              onClick={() => {
                if (!confirmClear) {
                  setConfirmClear(true)
                  return
                }
                setConfirmClear(false)
                clearQueue()
              }}
            >
              <Trash2 className="mr-1 h-3 w-3" />
              {confirmClear ? <Trans>确认清空？</Trans> : <Trans>清空</Trans>}
            </Button>
            <button
              type="button"
              aria-label={i18n._(msg`关闭`)}
              onClick={() => toggleQueue(false)}
              className={cn(
                'pressable flex h-7 w-7 items-center justify-center rounded-full max-md:h-10 max-md:w-10',
                immersive
                  ? 'text-white/45 hover:bg-white/8 hover:text-white/80'
                  : 'text-ink-3 hover:bg-black/5 hover:text-ink-2',
              )}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto pb-16 pt-1">
          <div
            className="relative w-full"
            style={{ height: `${virtualizer.getTotalSize()}px` }}
          >
            {virtualItems.map((virtualRow) => {
              const song = queue[virtualRow.index]
              if (!song) return null
              const active = virtualRow.index === currentIndex
              const note = availabilityTag(song)
              return (
                <div
                  key={`${song.id}-${virtualRow.index}`}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => handleRowPlay(virtualRow.index)}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget) return
                      if (event.key === 'Enter') handleRowPlay(virtualRow.index)
                    }}
                    aria-current={active ? 'true' : undefined}
                    className={cn(
                      // Inset pill like the in-page queue: a highlighted row
                      // no longer butts against its neighbours.
                      'queue-row group mx-1.5 flex h-[calc(100%-4px)] w-[calc(100%-12px)] translate-y-0.5 cursor-pointer items-center gap-2.5 rounded-[10px] px-2.5 text-left transition-colors',
                      active
                        ? immersive
                          ? 'bg-white/14 shadow-[inset_0_0_0_0.5px_rgba(255,255,255,0.12)]'
                          : 'bg-accent/8'
                        : immersive
                          ? 'hover:bg-white/7'
                          : 'hover:bg-black/4',
                    )}
                  >
                    {/* Wide enough for 3-digit positions (queues of 100+). */}
                    <span
                      className={cn(
                        'flex w-6 shrink-0 justify-center',
                        immersive ? 'text-white' : 'text-accent',
                      )}
                    >
                      {active ? (
                        <span
                          className={cn('np-eq', playing && 'is-playing')}
                          role="img"
                          aria-label={
                            playing ? i18n._(msg`正在播放`) : i18n._(msg`已暂停`)
                          }
                        >
                          <i />
                          <i />
                          <i />
                        </span>
                      ) : (
                        <span
                          className={cn(
                            'text-[11px] tabular-nums',
                            immersive ? 'text-white/40' : 'text-ink-4',
                          )}
                        >
                          {virtualRow.index + 1}
                        </span>
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            'min-w-0 truncate text-[13px]',
                            active
                              ? immersive
                                ? 'font-semibold text-white'
                                : 'font-medium text-accent'
                              : immersive
                                ? 'text-white/88'
                                : 'text-ink-2',
                          )}
                        >
                          {song.name}
                        </span>
                        {/* Over the dark sheet the pink VIP / blue MV chips on
                            nearly every row were loud, and the blue failed
                            contrast. Quiet outlined tags there, like Apple's
                            explicit badge; the light panel keeps colour. */}
                        {song.fee === 1 ? (
                          <span
                            className={cn(
                              'song-tag shrink-0',
                              immersive ? 'song-tag--quiet' : 'song-tag--outline text-love',
                            )}
                          >
                            VIP
                          </span>
                        ) : null}
                        {song.mv || song.mvid ? (
                          <span
                            className={cn(
                              'song-tag shrink-0',
                              immersive ? 'song-tag--quiet' : 'song-tag--outline text-ink-3',
                            )}
                          >
                            MV
                          </span>
                        ) : null}
                      </div>
                      <p
                        className={cn(
                          'mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px]',
                          immersive
                            ? active
                              ? 'text-white/66'
                              : 'text-white/50'
                            : 'text-ink-4',
                        )}
                      >
                        <ArtistLinks artists={song.ar} className="min-w-0 truncate" />
                        {note ? (
                          <span
                            className={cn(
                              'shrink-0 rounded-[6px] px-1 text-[11px]',
                              immersive
                                ? 'bg-white/8 text-white/40'
                                : 'bg-black/6 text-ink-4',
                            )}
                          >
                            {note}
                          </span>
                        ) : null}
                      </p>
                    </div>
                    <span
                      className={cn(
                        'shrink-0 text-[11px] tabular-nums',
                        immersive ? 'text-white/45' : 'text-ink-4',
                      )}
                    >
                      {formatDuration(song.dt)}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {queue.length ? (
          <button
            type="button"
            aria-label={i18n._(msg`定位当前播放`)}
            title={i18n._(msg`定位当前播放`)}
            aria-hidden={!showLocate}
            tabIndex={showLocate ? 0 : -1}
            onClick={() =>
              virtualizer.scrollToIndex(currentIndex, {
                align: 'center',
                behavior: 'smooth',
              })
            }
            className={cn(
              'pressable absolute bottom-4 right-4 z-10 flex h-9 w-9 items-center justify-center rounded-full text-accent shadow-[0_8px_24px_rgba(0,0,0,0.2)] backdrop-blur-xl transition-[opacity,background-color] duration-200 hover:bg-accent/15 max-md:h-11 max-md:w-11',
              immersive
                ? 'border-0 bg-white/10'
                : 'border border-[var(--app-border-strong)] bg-[var(--app-glass)]',
              showLocate ? 'opacity-100' : 'pointer-events-none opacity-0',
            )}
          >
            <LocateFixed className="h-4 w-4" strokeWidth={1.8} />
          </button>
        ) : null}
      </aside>
    </div>
  )
}
