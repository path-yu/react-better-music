import { useEffect, useMemo, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { Trans } from '@lingui/react/macro'
import { CalendarHeart, Play, Shuffle } from 'lucide-react'
import { Button, Skeleton } from '@pikoloo/darwin-ui'
import { SongTable } from '../components/songs/SongTable'
import { EmptyState } from '../components/common/EmptyState'
import { fetchAllDailyRecommendSongs } from '../api'
import { usePlayerStore } from '../store/player'
import { useUserStore } from '../store/user'
import { useDailyRefreshKey } from '../lib/daily'
import { resizedImageUrl } from '../lib/image'
import { useDocumentTitle } from '../lib/title'
import type { Song } from '../types'

export const Route = createFileRoute('/daily')({
  component: DailyPage,
})

function shuffleSongs(songs: Song[]) {
  const next = [...songs]
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1))
    ;[next[index], next[swap]] = [next[swap], next[index]]
  }
  return next
}

function DailyPage() {
  const { i18n } = useLingui()
  useDocumentTitle(i18n._(msg`每日推荐`))
  const isLogin = useUserStore((state) => state.isLogin)
  const initQueue = usePlayerStore((state) => state.initQueue)
  const [songs, setSongs] = useState<Song[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const refreshKey = useDailyRefreshKey()
  const songsRef = useRef(songs)
  songsRef.current = songs

  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    setNow(new Date())
  }, [refreshKey])

  const dateKey = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`
  const month = now.getMonth() + 1
  const day = now.getDate()
  const weekday = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.locale, { weekday: 'long' }).format(now),
    [i18n.locale, now],
  )
  const cover = songs[0]?.al.picUrl
  const dailyCover = resizedImageUrl(cover, '640y640') ?? cover
  const blurb = isLogin
    ? i18n._(msg`根据你的音乐口味生成，每天 6:00 更新`)
    : i18n._(msg`大家都在听的好歌，登录后为你专属生成`)

  useEffect(() => {
    let cancelled = false
    const firstLoad = songsRef.current.length === 0
    // A 06:00 refresh should update the list in place instead of flashing the
    // page skeleton over songs that are already on screen.
    if (firstLoad) setLoading(true)
    setFailed(false)
    fetchAllDailyRecommendSongs()
      .then((list) => {
        if (!cancelled) setSongs(list)
      })
      .catch(() => {
        if (!cancelled && firstLoad) setFailed(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [attempt, refreshKey])

  const playAll = () => {
    if (!songs.length) return
    void initQueue(songs, 0, `daily-${dateKey}`)
  }

  const playShuffled = () => {
    if (!songs.length) return
    void initQueue(shuffleSongs(songs), 0, `daily-${dateKey}-shuffle`)
  }

  if (loading) {
    return (
      <div className="px-8 pb-16 pt-7">
        <div className="flex flex-wrap items-end gap-6 border-b border-[var(--app-border)] pb-6">
          <Skeleton className="h-[208px] w-[208px] rounded-[18px]" />
          <div className="flex-1">
            <Skeleton className="h-3 w-20 rounded-full" />
            <Skeleton className="mt-3 h-8 w-[260px] rounded-full" />
            <Skeleton className="mt-3 h-3 w-[300px] rounded-full" />
            <Skeleton className="mt-5 h-9 w-[220px] rounded-full" />
          </div>
        </div>
        <div className="mt-6 space-y-2">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-12 w-full rounded-[10px]" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="px-8 pb-16 pt-7">
      <div className="flex flex-wrap items-end gap-6 border-b border-[var(--app-border)] pb-6">
        <div className="relative h-[208px] w-[208px] shrink-0 overflow-hidden rounded-[18px] bg-[#3a3a40] artwork-shadow">
          {dailyCover ? (
            <img
              src={dailyCover}
              alt=""
              aria-hidden="true"
              className="absolute inset-0 h-full w-full scale-110 object-cover blur-[2px]"
            />
          ) : null}
          <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-transparent" />
          <div className="absolute bottom-4 left-4 text-white">
            <span className="block text-[84px] font-light leading-[0.9] tracking-[-0.06em] tabular-nums">
              {day}
            </span>
            <span className="mt-1 block text-[12px] font-semibold text-white/85">
              {month}月 · {weekday}
            </span>
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[12px] font-semibold text-accent">
            <CalendarHeart className="h-3.5 w-3.5" />
            <Trans>每日推荐</Trans>
          </p>
          <h1 className="headline-lg mt-1.5">
            <Trans>每日歌曲推荐</Trans>
          </h1>
          <p className="mt-2 text-[12px] leading-relaxed text-black/40">
            <Trans>{songs.length} 首</Trans>
            <span className="mx-1.5 text-black/20">·</span>
            {blurb}
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              className="pressable rounded-full px-4 text-[12.5px]"
              onClick={playAll}
              disabled={!songs.length}
            >
              <Play className="mr-1.5 h-3.5 w-3.5 fill-current" />
              <Trans>播放全部</Trans>
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="pressable rounded-full px-4 text-[12.5px]"
              onClick={playShuffled}
              disabled={!songs.length}
            >
              <Shuffle className="mr-1.5 h-3.5 w-3.5" />
              <Trans>随机播放</Trans>
            </Button>
          </div>
        </div>
      </div>

      <div className="mt-3">
        {failed ? (
          <EmptyState
            title={i18n._(msg`每日推荐加载失败`)}
            action={
              <Button
                variant="secondary"
                size="sm"
                className="rounded-full"
                onClick={() => setAttempt((value) => value + 1)}
              >
                <Trans>重新加载</Trans>
              </Button>
            }
          />
        ) : (
          <SongTable
            songs={songs}
            playlistId={`daily-${dateKey}`}
            emptyText={i18n._(msg`今日暂无推荐歌曲`)}
          />
        )}
      </div>
    </div>
  )
}
