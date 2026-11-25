import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Link } from '@tanstack/react-router'
import { useVirtualizer } from '@tanstack/react-virtual'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { Trans } from '@lingui/react/macro'
import { Heart, LocateFixed, Pause, Play, Trash2 } from 'lucide-react'
import { ImageWithFallback } from '../common/ImageWithFallback'
import { ArtistLinks } from '../common/ArtistLinks'
import { EmptyState } from '../common/EmptyState'
import { SongContextMenu } from './SongContextMenu'
import { AddSelectedToPlaylist } from './AddSelectedToPlaylist'
import { Button, Skeleton } from '@pikoloo/darwin-ui'
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
  /** Playlist pages: expose "remove from playlist" in the row context menu. */
  onRemoveFromPlaylist?: (song: Song) => void | Promise<void>
  /** Offset the sticky header when a tab bar is pinned above the table. */
  stickyTop?: number
  /**
   * Artist page: every row is this artist, so the 歌手 column is dropped and
   * only featured artists are shown, under the title.
   */
  pageArtistId?: number
  /** Album page: every row is the same album, so the 专辑 column is dropped. */
  hideAlbum?: boolean
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
  /** Ctrl/Cmd-click multi-select state for this row. */
  selected: boolean
  onToggleSelect: (songId: number) => void
  onPlay: (index: number) => void
  onLike: (song: Song, liked: boolean) => void
  onRemove?: () => void
  onContextMenu: (index: number, x: number, y: number) => void
  /** Keep the artist line under the title on wide tables (featured artists). */
  showFeatured?: boolean
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
  selected,
  onToggleSelect,
  onPlay,
  onLike,
  onRemove,
  onContextMenu,
  showFeatured = false,
}: SongRowProps) {
  const { i18n } = useLingui()
  const note = copyrightHint(song)
  return (
    <div
      onClick={(event) => {
        // Nested buttons (play / like / artist links) handle their own clicks.
        if ((event.target as HTMLElement).closest('button, a')) return
        // Ctrl/Cmd toggles multi-select instead of starting playback.
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault()
          onToggleSelect(song.id)
          return
        }
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
        selected
          ? 'bg-accent/12 ring-1 ring-accent/30'
          : active
            ? 'is-active bg-accent/6'
            : 'hover:bg-black/4',
      )}
    >
      <div className="relative flex h-6 items-center justify-center">
        {active ? (
          // Same playing bars as the queues: they bounce while playing and
          // rest when paused (the old pulsing speaker read the same either way).
          <span
            className={cn(
              'np-eq text-accent transition-opacity group-hover:opacity-0',
              playing && 'is-playing',
            )}
            role="img"
            aria-label={playing ? i18n._(msg`正在播放`) : i18n._(msg`已暂停`)}
          >
            <i />
            <i />
            <i />
          </span>
        ) : (
          <span className="text-center text-[12px] font-medium leading-none tabular-nums text-ink-4 transition-opacity group-hover:opacity-0">
            {index + 1}
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
                'truncate text-[13px]',
                active ? 'font-medium text-accent' : 'text-ink-1',
              )}
            >
              {song.name}
            </span>
            {/* Outlined, not filled: on most rows both tags appear, and two
                coloured blocks per row out-shouted the song names. MV is a
                link to the video. Same order as the queue: VIP, then MV. */}
            {song.fee === 1 ? (
              <span className="song-tag song-tag--outline shrink-0 text-love">
                VIP
              </span>
            ) : null}
            {song.mv || song.mvid ? (
              <Link
                to="/mv/$id"
                params={{ id: String(song.mv || song.mvid) }}
                aria-label={i18n._(msg`观看 MV`)}
                title={i18n._(msg`观看 MV`)}
                className="song-tag song-tag--outline shrink-0 text-ink-3 transition-colors hover:text-accent"
              >
                MV
              </Link>
            ) : null}
          </div>
          <p
            className={cn(
              'song-artist-mobile mt-0.5 truncate text-[11px] text-ink-4',
              showFeatured && 'song-artist-mobile--keep',
            )}
          >
            <ArtistLinks artists={song.ar} />
            {note ? (
              <span className="ml-1.5 rounded-[6px] bg-black/6 px-1 text-[11px] text-ink-4">
                {note}
              </span>
            ) : null}
          </p>
        </div>
      </div>

      <div className="song-meta song-col-artist min-w-0">
        <div className="flex min-w-0 items-center gap-1.5 text-[12px] text-ink-3">
          <ArtistLinks artists={song.ar} className="min-w-0 truncate" />
          {note ? (
            <span className="shrink-0 rounded-[6px] bg-black/6 px-1 text-[11px] text-ink-4">
              {note}
            </span>
          ) : null}
        </div>
      </div>
      <p className="song-meta song-col-album truncate text-[12px] text-ink-3">
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
      {/* Row actions sit with the duration (as in Apple Music), not at the
          end of a wide title column where they floated next to the artist. */}
      <div className="flex items-center justify-end gap-3">
          {onRemove ? (
            <button
              type="button"
              aria-label={i18n._(msg`从歌单移除`)}
              title={i18n._(msg`从歌单移除`)}
              onClick={onRemove}
              className="pressable shrink-0 text-ink-4 opacity-0 transition-opacity hover:text-love focus-visible:opacity-100 group-hover:opacity-100"
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
                liked ? 'fill-love text-love' : 'text-ink-4',
              )}
            />
          </button>
        <span className="w-9 text-right text-[12px] tabular-nums text-ink-3">
          {formatDuration(song.dt)}
        </span>
      </div>
    </div>
  )
})

export function SongTable({
  songs,
  playlistId,
  loading = false,
  emptyText,
  className,
  showHeader = true,
  onRemoveSong,
  onRemoveFromPlaylist,
  stickyTop,
  pageArtistId,
  hideAlbum = false,
}: SongTableProps) {
  const { i18n } = useLingui()
  const rootRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  // The page's own scroll container. Long lists used to get a second,
  // 72vh-tall scroll box inside the page: two scrollbars, a header that did
  // not stick with the page, and columns shifted by the inner scrollbar.
  // `undefined` = not looked up yet, `null` = none found (inner box fallback).
  const [scrollParent, setScrollParent] = useState<HTMLElement | null | undefined>(
    undefined,
  )
  const [scrollMargin, setScrollMargin] = useState(0)
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
  const [showLocate, setShowLocate] = useState(false)
  const locateTimerRef = useRef<number | null>(null)

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
      onRemoveFromPlaylist={
        onRemoveFromPlaylist
          ? () => onRemoveFromPlaylist(contextMenu.song)
          : undefined
      }
    />
  ) : null

  const isVirtual = songs.length > VIRTUAL_THRESHOLD
  const hasRows = !loading && songs.length > 0

  useLayoutEffect(() => {
    if (!hasRows) return
    let parent = rootRef.current?.parentElement ?? null
    while (parent && parent !== document.body) {
      if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) break
      parent = parent.parentElement
    }
    setScrollParent(parent && parent !== document.body ? parent : null)
  }, [hasRows])

  /** Virtual rows scroll with the page (`null` keeps the old inner box). */
  const pageScroll = isVirtual && !!scrollParent
  const innerScroll = isVirtual && scrollParent === null

  // Where the list starts inside the scroll container; content above it (a
  // description that expands, a cover that loads) moves it.
  useLayoutEffect(() => {
    const parent = scrollParent
    const list = listRef.current
    if (!pageScroll || !parent || !list) return
    const measure = () => {
      const next = Math.round(
        list.getBoundingClientRect().top -
          parent.getBoundingClientRect().top +
          parent.scrollTop,
      )
      setScrollMargin((previous) => (previous === next ? previous : next))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(parent)
    for (const child of Array.from(parent.children)) observer.observe(child)
    return () => observer.disconnect()
  }, [pageScroll, scrollParent])

  const virtualizer = useVirtualizer({
    count: pageScroll || innerScroll ? songs.length : 0,
    getScrollElement: () => (pageScroll ? (scrollParent ?? null) : scrollRef.current),
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
    scrollMargin: pageScroll ? scrollMargin : 0,
  })
  const currentIndexInList = useMemo(
    () =>
      currentSong
        ? songs.findIndex((song) => song.id === currentSong.id)
        : -1,
    [currentSong, songs],
  )

  useEffect(() => {
    if (!innerScroll || !scrollRef.current) return
    scrollRef.current.scrollTop = 0
  }, [innerScroll, songs])

  // The locate affordance belongs to scrolling, not to the idle table. Show it
  // for two seconds after the list (or its page) scrolls, then let it fade out.
  useEffect(() => {
    setShowLocate(false)
    if (loading) return
    const target = innerScroll ? scrollRef.current : scrollParent
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
      target?.removeEventListener('scroll', reveal)
      if (locateTimerRef.current !== null) {
        window.clearTimeout(locateTimerRef.current)
        locateTimerRef.current = null
      }
    }
  }, [innerScroll, loading, scrollParent, songs.length])

  // Ctrl/Cmd-click selection: rows toggle instead of playing. Cleared when the
  // table switches to another playlist so a stale selection cannot leak.
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set())
  const toggleSelect = useCallback((songId: number) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(songId)) next.delete(songId)
      else next.add(songId)
      return next
    })
  }, [])
  const clearSelection = useCallback(() => setSelectedIds(new Set()), [])
  useEffect(() => {
    setSelectedIds(new Set())
  }, [playlistId])
  const selectedSongs = useMemo(
    () => songs.filter((song) => selectedIds.has(song.id)),
    [songs, selectedIds],
  )

  const selectionBar = selectedIds.size ? (
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-[10px] bg-accent/8 px-3 py-2">
      <span className="text-[12px] text-ink-2">
        <Trans>已选择 {selectedIds.size} 首</Trans>
      </span>
      <div className="flex items-center gap-2">
        <AddSelectedToPlaylist songs={selectedSongs} onDone={clearSelection} />
        <Button
          variant="secondary"
          size="sm"
          className="rounded-full px-3 text-[11px]"
          onClick={clearSelection}
        >
          <Trans>取消选择</Trans>
        </Button>
      </div>
    </div>
  ) : null

  const locateCurrent = () => {
    if (currentIndexInList < 0) return
    if (isVirtual) {
      virtualizer.scrollToIndex(currentIndexInList, {
        align: 'center',
        behavior: 'smooth',
      })
      return
    }
    const row = listRef.current?.querySelector<HTMLElement>(
      `[data-song-id="${currentSong?.id}"]`,
    )
    row?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const locateButton =
    currentIndexInList >= 0 ? (
      <button
        type="button"
        aria-label={i18n._(msg`定位当前播放`)}
        title={i18n._(msg`定位当前播放`)}
        aria-hidden={!showLocate}
        tabIndex={showLocate ? 0 : -1}
        onClick={locateCurrent}
        className={cn(
          'pressable fixed bottom-[88px] right-5 z-40 flex h-10 w-10 items-center justify-center rounded-full border border-[var(--app-border-strong)] bg-[var(--app-glass)] text-accent shadow-[0_10px_30px_rgba(0,0,0,0.22)] backdrop-blur-xl transition-[opacity,background-color] duration-200 hover:bg-accent/15 max-md:right-4',
          showLocate
            ? 'opacity-100'
            : 'pointer-events-none opacity-0',
        )}
      >
        <LocateFixed className="h-4 w-4" strokeWidth={1.8} />
      </button>
    ) : null

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
    return <EmptyState title={emptyText ?? i18n._(msg`暂无歌曲`)} />
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
        showFeatured={
          pageArtistId !== undefined &&
          song.ar.some((artist) => Number(artist.id) !== pageArtistId)
        }
        selected={selectedIds.has(song.id)}
        onToggleSelect={toggleSelect}
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
        // Follow the active palette instead of a neutral white/near-black
        // surface; custom dark themes were showing a grey strip here.
        // Opaque, in the page's own colour: rows scroll under it, and the old
        // grey glass both read as a separate strip and let row text show
        // through.
        'border-b border-[var(--app-border)] bg-[var(--app-content)] px-3 py-2 text-[11px] font-medium text-[var(--ink-4)]',
        !innerScroll && 'sticky top-0 z-10',
      )}
      style={!innerScroll && stickyTop !== undefined ? { top: stickyTop } : undefined}
    >
      <span className="text-center">#</span>
      <span>
        <Trans>标题</Trans>
      </span>
      <span className="song-meta song-col-artist">
        <Trans>歌手</Trans>
      </span>
      <span className="song-meta song-col-album">
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
      <div
        ref={rootRef}
        className={cn(
          'select-none',
          pageArtistId !== undefined && 'song-table--no-artist',
          hideAlbum && 'song-table--no-album',
          className,
        )}
      >
        {selectionBar}
        <div className="song-table">
          {header}
          <div
            ref={scrollRef}
            className={cn(
              innerScroll &&
                'relative h-[72vh] max-h-[700px] min-h-[360px] overflow-y-auto pr-1',
            )}
          >
            <div
              ref={listRef}
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
                      transform: `translateY(${
                        virtualRow.start - virtualizer.options.scrollMargin
                      }px)`,
                    }}
                  >
                    {renderRow(song, virtualRow.index, true)}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
        {locateButton}
        {contextMenuNode}
      </div>
    )
  }

  return (
    <div
        ref={rootRef}
        className={cn(
          'select-none',
          pageArtistId !== undefined && 'song-table--no-artist',
          hideAlbum && 'song-table--no-album',
          className,
        )}
      >
      {selectionBar}
      {/* The container wraps only the grid: `container` implies layout
          containment, which would pin the fixed locate button to the table. */}
      <div className="song-table">
        {header}
        <div ref={listRef} className="py-1">
          {songs.map((song, index) => (
            <div key={`${song.id}-${index}`} data-song-id={song.id}>
              {renderRow(song, index)}
            </div>
          ))}
        </div>
      </div>
      {locateButton}
      {contextMenuNode}
    </div>
  )
}
