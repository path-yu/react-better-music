import { useEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Heart, Pause, Play, Volume2 } from 'lucide-react'
import { ImageWithFallback } from '../common/ImageWithFallback'
import { ArtistLinks } from '../common/ArtistLinks'
import { EmptyState } from '../common/EmptyState'
import { Skeleton } from '@pikoloo/darwin-ui'
import { usePlayerStore } from '../../store/player'
import { useUserStore } from '../../store/user'
import { formatDuration } from '../../lib/format'
import { cn } from '../../lib/format'
import type { Song } from '../../types'

interface SongTableProps {
  songs: Song[]
  playlistId: string
  loading?: boolean
  emptyText?: string
  className?: string
  showHeader?: boolean
}

const VIRTUAL_THRESHOLD = 500
const ROW_HEIGHT = 53

export function SongTable({
  songs,
  playlistId,
  loading = false,
  emptyText = '暂无歌曲',
  className,
  showHeader = true,
}: SongTableProps) {
  const [hovered, setHovered] = useState<number | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const initQueue = usePlayerStore((state) => state.initQueue)
  const togglePlay = usePlayerStore((state) => state.togglePlay)
  const currentSong = usePlayerStore((state) => state.queue[state.currentIndex])
  const playing = usePlayerStore((state) => state.playing)
  const likedIds = useUserStore((state) => state.likedIds)
  const likeSong = useUserStore((state) => state.likeSong)
  const isLogin = useUserStore((state) => state.isLogin)

  const isVirtual = songs.length > VIRTUAL_THRESHOLD
  const virtualizer = useVirtualizer({
    count: isVirtual ? songs.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  })

  useEffect(() => {
    if (!isVirtual || !scrollRef.current) return
    scrollRef.current.scrollTop = 0
  }, [isVirtual, songs])

  const handlePlay = (index: number) => {
    if (currentSong?.id === songs[index]?.id) {
      void togglePlay()
      return
    }
    void initQueue(songs, index, playlistId)
  }

  if (loading) {
    return (
      <div className={cn('overflow-hidden rounded-[16px] border border-black/8', className)}>
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="flex items-center gap-3 border-b border-black/5 px-4 py-3">
            <Skeleton className="h-9 w-9 rounded-[7px]" />
            <Skeleton className="h-3 w-[26%] rounded-full" />
            <Skeleton className="h-3 w-[18%] rounded-full" />
            <Skeleton className="ml-auto h-3 w-10 rounded-full" />
          </div>
        ))}
      </div>
    )
  }

  if (!songs.length) {
    return <EmptyState title={emptyText} />
  }

  const gridClass = 'song-grid'

  const renderRow = (song: Song, index: number, virtual = false) => {
    const active = currentSong?.id === song.id
    const liked = likedIds.includes(song.id)
    return (
      <div
        key={`${song.id}-${index}`}
        onDoubleClick={() => handlePlay(index)}
        onMouseEnter={() => setHovered(index)}
        onMouseLeave={() => setHovered(null)}
        className={cn(
          gridClass,
          'rounded-[10px] px-3 py-2 transition-colors',
          virtual && 'h-full',
          active ? 'bg-[#0066cc]/6' : hovered === index ? 'bg-black/4' : '',
        )}
      >
        <div className="flex h-6 items-center justify-center">
          {hovered === index ? (
            <button
              type="button"
              aria-label={active && playing ? '暂停' : '播放'}
              onClick={() => handlePlay(index)}
              className="pressable text-[#0066cc]"
            >
              {active && playing ? (
                <Pause className="h-3.5 w-3.5 fill-current" />
              ) : (
                <Play className="h-3.5 w-3.5 fill-current" />
              )}
            </button>
          ) : active ? (
            <Volume2
              className={cn(
                'h-3.5 w-3.5 text-[#0066cc]',
                playing ? 'animate-pulse' : 'opacity-60',
              )}
            />
          ) : (
            <span className="text-[10.5px] tabular-nums text-black/25">
              {index < 9 ? `0${index + 1}` : index + 1}
            </span>
          )}
        </div>

        <div className="flex min-w-0 items-center gap-2.5">
          <ImageWithFallback
            src={song.al.picUrl}
            alt={song.name}
            rounded="rounded-[6px]"
            className="h-9 w-9 shrink-0"
          />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <span
                className={cn(
                  'truncate text-[12.5px]',
                  active ? 'font-medium text-[#0066cc]' : 'text-black/80',
                )}
              >
                {song.name}
              </span>
              {song.mv || song.mvid ? (
                <span className="shrink-0 rounded-[3px] bg-[#0066cc]/10 px-1 text-[9px] font-medium text-[#0066cc]">
                  MV
                </span>
              ) : null}
              {song.fee === 1 ? (
                <span className="shrink-0 rounded-[3px] bg-[#ff2d55]/10 px-1 text-[9px] font-medium text-[#ff2d55]">
                  VIP
                </span>
              ) : null}
              {song.fee === 0 ? (
                <span className="shrink-0 rounded-[3px] bg-black/6 px-1 text-[9px] text-black/35">
                  无音源
                </span>
              ) : null}
            </div>
            <p className="song-artist-mobile mt-0.5 truncate text-[10.5px] text-black/35">
              <ArtistLinks artists={song.ar} />
            </p>
          </div>
          <button
            type="button"
            aria-label={liked ? '取消喜欢' : '喜欢'}
            onClick={() => {
              if (!isLogin) return
              void likeSong(song.id, !liked)
            }}
            className={cn(
              'pressable shrink-0 transition-opacity',
              liked ? 'opacity-100' : hovered === index ? 'opacity-100' : 'opacity-0',
            )}
          >
            <Heart
              className={cn(
                'h-3.5 w-3.5',
                liked ? 'fill-[#ff2d55] text-[#ff2d55]' : 'text-black/35',
              )}
            />
          </button>
        </div>

        <p className="song-meta truncate text-[11.5px] text-black/45">
          <ArtistLinks artists={song.ar} />
        </p>
        <p className="song-meta truncate text-[11.5px] text-black/40">{song.al.name}</p>
        <p className="text-right text-[10.5px] tabular-nums text-black/30">
          {formatDuration(song.dt)}
        </p>
      </div>
    )
  }

  const header = showHeader ? (
    <div
      className={cn(
        gridClass,
        'border-b border-black/8 bg-white/88 px-3 py-2 text-[10.5px] font-medium text-black/35 backdrop-blur-xl',
        !isVirtual && 'sticky top-0 z-10',
      )}
    >
      <span className="text-center">#</span>
      <span>标题</span>
      <span className="song-meta">歌手</span>
      <span className="song-meta">专辑</span>
      <span className="text-right">时长</span>
    </div>
  ) : null

  if (isVirtual) {
    const virtualItems = virtualizer.getVirtualItems()
    return (
      <div className={cn('select-none', className)}>
        {header}
        <div
          ref={scrollRef}
          className="relative h-[72vh] max-h-[700px] min-h-[360px] overflow-y-auto overscroll-contain pr-1"
        >
          <div
            className="relative w-full"
            style={{ height: `${virtualizer.getTotalSize()}px` }}
          >
            {virtualItems.map((virtualRow) => {
              const song = songs[virtualRow.index]
              if (!song) return null
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
                  {renderRow(song, virtualRow.index, true)}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={cn('select-none', className)}>
      {header}
      <div className="py-1">
        {songs.map((song, index) => renderRow(song, index))}
      </div>
    </div>
  )
}
