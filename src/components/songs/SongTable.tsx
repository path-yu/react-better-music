import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useVirtualizer } from '@tanstack/react-virtual'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { Trans } from '@lingui/react/macro'
import { Heart, Pause, Play, Trash2, Volume2 } from 'lucide-react'
import { ImageWithFallback } from '../common/ImageWithFallback'
import { ArtistLinks } from '../common/ArtistLinks'
import { EmptyState } from '../common/EmptyState'
import { SongContextMenu } from './SongContextMenu'
import { Skeleton } from '@pikoloo/darwin-ui'
import { usePlayerStore } from '../../store/player'
import { useUserStore } from '../../store/user'
import { useLocalLibraryStore } from '../../store/localLibrary'
import { formatDuration } from '../../lib/format'
import { cn } from '../../lib/format'
import { copyrightHint } from '../../lib/songs'
import type { Song } from '../../types'

interface SongTableProps {
  songs: Song[]
  playlistId: string
  loading?: boolean
  emptyText?: string
  className?: string
  showHeader?: boolean
  /** Local playlist page: remove a song from that playlist. */
  onRemoveSong?: (song: Song) => void
}

const VIRTUAL_THRESHOLD = 500
const ROW_HEIGHT = 53
const SONG_GRID = 'song-grid'

interface SongRowProps {
  song: Song
  index: number
  active: boolean
  playing: boolean
  liked: boolean
  virtual?: boolean
  /** The first screenful loads eagerly; the rest stays lazy. */
  priority?: boolean
  /** The final row should not draw a trailing divider. */
  last?: boolean
  onPlay: (index: number) => void
  onLike: (song: Song, liked: boolean) => void
  onRemove?: () => void
  onContextMenu: (index: number, x: number, y: number) => void
}

/**
 * Memoized so a play/like change only repaints the affected row instead of
 * every row in a large playlist.
 */
const SongRow = memo(function SongRow({
  song,
  index,
  active,
  playing,
  liked,
  virtual = false,
  priority = false,
  last = false,
  onPlay,
  onLike,
  onRemove,
  onContextMenu,
}: SongRowProps) {
  const { i18n } = useLingui()
  const note = copyrightHint(song)
  return (
    <div
      onClick={(event) => {
        // Nested buttons (play / like / artist links) handle their own clicks.
        if ((event.target as HTMLElement).closest('button, a')) return
        onPlay(index)
      }}
      onContextMenu={(event) => {
        event.preventDefault()
        onContextMenu(index, event.clientX, event.clientY)
      }}
      data-last={last || undefined}
      className={cn(
        SONG_GRID,
        'song-row group relative rounded-[10px] px-3 py-2 transition-colors',
        virtual && 'h-full',
        active ? 'is-active bg-accent/6' : 'hover:bg-black/4',
      )}
    >
      <div className="relative flex h-6 items-center justify-center">
        {active ? (
          <Volume2
            className={cn(
              'h-3.5 w-3.5 text-accent transition-opacity group-hover:opacity-0',
              playing ? 'animate-pulse' : 'opacity-60',
            )}
          />
        ) : (
          <span className="text-[11px] tabular-nums text-black/25 transition-opacity group-hover:opacity-0">
            {index < 9 ? `0${index + 1}` : index + 1}
          </span>
        )}
        <button
          type="button"
          aria-label={
            active && playing ? i18n._(msg`暂停`) : i18n._(msg`播放`)
          }
          onClick={() => onPlay(index)}
          className="pressable absolute inset-0 flex items-center justify-center text-accent opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
        >
          {active && playing ? (
            <Pause className="h-3.5 w-3.5 fill-current" />
          ) : (
            <Play className="h-3.5 w-3.5 fill-current" />
          )}
        </button>
      </div>

      <div className="flex min-w-0 items-center gap-2.5">
        <ImageWithFallback
          src={song.al.picUrl}
          alt={song.name}
          rounded="rounded-[6px]"
          resize="96y96"
          priority={priority}
          className="h-9 w-9 shrink-0"
        />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span
              className={cn(
                'truncate text-[12.5px]',
                active ? 'font-medium text-accent' : 'text-black/80',
              )}
            >
              {song.name}
            </span>
            {song.mv || song.mvid ? (
              <span className="shrink-0 rounded-[6px] bg-accent/10 px-1 text-[11px] font-medium text-accent">
                MV
              </span>
            ) : null}
            {song.fee === 1 ? (
              <span className="shrink-0 rounded-[6px] bg-[#ff2d55]/10 px-1 text-[11px] font-medium text-[#ff2d55]">
                VIP
              </span>
            ) : null}
          </div>
          <p className="song-artist-mobile mt-0.5 truncate text-[11px] text-black/35">
            <ArtistLinks artists={song.ar} />
            {note ? (
              <span className="ml-1.5 rounded-[6px] bg-black/6 px-1 text-[11px] text-black/35">
                {note}
              </span>
            ) : null}
          </p>
        </div>
        {onRemove ? (
          <button
            type="button"
            aria-label={i18n._(msg`从歌单移除`)}
            title={i18n._(msg`从歌单移除`)}
            onClick={onRemove}
            className="pressable shrink-0 text-black/30 opacity-0 transition-opacity hover:text-[#ff2d55] focus-visible:opacity-100 group-hover:opacity-100"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        ) : null}
        <button
          type="button"
          aria-label={
            liked ? i18n._(msg`取消喜欢`) : i18n._(msg`喜欢`)
          }
          onClick={() => onLike(song, liked)}
          className={cn(
            'pressable shrink-0 transition-opacity focus-visible:opacity-100',
            liked ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
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

      <div className="song-meta min-w-0">
        <div className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-black/45">
          <ArtistLinks artists={song.ar} className="min-w-0 truncate" />
          {note ? (
            <span className="shrink-0 rounded-[6px] bg-black/6 px-1 text-[11px] text-black/35">
              {note}
            </span>
          ) : null}
        </div>
      </div>
      <p className="song-meta truncate text-[11.5px] text-black/40">
        {song.al.id ? (
          <Link
            to="/albums/$id"
            params={{ id: String(song.al.id) }}
            className="hover:text-accent hover:underline"
          >
            {song.al.name}
          </Link>
        ) : (
          song.al.name
        )}
      </p>
      <p className="text-right text-[11px] tabular-nums text-black/30">
        {formatDuration(song.dt)}
      </p>
    </div>
  )
})

export function SongTable({
  songs,
  playlistId,
  loading = false,
  emptyText = '暂无歌曲',
  className,
  showHeader = true,
  onRemoveSong,
}: SongTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const currentSong = usePlayerStore((state) => state.queue[state.currentIndex])
  const playing = usePlayerStore((state) => state.playing)
  const likedIds = useUserStore((state) => state.likedIds)
  const isLogin = useUserStore((state) => state.isLogin)
  const localFavorites = useLocalLibraryStore((state) => state.favorites)
  const likedSet = useMemo(
    () =>
      new Set(
        isLogin ? likedIds : localFavorites.map((favorite) => favorite.id),
      ),
    [isLogin, likedIds, localFavorites],
  )
  const [contextMenu, setContextMenu] = useState<{
    song: Song
    x: number
    y: number
  } | null>(null)

  // Keep row callbacks referentially stable so memoized rows do not repaint
  // when only the parent component re-renders.
  const songsRef = useRef(songs)
  songsRef.current = songs
  const playlistIdRef = useRef(playlistId)
  playlistIdRef.current = playlistId

  const handlePlay = useCallback((index: number) => {
    const player = usePlayerStore.getState()
    const song = songsRef.current[index]
    if (!song) return
    if (player.queue[player.currentIndex]?.id === song.id) {
      void player.togglePlay()
      return
    }
    void player.initQueue(songsRef.current, index, playlistIdRef.current)
  }, [])

  const handleLike = useCallback((song: Song, liked: boolean) => {
    const user = useUserStore.getState()
    if (user.isLogin) {
      void user.likeSong(song.id, !liked)
      return
    }
    // Guest/desktop mode writes favourites to the local library file.
    void useLocalLibraryStore.getState().toggleFavorite(song)
  }, [])

  const handleContextMenu = useCallback((index: number, x: number, y: number) => {
    const song = songsRef.current[index]
    if (song) setContextMenu({ song, x, y })
  }, [])

  const closeContextMenu = useCallback(() => setContextMenu(null), [])

  const contextMenuNode = contextMenu ? (
    <SongContextMenu
      song={contextMenu.song}
      liked={likedSet.has(contextMenu.song.id)}
      x={contextMenu.x}
      y={contextMenu.y}
      onClose={closeContextMenu}
    />
  ) : null

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

  if (loading) {
    return (
      <div className={cn('overflow-hidden rounded-[18px] border border-black/8', className)}>
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="flex items-center gap-3 border-b border-black/5 px-4 py-3">
            <Skeleton className="h-9 w-9 rounded-[6px]" />
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

  const renderRow = (song: Song, index: number, virtual = false) => {
    const active = currentSong?.id === song.id
    return (
      <SongRow
        key={`${song.id}-${index}`}
        song={song}
        index={index}
        active={active}
        playing={active && playing}
        liked={likedSet.has(song.id)}
        virtual={virtual}
        priority={index < 8}
        last={index === songs.length - 1}
        onPlay={handlePlay}
        onLike={handleLike}
        onRemove={onRemoveSong ? () => onRemoveSong(song) : undefined}
        onContextMenu={handleContextMenu}
      />
    )
  }

  const header = showHeader ? (
    <div
      className={cn(
        SONG_GRID,
        'border-b border-black/8 bg-white/88 px-3 py-2 text-[11px] font-medium text-black/35 backdrop-blur-xl',
        !isVirtual && 'sticky top-0 z-10',
      )}
    >
      <span className="text-center">#</span>
      <span>
        <Trans>标题</Trans>
      </span>
      <span className="song-meta">
        <Trans>歌手</Trans>
      </span>
      <span className="song-meta">
        <Trans>专辑</Trans>
      </span>
      <span className="text-right">
        <Trans>时长</Trans>
      </span>
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
        {contextMenuNode}
      </div>
    )
  }

  return (
    <div className={cn('select-none', className)}>
      {header}
      <div className="py-1">
        {songs.map((song, index) => renderRow(song, index))}
      </div>
      {contextMenuNode}
    </div>
  )
}
