import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { Trans } from '@lingui/react/macro'
import { History, Loader2, Trash2 } from 'lucide-react'
import { SongTable } from '../components/songs/SongTable'
import { PlayAllButton } from '../components/songs/PlayAllButton'
import { EmptyState } from '../components/common/EmptyState'
import { fetchRecentSongs } from '../api'
import { useUserStore } from '../store/user'
import { useLocalLibraryStore } from '../store/localLibrary'
import { useDocumentTitle } from '../lib/title'
import type { Song } from '../types'

export const Route = createFileRoute('/recent')({
  component: RecentSongsPage,
})

function RecentSongsPage() {
  const { i18n } = useLingui()
  useDocumentTitle(i18n._(msg`最近播放`))
  const isLogin = useUserStore((state) => state.isLogin)
  const localRecent = useLocalLibraryStore((state) => state.recent)
  const removeRecent = useLocalLibraryStore((state) => state.removeRecent)
  const clearRecent = useLocalLibraryStore((state) => state.clearRecent)
  const [songs, setSongs] = useState<Song[]>([])
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!isLogin) {
      setSongs([])
      setLoading(false)
      setFailed(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setFailed(false)
    fetchRecentSongs(100)
      .then((list) => {
        if (!cancelled) setSongs(list)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [isLogin, attempt])

  const displaySongs = isLogin
    ? songs
    : localRecent.map((entry) => entry.song)

  return (
    <div className="px-8 pb-14 pt-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="headline-lg flex items-center gap-2">
            <History className="h-5 w-5 text-accent" />
            <Trans>最近播放</Trans>
          </h1>
          <p className="mt-1.5 text-[12px] text-black/35">
            {isLogin ? (
              <Trans>最近听过的歌曲，最多显示 100 首</Trans>
            ) : (
              <Trans>保存在本地曲库的最近播放，不需要登录</Trans>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PlayAllButton songs={displaySongs} playlistId="recent-songs" />
          {!isLogin && localRecent.length ? (
            <button
              type="button"
              onClick={() => void clearRecent()}
              aria-label={i18n._(msg`清空播放记录`)}
              title={i18n._(msg`清空播放记录`)}
              className="pressable flex h-8 w-8 items-center justify-center rounded-full border border-black/8 text-black/35 hover:border-[#ff2d55]/30 hover:text-[#ff2d55]"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-5">
        {!isLogin ? (
          displaySongs.length ? (
            <SongTable
              songs={displaySongs}
              playlistId="recent-songs"
              emptyText={i18n._(msg`还没有播放记录`)}
              onRemoveSong={(song) => void removeRecent(song.id)}
            />
          ) : (
            <EmptyState
              icon={<History className="h-6 w-6" strokeWidth={2} />}
              title={i18n._(msg`还没有播放记录`)}
              description={i18n._(msg`播放过的歌曲会自动记录在这里。`)}
            />
          )
        ) : failed ? (
          <EmptyState
            variant="error"
            title={i18n._(msg`最近播放加载失败`)}
            description={i18n._(msg`请检查账号登录状态或本地 API 服务后重试`)}
            onRetry={() => setAttempt((value) => value + 1)}
          />
        ) : loading && !songs.length ? (
          <div className="flex items-center justify-center gap-2 py-16 text-[12px] text-black/35">
            <Loader2 className="h-4 w-4 animate-spin text-accent" />
            <Trans>正在同步最近播放…</Trans>
          </div>
        ) : (
          <SongTable
            songs={songs}
            playlistId="recent-songs"
            loading={loading}
            emptyText={i18n._(msg`还没有播放记录`)}
          />
        )}
      </div>
    </div>
  )
}
