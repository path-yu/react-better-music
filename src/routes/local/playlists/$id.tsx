import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { Trans } from '@lingui/react/macro'
import { ArrowLeft, Check, ListMusic, Pencil, Trash2, X } from 'lucide-react'
import { SongTable } from '../../../components/songs/SongTable'
import { PlayAllButton } from '../../../components/songs/PlayAllButton'
import { EmptyState } from '../../../components/common/EmptyState'
import { useLocalLibraryStore } from '../../../store/localLibrary'
import { useDocumentTitle } from '../../../lib/title'

export const Route = createFileRoute('/local/playlists/$id')({
  component: LocalPlaylistPage,
})

function LocalPlaylistPage() {
  const { i18n } = useLingui()
  const navigate = useNavigate()
  const { id } = Route.useParams()
  const playlist = useLocalLibraryStore((state) =>
    state.playlists.find((item) => item.id === id),
  )
  const loaded = useLocalLibraryStore((state) => state.loaded)
  const renamePlaylist = useLocalLibraryStore((state) => state.renamePlaylist)
  const removePlaylist = useLocalLibraryStore((state) => state.removePlaylist)
  const removeSong = useLocalLibraryStore((state) => state.removeSong)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const playlistId = playlist?.id
  const playlistName = playlist?.name

  useDocumentTitle(playlistName ?? i18n._(msg`本地歌单`))

  useEffect(() => {
    if (playlistName) setName(playlistName)
  }, [playlistId, playlistName])

  if (!playlist) {
    return (
      <div className="px-8 pb-14 pt-6">
        {loaded ? (
          <EmptyState
            icon={<ListMusic className="h-6 w-6" />}
            title={i18n._(msg`本地歌单不存在`)}
            description={i18n._(msg`它可能已被删除，或保存在另一个安装目录。`)}
            action={
              <button
                type="button"
                onClick={() => void navigate({ to: '/local/favorites' })}
                className="pressable rounded-full bg-accent px-4 py-1.5 text-[12px] text-white"
              >
                <Trans>返回本地收藏</Trans>
              </button>
            }
          />
        ) : (
          <div className="py-16 text-center text-[12px] text-black/35">
            <Trans>正在读取本地歌单…</Trans>
          </div>
        )}
      </div>
    )
  }

  const saveName = async () => {
    const next = name.trim()
    if (!next || next === playlist.name) {
      setEditing(false)
      setName(playlist.name)
      return
    }
    if (await renamePlaylist(playlist.id, next)) setEditing(false)
  }

  const deletePlaylist = async () => {
    if (!window.confirm(i18n._(msg`确定删除这个本地歌单吗？`))) return
    if (await removePlaylist(playlist.id)) {
      void navigate({ to: '/local/favorites' })
    }
  }

  return (
    <div className="px-8 pb-14 pt-6">
      <button
        type="button"
        onClick={() => void navigate({ to: '/local/favorites' })}
        className="mb-3 flex items-center gap-1 text-[11px] text-black/35 hover:text-black/65"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        <Trans>本地收藏</Trans>
      </button>

      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          {editing ? (
            <div className="flex items-center gap-1.5">
              <input
                autoFocus
                value={name}
                maxLength={60}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void saveName()
                  if (event.key === 'Escape') {
                    setEditing(false)
                    setName(playlist.name)
                  }
                }}
                className="headline-lg h-9 w-[min(360px,60vw)] rounded-[8px] border border-black/10 bg-white/70 px-2 outline-none focus:border-accent/50"
              />
              <button
                type="button"
                onClick={() => void saveName()}
                aria-label={i18n._(msg`保存名称`)}
                className="pressable flex h-7 w-7 items-center justify-center rounded-full text-accent hover:bg-accent/10"
              >
                <Check className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(false)
                  setName(playlist.name)
                }}
                aria-label={i18n._(msg`取消`)}
                className="pressable flex h-7 w-7 items-center justify-center rounded-full text-black/35 hover:bg-black/5"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <h1 className="headline-lg flex min-w-0 items-center gap-2">
              <ListMusic className="h-5 w-5 shrink-0 text-accent" />
              <span className="truncate">{playlist.name}</span>
              <button
                type="button"
                onClick={() => setEditing(true)}
                aria-label={i18n._(msg`重命名歌单`)}
                className="pressable flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-black/25 hover:bg-black/5 hover:text-black/60"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </h1>
          )}
          <p className="mt-1.5 text-[12px] text-black/35">
            <Trans>本地歌单 · {playlist.songs.length} 首</Trans>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <PlayAllButton songs={playlist.songs} playlistId={`local-${playlist.id}`} />
          <button
            type="button"
            onClick={() => void deletePlaylist()}
            aria-label={i18n._(msg`删除歌单`)}
            title={i18n._(msg`删除歌单`)}
            className="pressable flex h-8 w-8 items-center justify-center rounded-full border border-black/8 text-black/35 hover:border-[#ff2d55]/30 hover:text-[#ff2d55]"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mt-5">
        <SongTable
          songs={playlist.songs}
          playlistId={`local-${playlist.id}`}
          emptyText={i18n._(msg`这个歌单还没有歌曲`)}
          onRemoveSong={(song) => void removeSong(playlist.id, song.id)}
        />
      </div>
    </div>
  )
}
