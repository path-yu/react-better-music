import { useState } from 'react'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { Trans } from '@lingui/react/macro'
import { ListMusic, Loader2 } from 'lucide-react'
import { Button, Popover, PopoverTrigger } from '@pikoloo/darwin-ui'
import { addSongsToPlaylist } from '../../api'
import { useUserStore } from '../../store/user'
import { useLocalLibraryStore } from '../../store/localLibrary'
import { PlayerMenuContent } from '../player/PlayerMenuContent'
import { cn } from '../../lib/format'
import { toast } from '../../lib/toast'
import type { Song } from '../../types'

interface PlaylistChoice {
  key: string
  id: number | string
  name: string
  local: boolean
}

/**
 * Multi-select counterpart of `PlaylistPicker`: adds every selected track to
 * one playlist, locally (guest / local library) or through one batch
 * `/playlist/tracks` call for the account.
 */
export function AddSelectedToPlaylist({
  songs,
  onDone,
}: {
  songs: Song[]
  /** Called after a successful save, so the caller can clear the selection. */
  onDone?: () => void
}) {
  const { i18n } = useLingui()
  const isLogin = useUserStore((state) => state.isLogin)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [choices, setChoices] = useState<PlaylistChoice[]>([])

  const loadChoices = async () => {
    setLoading(true)
    try {
      // Local playlists are always a valid target: they are the only ones that
      // can keep delisted tracks.
      const local = useLocalLibraryStore.getState()
      await local.load()
      const localChoices: PlaylistChoice[] = useLocalLibraryStore
        .getState()
        .playlists.map((playlist) => ({
          key: `local-${playlist.id}`,
          id: playlist.id,
          name: playlist.name,
          local: true,
        }))

      const user = useUserStore.getState()
      if (!user.isLogin) {
        setChoices(localChoices)
        return
      }

      let accountPlaylists = user.createdPlaylists.filter(
        (playlist) => !playlist.isMyLike,
      )
      if (!accountPlaylists.length && user.profile?.userId) {
        await user.loadPlaylists(user.profile.userId)
        accountPlaylists = useUserStore
          .getState()
          .createdPlaylists.filter((playlist) => !playlist.isMyLike)
      }
      setChoices([
        ...accountPlaylists.map((playlist) => ({
          key: `account-${playlist.id}`,
          id: playlist.id,
          name: playlist.name,
          local: false,
        })),
        ...localChoices,
      ])
    } catch {
      toast.warning(i18n._(msg`歌单加载失败`))
    } finally {
      setLoading(false)
    }
  }

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) void loadChoices()
  }

  const save = async (choice: PlaylistChoice) => {
    if (busy || !songs.length) return
    setBusy(true)
    try {
      if (choice.local) {
        const store = useLocalLibraryStore.getState()
        const playlist = store.playlists.find(
          (item) => item.id === String(choice.id),
        )
        const existing = new Set(
          (playlist?.songs ?? []).map((song) => song.id),
        )
        let added = 0
        for (const song of songs) {
          if (existing.has(song.id)) continue
          const ok = await store.addSong(String(choice.id), song)
          if (ok) {
            existing.add(song.id)
            added += 1
          }
        }
        if (!added) {
          toast.info(i18n._(msg`这些歌曲都已在该歌单中`))
          return
        }
        toast.success(
          i18n._(msg`已收藏 ${added} 首到「${choice.name}」`),
        )
      } else {
        const response = await addSongsToPlaylist(
          choice.id,
          songs.map((song) => song.id),
        )
        const code = response.code ?? response.body?.code ?? response.status
        if (code !== 200) {
          // NetEase answers 502 「歌单内歌曲重复」 when nothing was added.
          const duplicate =
            code === 502 || /重复/.test(response.body?.message ?? '')
          if (duplicate) toast.info(i18n._(msg`这些歌曲都已在该歌单中`))
          else toast.error(i18n._(msg`收藏失败`))
          return
        }
        toast.success(
          i18n._(msg`已收藏 ${songs.length} 首到「${choice.name}」`),
        )
      }
      onDone?.()
      setOpen(false)
    } catch {
      toast.error(i18n._(msg`收藏失败`))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="primary"
          size="sm"
          className="pressable rounded-full px-3 text-[11px]"
          disabled={busy}
        >
          {busy ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : null}
          <Trans>收藏到歌单</Trans>
        </Button>
      </PopoverTrigger>
      <PlayerMenuContent
        immersive={false}
        align="end"
        className="w-[min(240px,calc(100vw-24px))]"
      >
        <p className="px-2 py-1 text-[11px] text-ink-4">
          <Trans>收藏 {songs.length} 首到歌单</Trans>
        </p>
        <div className="max-h-[280px] overflow-y-auto rounded-[10px] bg-black/4 p-0.5">
          {loading ? (
            <div className="flex items-center justify-center py-5">
              <Loader2 className="h-4 w-4 animate-spin text-ink-4" />
            </div>
          ) : choices.length ? (
            choices.map((choice) => (
              <button
                key={choice.key}
                type="button"
                disabled={busy}
                onClick={(event) => {
                  event.stopPropagation()
                  void save(choice)
                }}
                className={cn(
                  'flex h-9 w-full items-center gap-2 rounded-[6px] px-2 text-left text-[12px] text-ink-2 transition-colors hover:bg-black/5 disabled:opacity-50',
                )}
              >
                <ListMusic className="h-3.5 w-3.5 shrink-0 text-ink-4" />
                <span className="min-w-0 flex-1 truncate">{choice.name}</span>
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              </button>
            ))
          ) : (
            <p className="px-2 py-4 text-center text-[11px] text-ink-4">
              {isLogin ? (
                <Trans>暂无可用歌单</Trans>
              ) : (
                <Trans>暂无本地歌单，请先在侧栏创建</Trans>
              )}
            </p>
          )}
        </div>
      </PlayerMenuContent>
    </Popover>
  )
}
