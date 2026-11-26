import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { Trans } from '@lingui/react/macro'
import { ArrowLeft, Check, ListMusic, Pencil, Trash2, X } from 'lucide-react'
import {
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@pikoloo/darwin-ui'
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
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [dontAskDelete, setDontAskDelete] = useState(false)
  const [skipDeleteConfirm, setSkipDeleteConfirm] = useState(
    () => localStorage.getItem('react-music-skip-local-playlist-delete-confirm') === '1',
  )
  const playlistId = playlist?.id
  const playlistName = playlist?.name

  useDocumentTitle(playlistName ?? i18n._(msg`本地歌单`))

  useEffect(() => {
    if (playlistName) setName(playlistName)
  }, [playlistId, playlistName])

  if (!playlist) {
    return (
      <div className="page">
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
          <div className="py-16 text-center text-[12px] text-ink-4">
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
    const shouldSkip = dontAskDelete
    if (await removePlaylist(playlist.id)) {
      if (shouldSkip) {
        localStorage.setItem(
          'react-music-skip-local-playlist-delete-confirm',
          '1',
        )
        setSkipDeleteConfirm(true)
      }
      setDeleteOpen(false)
      void navigate({ to: '/local/favorites' })
    }
  }

  const requestDelete = () => {
    if (skipDeleteConfirm) {
      void deletePlaylist()
      return
    }
    setDontAskDelete(false)
    setDeleteOpen(true)
  }

  return (
    <div className="page">
      <button
        type="button"
        onClick={() => {
          // The playlist is reachable from home, search and the sidebar, so go
          // back where the user came from. Only a direct link (no app history)
          // falls back to the local library page.
          if (window.history.length > 1) window.history.back()
          else void navigate({ to: '/local/favorites' })
        }}
        className="mb-3 flex items-center gap-1 text-[11px] text-ink-4 hover:text-ink-2"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        <Trans>返回</Trans>
      </button>

      <div className="page-header">
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
                className="headline-lg h-9 w-[min(360px,60vw)] rounded-[10px] border border-black/10 bg-white/70 px-2 outline-none focus:border-accent/50"
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
                className="pressable flex h-7 w-7 items-center justify-center rounded-full text-ink-4 hover:bg-black/5"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <h1 className="headline-lg flex min-w-0 items-center gap-2">
              <span className="truncate">{playlist.name}</span>
              <button
                type="button"
                onClick={() => setEditing(true)}
                aria-label={i18n._(msg`重命名歌单`)}
                className="pressable flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink-4 hover:bg-black/5 hover:text-ink-2"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </h1>
          )}
          <p className="page-subtitle">
            <Trans>本地歌单 · {playlist.songs.length} 首</Trans>
          </p>
        </div>
        <div className="page-header__actions">
          <PlayAllButton songs={playlist.songs} playlistId={`local-${playlist.id}`} />
          <button
            type="button"
            onClick={requestDelete}
            aria-label={i18n._(msg`删除歌单`)}
            title={i18n._(msg`删除歌单`)}
            className="pressable flex h-8 w-8 items-center justify-center rounded-full border border-black/8 text-ink-4 hover:border-love/30 hover:text-love"
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
          onRemoveFromPlaylist={async (song) => {
            const removed = await removeSong(playlist.id, song.id)
            if (!removed) throw new Error('remove failed')
          }}
        />
      </div>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent size="sm" glass>
          <DialogHeader>
            <DialogTitle>
              <Trans>删除歌单</Trans>
            </DialogTitle>
            <DialogDescription>
              <Trans>确定删除这个本地歌单吗？此操作无法撤销。</Trans>
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Checkbox
              checked={dontAskDelete}
              onChange={setDontAskDelete}
              label={i18n._(msg`不再提示`)}
            />
          </DialogBody>
          <DialogFooter>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setDeleteOpen(false)}
            >
              <Trans>取消</Trans>
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => void deletePlaylist()}
            >
              <Trans>删除</Trans>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
