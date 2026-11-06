import { useState } from 'react'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { Trans } from '@lingui/react/macro'
import { ListMusic, ListPlus, Loader2 } from 'lucide-react'
import { Popover, PopoverTrigger } from '@pikoloo/darwin-ui'
import { addSongToPlaylist } from '../../api'
import { usePlayerStore } from '../../store/player'
import { useUserStore } from '../../store/user'
import { useLocalLibraryStore } from '../../store/localLibrary'
import { PlayerMenuContent } from './PlayerMenuContent'
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
 * Add the current track to an account playlist when signed in, or to a local
 * playlist on desktop guest mode. Kept next to the like button for both paths.
 */
export function PlaylistPicker({
  song,
  tint,
}: {
  song: Song
  tint?: string
}) {
  const { i18n } = useLingui()
  const immersive = usePlayerStore((state) => state.showNowPlaying)
  const isLogin = useUserStore((state) => state.isLogin)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [choices, setChoices] = useState<PlaylistChoice[]>([])

  const loadChoices = async () => {
    setLoading(true)
    try {
      const user = useUserStore.getState()
      if (user.isLogin) {
        let accountPlaylists = user.createdPlaylists.filter(
          (playlist) =>
            !playlist.isMyLike && playlist.name !== '我喜欢的音乐',
        )
        if (!accountPlaylists.length && user.profile?.userId) {
          await user.loadPlaylists(user.profile.userId)
          accountPlaylists = useUserStore
            .getState()
            .createdPlaylists.filter(
              (playlist) =>
                !playlist.isMyLike && playlist.name !== '我喜欢的音乐',
            )
        }
        setChoices(
          accountPlaylists.map((playlist) => ({
            key: `account-${playlist.id}`,
            id: playlist.id,
            name: playlist.name,
            local: false,
          })),
        )
        return
      }

      const local = useLocalLibraryStore.getState()
      await local.load()
      setChoices(
        useLocalLibraryStore.getState().playlists.map((playlist) => ({
          key: `local-${playlist.id}`,
          id: playlist.id,
          name: playlist.name,
          local: true,
        })),
      )
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
    if (busy) return
    setBusy(true)
    try {
      if (choice.local) {
        const saved = await useLocalLibraryStore
          .getState()
          .addSong(String(choice.id), song)
        if (!saved) return
      } else {
        const response = await addSongToPlaylist(choice.id, song.id)
        const code = response.code ?? response.body?.code ?? response.status
        if (code !== 200) {
          toast.error(i18n._(msg`收藏失败`))
          return
        }
      }
      toast.success(i18n._(msg`已收藏到「${choice.name}」`))
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
        <button
          type="button"
          aria-label={i18n._(msg`收藏到歌单`)}
          title={i18n._(msg`收藏到歌单`)}
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          className="pressable shrink-0 max-md:hidden"
        >
          <ListPlus
            className={
              immersive
                ? 'h-4 w-4 text-white/40 transition-colors hover:text-white/80'
                : 'h-4 w-4 text-black/30 transition-colors hover:text-black/60'
            }
          />
        </button>
      </PopoverTrigger>
      <PlayerMenuContent
        immersive={immersive}
        tint={tint}
        align="start"
        className="w-[min(240px,calc(100vw-24px))]"
      >
        <p
          className={cn(
            'px-2 py-1 text-[11px]',
            immersive ? 'text-white/45' : 'text-black/35',
          )}
        >
          <Trans>收藏到歌单</Trans>
        </p>
        <div
          className={cn(
            'max-h-[280px] overflow-y-auto rounded-[8px] p-0.5',
            immersive ? 'bg-white/5' : 'bg-black/4',
          )}
        >
          {loading ? (
            <div className="flex items-center justify-center py-5">
              <Loader2
                className={cn(
                  'h-4 w-4 animate-spin',
                  immersive ? 'text-white/40' : 'text-black/30',
                )}
              />
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
                  'flex h-9 w-full items-center gap-2 rounded-[6px] px-2 text-left text-[12px] transition-colors disabled:opacity-50',
                  immersive
                    ? 'text-white/70 hover:bg-white/8'
                    : 'text-black/65 hover:bg-black/5',
                )}
              >
                <ListMusic
                  className={cn(
                    'h-3.5 w-3.5 shrink-0',
                    immersive ? 'text-white/40' : 'text-black/35',
                  )}
                />
                <span className="min-w-0 flex-1 truncate">{choice.name}</span>
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              </button>
            ))
          ) : (
            <p
              className={cn(
                'px-2 py-4 text-center text-[11px]',
                immersive ? 'text-white/40' : 'text-black/35',
              )}
            >
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
