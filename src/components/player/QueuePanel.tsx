import { useEffect, useRef } from 'react'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { Trans } from '@lingui/react/macro'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ListMusic, Trash2, Volume2, X } from 'lucide-react'
import { Button } from '@pikoloo/darwin-ui'
import { ArtistLinks } from '../common/ArtistLinks'
import { usePlayerStore } from '../../store/player'
import { formatDuration } from '../../lib/format'
import { cn } from '../../lib/format'
import { copyrightHint } from '../../lib/songs'

const ROW_HEIGHT = 56

export function QueuePanel() {
  const { i18n } = useLingui()
  const show = usePlayerStore((state) => state.showQueue)
  const queue = usePlayerStore((state) => state.queue)
  const currentIndex = usePlayerStore((state) => state.currentIndex)
  const playing = usePlayerStore((state) => state.playing)
  const toggleQueue = usePlayerStore((state) => state.toggleQueue)
  const playAt = usePlayerStore((state) => state.playAt)
  const togglePlay = usePlayerStore((state) => state.togglePlay)
  const clearQueue = usePlayerStore((state) => state.clearQueue)
  const scrollRef = useRef<HTMLDivElement>(null)

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

  const handleRowPlay = (index: number) => {
    // Clicking the active row should pause/resume, not restart from zero.
    if (index === currentIndex) {
      void togglePlay()
      return
    }
    void playAt(index)
  }

  return (
    <div className="absolute inset-x-0 bottom-[76px] top-0 z-[70] flex justify-end">
      <button
        type="button"
        aria-label={i18n._(msg`关闭播放列表`)}
        className="absolute inset-0 bg-black/20 backdrop-blur-[2px]"
        onClick={() => toggleQueue(false)}
      />
      <aside
        role="dialog"
        aria-label={i18n._(msg`播放列表`)}
        className="relative flex h-full w-[min(360px,100%)] flex-col border-l border-black/10 bg-[#fbfbfd]/95 shadow-[-20px_0_50px_-20px_rgba(0,0,0,0.3)] backdrop-blur-xl fade-up"
      >
        <div className="flex items-center justify-between border-b border-black/8 px-4 py-3.5">
          <div className="flex items-center gap-2">
            <ListMusic className="h-4 w-4 text-accent" />
            <p className="text-[13px] font-semibold text-black/80">
              <Trans>播放列表</Trans>
            </p>
            <span className="text-[11px] text-black/35">
              <Trans>{queue.length} 首</Trans>
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 rounded-full px-2 text-[11px] text-black/40"
              onClick={clearQueue}
            >
              <Trash2 className="mr-1 h-3 w-3" />
              <Trans>清空</Trans>
            </Button>
            <button
              type="button"
              aria-label={i18n._(msg`关闭`)}
              onClick={() => toggleQueue(false)}
              className="pressable flex h-7 w-7 items-center justify-center rounded-full text-black/40 hover:bg-black/5 hover:text-black/70 max-md:h-10 max-md:w-10"
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
                      active ? 'bg-accent/8' : 'hover:bg-black/4',
                    )}
                  >
                    <span className="flex w-4 shrink-0 justify-center">
                      {active ? (
                        <Volume2
                          className={cn(
                            'h-3.5 w-3.5 text-accent',
                            playing ? 'animate-pulse' : 'opacity-60',
                          )}
                        />
                      ) : (
                        <span className="text-[11px] tabular-nums text-black/25">
                          {virtualRow.index + 1}
                        </span>
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            'min-w-0 truncate text-[12px]',
                            active ? 'font-medium text-accent' : 'text-black/75',
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
                          <span className="queue-mv-badge shrink-0 rounded-[4px] bg-accent/15 px-1 text-[10px] font-medium leading-[16px] text-accent">
                            MV
                          </span>
                        ) : null}
                      </div>
                      <p className="flex min-w-0 items-center gap-1.5 text-[11px] text-black/35">
                        <ArtistLinks artists={song.ar} className="min-w-0 truncate" />
                        {note ? (
                          <span className="shrink-0 rounded-[6px] bg-black/6 px-1 text-[11px] text-black/35">
                            {note}
                          </span>
                        ) : null}
                      </p>
                    </div>
                    <span className="shrink-0 text-[11px] tabular-nums text-black/25">
                      {formatDuration(song.dt)}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="border-t border-black/8 px-4 py-3 text-center text-[11px] text-black/30">
          <Trans>点击歌曲开始播放</Trans>
        </div>
      </aside>
    </div>
  )
}
