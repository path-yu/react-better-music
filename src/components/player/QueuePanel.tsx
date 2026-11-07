import { useEffect, useRef, type CSSProperties } from 'react'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { Trans } from '@lingui/react/macro'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ListMusic, LocateFixed, Trash2, Volume2, X } from 'lucide-react'
import { Button } from '@pikoloo/darwin-ui'
import { ArtistLinks } from '../common/ArtistLinks'
import { usePlayerStore } from '../../store/player'
import { usePlayerMenuTint } from '../../lib/menuSurface'
import { hexToRgb } from '../../lib/color'
import { formatDuration } from '../../lib/format'
import { cn } from '../../lib/format'
import { copyrightHint } from '../../lib/songs'

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

  if (!show) return null

  const virtualItems = virtualizer.getVirtualItems()
  const tintRgb = queueTint ? hexToRgb(queueTint) : null
  const activeRowStyle =
    immersive && tintRgb
      ? {
          backgroundColor: `rgba(${tintRgb.r}, ${tintRgb.g}, ${tintRgb.b}, 0.16)`,
        }
      : undefined
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
    <div className="absolute inset-x-0 bottom-[76px] top-[var(--titlebar-height,44px)] z-[70] flex justify-end">
      <button
        type="button"
        aria-label={i18n._(msg`关闭播放列表`)}
        className={cn(
          'absolute inset-0 backdrop-blur-[2px]',
          immersive ? 'bg-black/35' : 'bg-black/20',
        )}
        onClick={() => toggleQueue(false)}
      />
      <aside
        role="dialog"
        aria-label={i18n._(msg`播放列表`)}
        className={cn(
          'fade-up relative flex h-full w-[min(360px,100%)] flex-col border-l',
          immersive
            ? 'queue-panel-immersive border-white/10 shadow-[-24px_0_70px_-24px_rgba(0,0,0,0.8)]'
            : 'border-black/10 bg-[#fbfbfd]/95 shadow-[-20px_0_50px_-20px_rgba(0,0,0,0.3)] backdrop-blur-xl',
        )}
        style={panelStyle}
      >
        <div
          className={cn(
            'flex items-center justify-between px-4 py-3.5',
            immersive ? 'border-b-0' : 'border-b border-black/8',
          )}
        >
          <div className="flex items-center gap-2">
            <ListMusic
              className={cn('h-4 w-4', !immersive && 'text-accent')}
              style={immersive && queueTint ? { color: queueTint } : undefined}
            />
            <p
              className={cn(
                'text-[13px] font-semibold',
                immersive ? 'text-white/85' : 'text-black/80',
              )}
            >
              <Trans>播放列表</Trans>
            </p>
            <span
              className={cn(
                'text-[11px]',
                immersive ? 'text-white/40' : 'text-black/35',
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
                  : 'text-black/40',
              )}
              onClick={clearQueue}
            >
              <Trash2 className="mr-1 h-3 w-3" />
              <Trans>清空</Trans>
            </Button>
            <button
              type="button"
              aria-label={i18n._(msg`关闭`)}
              onClick={() => toggleQueue(false)}
              className={cn(
                'pressable flex h-7 w-7 items-center justify-center rounded-full max-md:h-10 max-md:w-10',
                immersive
                  ? 'text-white/45 hover:bg-white/8 hover:text-white/80'
                  : 'text-black/40 hover:bg-black/5 hover:text-black/70',
              )}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto py-1">
          <div
            className="relative w-full"
            style={{ height: `${virtualizer.getTotalSize()}px` }}
          >
            {virtualItems.map((virtualRow) => {
              const song = queue[virtualRow.index]
              if (!song) return null
              const active = virtualRow.index === currentIndex
              const note = copyrightHint(song)
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
                    className={cn(
                      'group flex h-full w-full cursor-pointer items-center gap-2.5 px-4 text-left transition-colors',
                      active
                        ? immersive
                          ? 'bg-white/10'
                          : 'bg-accent/8'
                        : immersive
                          ? 'hover:bg-white/6'
                          : 'hover:bg-black/4',
                    )}
                    style={active ? activeRowStyle : undefined}
                  >
                    <span className="flex w-4 shrink-0 justify-center">
                      {active ? (
                        <Volume2
                          className={cn(
                            'h-3.5 w-3.5 text-accent',
                            playing ? 'animate-pulse' : 'opacity-60',
                          )}
                          style={immersive && queueTint ? { color: queueTint } : undefined}
                        />
                      ) : (
                        <span
                          className={cn(
                            'text-[11px] tabular-nums',
                            immersive ? 'text-white/30' : 'text-black/25',
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
                            'min-w-0 truncate text-[12px]',
                            active
                              ? immersive
                                ? 'font-medium text-white'
                                : 'font-medium text-accent'
                              : immersive
                                ? 'text-white/85'
                                : 'text-black/75',
                          )}
                        >
                          {song.name}
                        </span>
                        {song.fee === 1 ? (
                          <span className="shrink-0 rounded bg-[#ff2d55]/10 px-1 text-[11px] text-[#ff2d55]">
                            VIP
                          </span>
                        ) : null}
                        {song.mv || song.mvid ? (
                          <span className="shrink-0 rounded-[4px] border-0 bg-accent/15 px-1 text-[10px] font-medium leading-[16px] text-accent">
                            MV
                          </span>
                        ) : null}
                      </div>
                      <p
                        className={cn(
                          'flex min-w-0 items-center gap-1.5 text-[11px]',
                          immersive ? 'text-white/40' : 'text-black/35',
                        )}
                      >
                        <ArtistLinks artists={song.ar} className="min-w-0 truncate" />
                        {note ? (
                          <span
                            className={cn(
                              'shrink-0 rounded-[6px] px-1 text-[11px]',
                              immersive
                                ? 'bg-white/8 text-white/40'
                                : 'bg-black/6 text-black/35',
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
                        immersive ? 'text-white/30' : 'text-black/25',
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
            onClick={() =>
              virtualizer.scrollToIndex(currentIndex, {
                align: 'center',
                behavior: 'smooth',
              })
            }
            className={cn(
              'pressable absolute bottom-[58px] right-4 z-10 flex h-9 w-9 items-center justify-center rounded-full text-accent shadow-[0_8px_24px_rgba(0,0,0,0.2)] backdrop-blur-xl transition-colors hover:bg-accent/15 max-md:h-11 max-md:w-11',
              immersive
                ? 'border-0 bg-white/10'
                : 'border border-[var(--app-border-strong)] bg-[var(--app-glass)]',
            )}
          >
            <LocateFixed className="h-4 w-4" strokeWidth={1.8} />
          </button>
        ) : null}

        <div
          className={cn(
            'px-4 py-3 text-center text-[11px]',
            immersive
              ? 'border-t-0 text-white/35'
              : 'border-t border-black/8 text-black/30',
          )}
        >
          <Trans>点击歌曲开始播放</Trans>
        </div>
      </aside>
    </div>
  )
}
