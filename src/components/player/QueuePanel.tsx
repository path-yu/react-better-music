import { ListMusic, Trash2, Volume2, X } from 'lucide-react'
import { Button } from '@pikoloo/darwin-ui'
import { ArtistLinks } from '../common/ArtistLinks'
import { usePlayerStore } from '../../store/player'
import { formatDuration } from '../../lib/format'
import { cn } from '../../lib/format'

export function QueuePanel() {
  const show = usePlayerStore((state) => state.showQueue)
  const queue = usePlayerStore((state) => state.queue)
  const currentIndex = usePlayerStore((state) => state.currentIndex)
  const playing = usePlayerStore((state) => state.playing)
  const toggleQueue = usePlayerStore((state) => state.toggleQueue)
  const playAt = usePlayerStore((state) => state.playAt)
  const clearQueue = usePlayerStore((state) => state.clearQueue)

  if (!show) return null

  return (
    <div className="absolute inset-x-0 bottom-[76px] top-0 z-[70] flex justify-end">
      <button
        type="button"
        aria-label="关闭播放列表"
        className="absolute inset-0 bg-black/20 backdrop-blur-[2px]"
        onClick={() => toggleQueue(false)}
      />
      <aside className="relative flex h-full w-[360px] flex-col border-l border-black/10 bg-[#fbfbfd]/95 shadow-[-20px_0_50px_-20px_rgba(0,0,0,0.3)] backdrop-blur-xl fade-up">
        <div className="flex items-center justify-between border-b border-black/8 px-4 py-3.5">
          <div className="flex items-center gap-2">
            <ListMusic className="h-4 w-4 text-[#0066cc]" />
            <p className="text-[13px] font-semibold text-black/80">播放列表</p>
            <span className="text-[11px] text-black/35">{queue.length} 首</span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 rounded-full px-2 text-[11px] text-black/40"
              onClick={clearQueue}
            >
              <Trash2 className="mr-1 h-3 w-3" />
              清空
            </Button>
            <button
              type="button"
              aria-label="关闭"
              onClick={() => toggleQueue(false)}
              className="pressable flex h-7 w-7 items-center justify-center rounded-full text-black/40 hover:bg-black/5 hover:text-black/70"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-1">
          {queue.map((song, index) => {
            const active = index === currentIndex
            return (
              <div
                key={`${song.id}-${index}`}
                role="button"
                tabIndex={0}
                onDoubleClick={() => void playAt(index)}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return
                  if (event.key === 'Enter') void playAt(index)
                }}
                className={cn(
                  'group flex w-full cursor-pointer items-center gap-2.5 px-4 py-2 text-left transition-colors',
                  active ? 'bg-[#0066cc]/8' : 'hover:bg-black/4',
                )}
              >
                <span className="flex w-4 shrink-0 justify-center">
                  {active ? (
                    <Volume2
                      className={cn(
                        'h-3.5 w-3.5 text-[#0066cc]',
                        playing ? 'animate-pulse' : 'opacity-60',
                      )}
                    />
                  ) : (
                    <span className="text-[10px] tabular-nums text-black/25">
                      {index + 1}
                    </span>
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        'min-w-0 truncate text-[12px]',
                        active ? 'font-medium text-[#0066cc]' : 'text-black/75',
                      )}
                    >
                      {song.name}
                    </span>
                    {song.fee === 1 ? (
                      <span className="shrink-0 rounded bg-[#ff2d55]/10 px-1 text-[9px] text-[#ff2d55]">
                        VIP
                      </span>
                    ) : null}
                    {song.fee === 0 ? (
                      <span className="shrink-0 rounded bg-black/6 px-1 text-[9px] text-black/35">
                        无音源
                      </span>
                    ) : null}
                    {(song.mv || song.mvid) ? (
                      <span className="shrink-0 rounded bg-[#0066cc]/10 px-1 text-[9px] text-[#0066cc]">
                        MV
                      </span>
                    ) : null}
                  </div>
                  <p className="truncate text-[10.5px] text-black/35">
                    <ArtistLinks artists={song.ar} />
                  </p>
                </div>
                <span className="shrink-0 text-[10px] tabular-nums text-black/25">
                  {formatDuration(song.dt)}
                </span>
              </div>
            )
          })}
        </div>

        <div className="border-t border-black/8 px-4 py-3 text-center text-[10.5px] text-black/30">
          双击歌曲开始播放
        </div>
      </aside>
    </div>
  )
}
