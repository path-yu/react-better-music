import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { Trans } from '@lingui/react/macro'
import { History, Loader2 } from 'lucide-react'
import { Button } from '@pikoloo/darwin-ui'
import { SongTable } from '../components/songs/SongTable'
import { PlayAllButton } from '../components/songs/PlayAllButton'
import { EmptyState } from '../components/common/EmptyState'
import { fetchRecentSongs } from '../api'
import { useUserStore } from '../store/user'
import { useUiStore } from '../store/ui'
import { useDocumentTitle } from '../lib/title'
import type { Song } from '../types'

export const Route = createFileRoute('/recent')({
  component: RecentSongsPage,
})

function RecentSongsPage() {
  const { i18n } = useLingui()
  useDocumentTitle(i18n._(msg`最近播放`))
  const isLogin = useUserStore((state) => state.isLogin)
  const openLogin = useUiStore((state) => state.openLogin)
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

  return (
    <div className="px-8 pb-14 pt-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="headline-lg flex items-center gap-2">
            <History className="h-5 w-5 text-accent" />
            <Trans>最近播放</Trans>
          </h1>
          <p className="mt-1.5 text-[12px] text-black/35">
            <Trans>最近听过的歌曲，最多显示 100 首</Trans>
          </p>
        </div>
        <PlayAllButton songs={songs} playlistId="recent-songs" />
      </div>

      <div className="mt-5">
        {!isLogin ? (
          <EmptyState
            icon={<History className="h-6 w-6" strokeWidth={2} />}
            title={i18n._(msg`登录后查看最近播放`)}
            description={i18n._(msg`登录网易云账号后，这里会同步最近听过的歌曲。`)}
            action={
              <Button
                size="sm"
                variant="primary"
                className="pressable rounded-full px-4"
                onClick={openLogin}
              >
                <Trans>登录</Trans>
              </Button>
            }
          />
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
