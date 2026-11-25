import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from '@tanstack/react-router'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { Trans } from '@lingui/react/macro'
import {
  ChevronLeft,
  ChevronRight,
  Disc3,
  Film,
  Heart,
  ListMusic,
  ListPlus,
  ListStart,
  Loader2,
  Trash2,
  UserRound,
} from 'lucide-react'
import { addSongToPlaylist, fetchRelatedVideos } from '../../api'
import { resizedImageUrl } from '../../lib/image'
import { toast } from '../../lib/toast'
import { useUserStore } from '../../store/user'
import { useLocalLibraryStore } from '../../store/localLibrary'
import { usePlayerStore } from '../../store/player'
import type { LocalPlaylist } from '../../api/local'
import { cn } from '../../lib/format'
import type { Playlist, Song } from '../../types'

interface SongContextMenuProps {
  song: Song
  liked: boolean
  x: number
  y: number
  onClose: () => void
  /** Only supplied on an editable playlist page. */
  onRemoveFromPlaylist?: () => void | Promise<void>
  /** Optional palette tint used by the immersive player. */
  menuStyle?: CSSProperties
  /** The immersive player is dark even when the app theme is light. */
  dark?: boolean
}

type MenuMode = 'root' | 'playlists' | 'local-playlists'

/**
 * Lightweight macOS-style context menu for a song row. Rendering through a
 * portal keeps it above virtualized rows and scrolling containers.
 */
export function SongContextMenu({
  song,
  liked,
  x,
  y,
  onClose,
  onRemoveFromPlaylist,
  menuStyle,
  dark,
}: SongContextMenuProps) {
  const { i18n } = useLingui()
  const navigate = useNavigate()
  const menuRef = useRef<HTMLDivElement>(null)
  const [mode, setMode] = useState<MenuMode>('root')
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [localPlaylists, setLocalPlaylists] = useState<LocalPlaylist[]>([])
  const [loadingPlaylists, setLoadingPlaylists] = useState(false)
  const [busy, setBusy] = useState(false)

  // Hand focus back to whatever opened the menu once it closes.
  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    return () => {
      if (previous?.isConnected) previous.focus({ preventScroll: true })
    }
  }, [])

  // Keyboard users start on the first item of each (sub)menu.
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      menuRef.current
        ?.querySelector<HTMLElement>('button:not(:disabled)')
        ?.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [mode, loadingPlaylists])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        // Captured on window and stopped here, so the song page (which closes
        // on Escape from a document listener) stays open under the menu.
        event.preventDefault()
        event.stopPropagation()
        onClose()
        return
      }
      // Arrow keys move between items, like a native menu.
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
      const menu = menuRef.current
      if (!menu) return
      const items = Array.from(
        menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
      )
      if (!items.length) return
      event.preventDefault()
      const index = items.indexOf(document.activeElement as HTMLButtonElement)
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? items.length - 1
            : event.key === 'ArrowDown'
              ? (index + 1) % items.length
              : index <= 0
                ? items.length - 1
                : index - 1
      items[next]?.focus()
    }
    // The page scrolling closes the menu; scrolling the menu's own playlist
    // list must not (it used to close the menu before a playlist was picked).
    const onScroll = (event: Event) => {
      const target = event.target
      if (target instanceof Node && menuRef.current?.contains(target)) return
      onClose()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [onClose])

  const openRelatedVideos = async () => {
    if (busy) return
    setBusy(true)
    try {
      const videos = await fetchRelatedVideos(song, 8)
      const first = videos[0]
      if (!first) {
        toast.info(i18n._(msg`未找到相关视频`))
        return
      }
      onClose()
      if (first.kind === 'mv') {
        void navigate({ to: '/mv/$id', params: { id: String(first.id) } })
      } else {
        void navigate({
          to: '/video/$id',
          params: { id: String(first.id) },
          search: {
            kind: first.kind,
            title: first.title,
            cover: first.cover ?? '',
            artist: first.artist ?? '',
            duration: first.duration ?? 0,
          },
        })
      }
    } catch {
      toast.error(i18n._(msg`相关视频加载失败`))
    } finally {
      setBusy(false)
    }
  }

  const openPlaylistPicker = async () => {
    // Local playlists are always offered: they are the only target that keeps
    // working for delisted tracks, and "收藏热门歌曲" creates them regardless of
    // the login state.
    const local = useLocalLibraryStore.getState()
    await local.load()
    setLocalPlaylists(useLocalLibraryStore.getState().playlists)
    const user = useUserStore.getState()
    if (!user.isLogin) {
      setMode('local-playlists')
      return
    }
    setMode('playlists')
    setLoadingPlaylists(true)
    try {
      let choices = user.createdPlaylists
      if (!choices.length && user.profile?.userId) {
        await user.loadPlaylists(user.profile.userId)
        choices = useUserStore.getState().createdPlaylists
      }
      setPlaylists(
        choices.filter(
          (playlist) =>
            !playlist.isMyLike,
        ),
      )
    } catch {
      toast.error(i18n._(msg`歌单加载失败`))
    } finally {
      setLoadingPlaylists(false)
    }
  }

  const saveToLocalPlaylist = async (playlist: LocalPlaylist) => {
    if (busy) return
    // `/local/playlists/:id/songs` silently ignores duplicates and still
    // answers 200, so without this check the menu would report a save that
    // changed nothing.
    const current = useLocalLibraryStore
      .getState()
      .playlists.find((item) => item.id === playlist.id)
    if (current?.songs.some((item) => Number(item.id) === Number(song.id))) {
      toast.info(i18n._(msg`这首歌已在该歌单中`))
      onClose()
      return
    }
    setBusy(true)
    try {
      const saved = await useLocalLibraryStore
        .getState()
        .addSong(playlist.id, song)
      if (!saved) return
      toast.success(i18n._(msg`已收藏到「${playlist.name}」`))
      onClose()
    } finally {
      setBusy(false)
    }
  }

  const saveToPlaylist = async (playlist: Playlist) => {
    if (busy) return
    setBusy(true)
    try {
      const response = await addSongToPlaylist(playlist.id, song.id)
      const code = response.code ?? response.body?.code ?? response.status
      if (code !== 200) {
        // NetEase answers 502 「歌单内歌曲重复」 for a track that is already there.
        const duplicate = code === 502 || /重复/.test(response.body?.message ?? '')
        if (duplicate) toast.info(i18n._(msg`这首歌已在该歌单中`))
        else toast.error(i18n._(msg`收藏失败`))
        return
      }
      toast.success(
        i18n._(msg`已收藏到「${playlist.name}」`),
      )
      onClose()
    } catch {
      toast.error(i18n._(msg`收藏失败`))
    } finally {
      setBusy(false)
    }
  }

  const queueAsNext = async () => {
    if (busy) return
    setBusy(true)
    try {
      const queued = await usePlayerStore.getState().playNext(song)
      if (queued) {
        toast.success(i18n._(msg`已设为下一首播放`))
      } else {
        toast.info(i18n._(msg`这首歌正在播放`))
      }
      onClose()
    } finally {
      setBusy(false)
    }
  }

  const toggleLike = async () => {
    const user = useUserStore.getState()
    if (!user.isLogin) {
      await useLocalLibraryStore.getState().toggleFavorite(song)
      onClose()
      return
    }
    const next = await user.likeSong(song.id, !liked)
    if (next === !liked) onClose()
  }

  const openArtist = (artistId: number) => {
    onClose()
    void navigate({
      to: '/artist/$id',
      params: { id: String(artistId) },
    })
  }

  const openAlbum = (albumId: number) => {
    onClose()
    void navigate({
      to: '/albums/$id',
      params: { id: String(albumId) },
    })
  }

  const removeFromPlaylist = async () => {
    if (!onRemoveFromPlaylist || busy) return
    setBusy(true)
    try {
      await onRemoveFromPlaylist()
      toast.success(i18n._(msg`已从歌单移除`))
      onClose()
    } catch {
      toast.error(i18n._(msg`移除失败`))
    } finally {
      setBusy(false)
    }
  }

  const artists = (song.ar ?? []).filter((artist) => artist.id)
  const hasAlbum = Boolean(song.al.id)
  const inPlaylistMode = mode === 'playlists' || mode === 'local-playlists'
  const menuWidth = inPlaylistMode ? 240 : 220

  // Open at the pointer, then keep the measured menu inside the window. The
  // old height was estimated from item counts and drifted off-screen.
  const [position, setPosition] = useState({ left: x, top: y })
  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu) return
    const rect = menu.getBoundingClientRect()
    setPosition({
      left: Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)),
    })
  }, [x, y, mode, loadingPlaylists, playlists.length, localPlaylists.length])

  const icon = (node: ReactNode) => (
    <span className="menu-item__icon" aria-hidden="true">
      {node}
    </span>
  )

  const backHeader = (title: ReactNode) => (
    <>
      <div className="menu-header">
        <button
          type="button"
          onClick={() => setMode('root')}
          aria-label={i18n._(msg`返回`)}
          className="menu-back"
        >
          <ChevronLeft />
        </button>
        <span className="truncate">{title}</span>
      </div>
      <div className="menu-separator" role="separator" />
    </>
  )

  return createPortal(
    <div className={dark ? 'dark' : undefined}>
      <div
        ref={menuRef}
        role="menu"
        aria-label={i18n._(msg`歌曲操作`)}
        className={cn(
          'song-context-menu menu-list fixed z-[1000] max-h-[calc(100vh-16px)] overflow-y-auto p-1 [scrollbar-width:none]',
          // On the song page: the same tinted dark surface as the player's
          // "more" menu, instead of a grey sheet with its own border.
          dark
            ? 'menu-surface'
            : 'rounded-[14px] border border-black/10 bg-white/90 shadow-[0_14px_40px_rgba(0,0,0,0.22)] backdrop-blur-2xl',
        )}
        style={{ ...position, width: menuWidth, ...menuStyle }}
        onContextMenu={(event) => event.preventDefault()}
      >
        {mode === 'root' ? (
          <>
            {/* Play, then keep, then go somewhere, then destructive. */}
            <button
              type="button"
              role="menuitem"
              disabled={busy}
              onClick={() => void queueAsNext()}
              className="menu-item"
            >
              {icon(<ListStart />)}
              <span className="menu-item__label">
                <Trans>下一首播放</Trans>
              </span>
            </button>
            <button
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              onClick={() => void openPlaylistPicker()}
              className="menu-item"
            >
              {icon(<ListPlus />)}
              <span className="menu-item__label">
                <Trans>收藏到歌单</Trans>
              </span>
              <span className="menu-item__meta" aria-hidden="true">
                <ChevronRight />
              </span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => void toggleLike()}
              className="menu-item"
            >
              <span
                className={cn('menu-item__icon', liked && 'text-love')}
                aria-hidden="true"
              >
                <Heart className={liked ? 'fill-current' : undefined} />
              </span>
              <span className="menu-item__label">
                {liked ? <Trans>取消喜欢</Trans> : <Trans>喜欢</Trans>}
              </span>
            </button>

            <div className="menu-separator" role="separator" />
            {artists.map((artist) => (
              <button
                key={artist.id}
                type="button"
                role="menuitem"
                onClick={() => openArtist(Number(artist.id))}
                title={artist.name}
                className="menu-item"
              >
                {icon(<UserRound />)}
                <span className="menu-item__label">
                  <Trans>查看歌手：{artist.name}</Trans>
                </span>
              </button>
            ))}
            {hasAlbum ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => openAlbum(Number(song.al.id))}
                title={song.al.name}
                className="menu-item"
              >
                {icon(<Disc3 />)}
                <span className="menu-item__label">
                  <Trans>查看专辑：{song.al.name}</Trans>
                </span>
              </button>
            ) : null}
            <button
              type="button"
              role="menuitem"
              disabled={busy}
              onClick={() => void openRelatedVideos()}
              className="menu-item"
            >
              {icon(busy ? <Loader2 className="animate-spin" /> : <Film />)}
              <span className="menu-item__label">
                <Trans>相关视频</Trans>
              </span>
            </button>

            {onRemoveFromPlaylist ? (
              <>
                <div className="menu-separator" role="separator" />
                <button
                  type="button"
                  role="menuitem"
                  disabled={busy}
                  onClick={() => void removeFromPlaylist()}
                  className="menu-item menu-item--danger"
                >
                  {icon(<Trash2 />)}
                  <span className="menu-item__label">
                    <Trans>从歌单移除</Trans>
                  </span>
                </button>
              </>
            ) : null}
          </>
        ) : mode === 'local-playlists' ? (
          <>
            {backHeader(<Trans>收藏到本地歌单</Trans>)}
            <div className="max-h-[260px] overflow-y-auto">
              {localPlaylists.length ? (
                localPlaylists.map((playlist) => (
                  <button
                    key={playlist.id}
                    type="button"
                    role="menuitem"
                    disabled={busy}
                    onClick={() => void saveToLocalPlaylist(playlist)}
                    className="menu-item"
                  >
                    {icon(<ListMusic />)}
                    <span className="menu-item__label">{playlist.name}</span>
                    <span className="menu-item__meta">{playlist.songs.length}</span>
                  </button>
                ))
              ) : (
                <p className="menu-empty">
                  <Trans>暂无本地歌单，请先在侧栏创建</Trans>
                </p>
              )}
            </div>
          </>
        ) : (
          <>
            {backHeader(<Trans>收藏到歌单</Trans>)}
            <div className="max-h-[260px] overflow-y-auto">
              {loadingPlaylists ? (
                <div className="menu-empty flex justify-center">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              ) : (
                <>
                  {playlists.map((playlist) => (
                    <button
                      key={playlist.id}
                      type="button"
                      role="menuitem"
                      disabled={busy}
                      onClick={() => void saveToPlaylist(playlist)}
                      className="menu-item"
                    >
                      <img
                        src={
                          resizedImageUrl(playlist.coverImgUrl, '100y100') ??
                          undefined
                        }
                        alt=""
                        className="menu-item__cover"
                      />
                      <span className="menu-item__label">{playlist.name}</span>
                    </button>
                  ))}

                  {/* Account playlists cannot hold a delisted track; local
                      ones can, and they are also where 收藏热门歌曲 writes. */}
                  {localPlaylists.length ? (
                    <>
                      <div className="menu-separator" role="separator" />
                      <p className="px-3 py-1 text-[11px] text-ink-4">
                        <Trans>本地歌单</Trans>
                      </p>
                      {localPlaylists.map((playlist) => (
                        <button
                          key={playlist.id}
                          type="button"
                          role="menuitem"
                          disabled={busy}
                          onClick={() => void saveToLocalPlaylist(playlist)}
                          className="menu-item"
                        >
                          {icon(<ListMusic />)}
                          <span className="menu-item__label">
                            {playlist.name}
                          </span>
                          <span className="menu-item__meta">
                            {playlist.songs.length}
                          </span>
                        </button>
                      ))}
                    </>
                  ) : null}

                  {!playlists.length && !localPlaylists.length ? (
                    <p className="menu-empty">
                      <Trans>暂无可用歌单</Trans>
                    </p>
                  ) : null}
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
