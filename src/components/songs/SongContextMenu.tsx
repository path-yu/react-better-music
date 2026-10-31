import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from '@tanstack/react-router'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { Trans } from '@lingui/react/macro'
import { ChevronLeft, Film, Heart, ListMusic, ListPlus, Loader2 } from 'lucide-react'
import { addSongToPlaylist, fetchRelatedVideos } from '../../api'
import { resizedImageUrl } from '../../lib/image'
import { toast } from '../../lib/toast'
import { useUserStore } from '../../store/user'
import { useLocalLibraryStore } from '../../store/localLibrary'
import type { LocalPlaylist } from '../../api/local'
import type { Playlist, Song } from '../../types'

interface SongContextMenuProps {
  song: Song
  liked: boolean
  x: number
  y: number
  onClose: () => void
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
}: SongContextMenuProps) {
  const { i18n } = useLingui()
  const navigate = useNavigate()
  const menuRef = useRef<HTMLDivElement>(null)
  const [mode, setMode] = useState<MenuMode>('root')
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [localPlaylists, setLocalPlaylists] = useState<LocalPlaylist[]>([])
  const [loadingPlaylists, setLoadingPlaylists] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    const onScroll = () => onClose()
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
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
    const user = useUserStore.getState()
    if (!user.isLogin) {
      // Desktop guest mode: offer the playlists stored in the local library.
      const local = useLocalLibraryStore.getState()
      await local.load()
      setLocalPlaylists(useLocalLibraryStore.getState().playlists)
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
            !playlist.isMyLike && playlist.name !== '我喜欢的音乐',
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
        toast.error(i18n._(msg`收藏失败`))
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

  const inPlaylistMode = mode === 'playlists' || mode === 'local-playlists'
  const menuWidth = inPlaylistMode ? 240 : 190
  const menuHeight = inPlaylistMode ? 320 : 220
  const left = Math.max(8, Math.min(x, window.innerWidth - menuWidth - 12))
  const top = Math.max(8, Math.min(y, window.innerHeight - menuHeight))

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={i18n._(msg`歌曲操作`)}
      className="song-context-menu fixed z-[1000] min-w-[190px] overflow-hidden rounded-[10px] border border-black/10 bg-white/90 p-1 text-[12px] shadow-[0_14px_40px_rgba(0,0,0,0.22)] backdrop-blur-2xl"
      style={{ left, top, width: menuWidth }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {mode === 'root' ? (
        <>
          <button
            type="button"
            role="menuitem"
            disabled={busy}
            onClick={() => void openRelatedVideos()}
            className="flex h-8 w-full items-center gap-2 rounded-[6px] px-2.5 text-left text-black/70 transition-colors hover:bg-black/6 disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
            ) : (
              <Film className="h-3.5 w-3.5 text-black/40" />
            )}
            <Trans>相关视频</Trans>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => void openPlaylistPicker()}
            className="flex h-8 w-full items-center gap-2 rounded-[6px] px-2.5 text-left text-black/70 transition-colors hover:bg-black/6"
          >
            <ListPlus className="h-3.5 w-3.5 text-black/40" />
            <Trans>收藏到歌单</Trans>
          </button>
          <div className="my-1 h-px bg-black/6" />
          <button
            type="button"
            role="menuitem"
            onClick={() => void toggleLike()}
            className="flex h-8 w-full items-center gap-2 rounded-[6px] px-2.5 text-left text-black/70 transition-colors hover:bg-black/6"
          >
            <Heart
              className={`h-3.5 w-3.5 ${
                liked ? 'fill-[#ff2d55] text-[#ff2d55]' : 'text-black/40'
              }`}
            />
            {liked ? <Trans>取消喜欢</Trans> : <Trans>喜欢</Trans>}
          </button>
        </>
      ) : mode === 'local-playlists' ? (
        <>
          <div className="flex h-8 items-center gap-1 px-1">
            <button
              type="button"
              onClick={() => setMode('root')}
              aria-label={i18n._(msg`返回`)}
              className="pressable flex h-6 w-6 items-center justify-center rounded-[5px] text-black/45 hover:bg-black/6"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="text-[11px] font-medium text-black/55">
              <Trans>收藏到本地歌单</Trans>
            </span>
          </div>
          <div className="my-1 h-px bg-black/6" />
          <div className="max-h-[260px] overflow-y-auto">
            {localPlaylists.length ? (
              localPlaylists.map((playlist) => (
                <button
                  key={playlist.id}
                  type="button"
                  role="menuitem"
                  disabled={busy}
                  onClick={() => void saveToLocalPlaylist(playlist)}
                  className="flex h-9 w-full items-center gap-2 rounded-[6px] px-2 text-left text-black/70 transition-colors hover:bg-black/6 disabled:opacity-50"
                >
                  <ListMusic className="h-3.5 w-3.5 text-black/35" />
                  <span className="min-w-0 flex-1 truncate">{playlist.name}</span>
                  <span className="text-[10px] text-black/25">
                    {playlist.songs.length}
                  </span>
                </button>
              ))
            ) : (
              <p className="px-2 py-4 text-center text-[11px] text-black/35">
                <Trans>暂无本地歌单，请先在侧栏创建</Trans>
              </p>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="flex h-8 items-center gap-1 px-1">
            <button
              type="button"
              onClick={() => setMode('root')}
              aria-label={i18n._(msg`返回`)}
              className="pressable flex h-6 w-6 items-center justify-center rounded-[5px] text-black/45 hover:bg-black/6"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="text-[11px] font-medium text-black/55">
              <Trans>收藏到歌单</Trans>
            </span>
          </div>
          <div className="my-1 h-px bg-black/6" />
          <div className="max-h-[260px] overflow-y-auto">
            {loadingPlaylists ? (
              <div className="flex items-center justify-center py-5">
                <Loader2 className="h-4 w-4 animate-spin text-black/30" />
              </div>
            ) : playlists.length ? (
              playlists.map((playlist) => (
                <button
                  key={playlist.id}
                  type="button"
                  role="menuitem"
                  disabled={busy}
                  onClick={() => void saveToPlaylist(playlist)}
                  className="flex h-9 w-full items-center gap-2 rounded-[6px] px-2 text-left text-black/70 transition-colors hover:bg-black/6 disabled:opacity-50"
                >
                  <img
                    src={resizedImageUrl(playlist.coverImgUrl, '100y100') ?? undefined}
                    alt=""
                    className="h-6 w-6 shrink-0 rounded-[4px] object-cover"
                  />
                  <span className="truncate">{playlist.name}</span>
                </button>
              ))
            ) : (
              <p className="px-2 py-4 text-center text-[11px] text-black/35">
                <Trans>暂无可用歌单</Trans>
              </p>
            )}
          </div>
        </>
      )}
    </div>,
    document.body,
  )
}
