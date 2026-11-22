import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { Trans } from '@lingui/react/macro'
import { ChevronRight, Play } from 'lucide-react'
import { Button, Skeleton } from '@pikoloo/darwin-ui'
import { PlaylistCard } from '../components/cards/PlaylistCard'
import { ImageWithFallback } from '../components/common/ImageWithFallback'
import { EmptyState } from '../components/common/EmptyState'
import {
  fetchAllDailyRecommendSongs,
  fetchDailyRecommendPlaylists,
  fetchPersonalized,
  fetchTopPlaylists,
  fetchToplists,
} from '../api'
import { usePlayerStore } from '../store/player'
import { useUserStore } from '../store/user'
import {
  FALLBACK_PALETTE,
  extractPalette,
  withAlpha,
  type Palette,
} from '../lib/color'
import { useDailyRefreshKey } from '../lib/daily'
import { resizedImageUrl } from '../lib/image'
import { formatArtists, formatFrequency } from '../lib/format'
import { useDocumentTitle } from '../lib/title'
import type { Playlist, Song, Toplist } from '../types'

import { PageHeader } from '../components/common/PageHeader'
export const Route = createFileRoute('/')({
  component: DiscoveryPage,
})

function useSection<T>(load: () => Promise<T>, initial: T, refreshKey = 0) {
  const [data, setData] = useState<T>(initial)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const loadedRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    // Revalidation (e.g. the 06:00 daily refresh) keeps the existing section
    // visible and only shows a skeleton for the first successful load.
    setLoading(!loadedRef.current)
    setFailed(false)
    load()
      .then((value) => {
        if (cancelled) return
        loadedRef.current = true
        setData(value)
      })
      .catch(() => {
        if (!cancelled && !loadedRef.current) setFailed(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [load, attempt, refreshKey])

  const retry = useCallback(() => setAttempt((value) => value + 1), [])

  return { data, loading, failed, retry }
}

function SectionError({
  title,
  onRetry,
}: {
  title: string
  onRetry: () => void
}) {
  const { i18n } = useLingui()
  return (
    <EmptyState
      title={title}
      description={i18n._(msg`请检查网络或本地 API 服务`)}
      action={
        <Button
          variant="secondary"
          size="sm"
          className="rounded-full text-[12px]"
          onClick={onRetry}
        >
          <Trans>重试</Trans>
        </Button>
      }
    />
  )
}

function loadPersonalized() {
  return fetchPersonalized(15)
}

function loadCuratedPlaylists() {
  return fetchTopPlaylists({ limit: 15 }).then((result) => result.playlists)
}

function greeting(hour: number) {
  if (hour < 5) return msg`夜深了`
  if (hour < 11) return msg`早上好`
  if (hour < 13) return msg`中午好`
  if (hour < 18) return msg`下午好`
  return msg`晚上好`
}

function DailyArtists({ songs }: { songs: Song[] }) {
  const names: string[] = []
  const seen = new Set<string>()
  for (const song of songs) {
    const name = song.ar[0]?.name
    if (!name || seen.has(name)) continue
    seen.add(name)
    names.push(name)
    if (names.length === 3) break
  }
  if (!names.length) {
    return <Trans>今日 {songs.length} 首</Trans>
  }
  return (
    <Trans>
      {names.join('、')} 等 {songs.length} 首
    </Trans>
  )
}

function DailyHomeCard({ songs, now }: { songs: Song[]; now: Date }) {
  const { i18n } = useLingui()
  const navigate = useNavigate()
  const initQueue = usePlayerStore((state) => state.initQueue)
  const isLogin = useUserStore((state) => state.isLogin)
  const [palette, setPalette] = useState<Palette>(FALLBACK_PALETTE)
  const day = now.getDate()
  const cover = resizedImageUrl(songs[0]?.al.picUrl, '640y640')
  const colors = palette.colors.length ? palette.colors : FALLBACK_PALETTE.colors

  useEffect(() => {
    if (!cover) return
    let active = true
    void extractPalette(cover)
      .then((next) => {
        if (active) setPalette(next)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [cover])

  const opensDaily = () => {
    void navigate({ to: '/daily' })
  }

  const play = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    if (songs.length) void initQueue(songs, 0, 'daily-home')
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={i18n._(msg`打开每日推荐`)}
      onClick={opensDaily}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        if (event.key === 'Enter') opensDaily()
      }}
      className="group relative mt-5 flex h-[212px] w-full cursor-pointer overflow-hidden rounded-[22px] text-white shadow-[0_14px_34px_-14px_rgba(0,0,0,0.35)]"
      style={{
        background: `linear-gradient(105deg, ${withAlpha(colors[0], 0.96)}, ${withAlpha(colors[1], 0.88)} 58%, ${withAlpha(colors[2], 0.82)})`,
      }}
    >
      {cover ? (
        <img
          src={cover}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full scale-110 object-cover opacity-20 blur-[34px]"
        />
      ) : null}
      <div className="absolute inset-0 bg-gradient-to-r from-black/45 via-black/10 to-black/25" />
      {/* Sits between the text and the cover stack: at right-[250px] the
          stacked covers cut the date in half. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-14 right-[360px] hidden text-[210px] font-extrabold leading-none tracking-[-18px] text-white/[0.055] xl:block"
      >
        {day}
      </span>

      <div className="relative z-10 flex min-w-0 flex-1 flex-col justify-center px-8">
        <p className="truncate text-[12px] font-semibold text-white/65">
          {isLogin ? (
            <Trans>每天 6:00 更新</Trans>
          ) : (
            <Trans>登录后为你专属生成</Trans>
          )}
        </p>
        <h2 className="mt-1 text-[32px] font-extrabold leading-[1.15] tracking-[-0.8px]">
          <Trans>每日推荐</Trans>
        </h2>
        <p className="mt-1 truncate text-[13px] text-white/80">
          <DailyArtists songs={songs} />
        </p>
        <div className="mt-3 flex items-center gap-2.5">
          <Button
            variant="primary"
            size="sm"
            onClick={play}
            className="h-[38px] rounded-full px-5 text-[13px]"
          >
            <Play className="h-3.5 w-3.5 fill-current" />
            <Trans>播放</Trans>
          </Button>
        </div>
      </div>

      <div className="daily-cover-stack relative z-10 mr-8 h-[156px] w-[300px] shrink-0 items-center justify-center">
        {songs.slice(0, 3).map((song, index) => {
          const front = index === 0
          return (
            <div
              key={song.id}
              className={
                front
                  ? 'absolute left-[92px] z-30 h-[156px] w-[156px] overflow-hidden rounded-[18px] shadow-[0_18px_40px_-10px_rgba(0,0,0,0.5)] transition-transform duration-500 group-hover:-translate-y-1'
                  : index === 1
                    ? 'absolute left-[52px] top-2 z-20 h-[140px] w-[140px] -rotate-[5deg] overflow-hidden rounded-[14px] opacity-90 shadow-[0_18px_40px_-10px_rgba(0,0,0,0.45)] transition-transform duration-500 group-hover:-translate-x-8 group-hover:-rotate-[10deg]'
                    : 'absolute left-[12px] top-4 z-10 h-[124px] w-[124px] -rotate-[10deg] overflow-hidden rounded-[14px] opacity-75 shadow-[0_18px_40px_-10px_rgba(0,0,0,0.45)] transition-transform duration-500 group-hover:-translate-x-16 group-hover:-rotate-[16deg]'
              }
            >
              <ImageWithFallback
                src={song.al.picUrl}
                alt={song.name}
                rounded="rounded-[18px]"
                resize="300y300"
                priority={front}
                className="h-full w-full"
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

function HomeSection({
  title,
  moreTo,
  children,
}: {
  title: ReactNode
  /** The page this section previews; shows a "查看全部" link. */
  moreTo?: '/toplist' | '/songlists'
  children: ReactNode
}) {
  return (
    <section className="mt-[34px]">
      <div className="mb-3.5 flex items-baseline justify-between gap-3">
        <h2 className="section-title">{title}</h2>
        {moreTo ? (
          <Link
            to={moreTo}
            className="flex shrink-0 items-center gap-0.5 text-[13px] text-ink-3 transition-colors hover:text-accent"
          >
            <Trans>查看全部</Trans>
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  )
}

function ChartCard({ list }: { list: Toplist }) {
  const navigate = useNavigate()
  const preview = list.tracks?.slice(0, 3) ?? []
  const frequency = formatFrequency(list.updateFrequency)
  return (
    <button
      type="button"
      onClick={() =>
        void navigate({
          to: '/songlists/$id',
          params: { id: String(list.id) },
        })
      }
      className="group flex min-w-0 items-center gap-3.5 rounded-[14px] p-3 text-left transition-colors hover:bg-black/[0.04]"
    >
      <div className="h-[84px] w-[84px] shrink-0 overflow-hidden rounded-[10px] shadow-[0_3px_10px_-2px_rgba(0,0,0,0.25)]">
        <ImageWithFallback
          src={list.coverImgUrl}
          alt={list.name}
          rounded="rounded-[10px]"
          resize="200y200"
          className="h-full w-full"
          imageClassName="transition-transform duration-500 group-hover:scale-[1.04]"
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate text-[15px] font-bold text-ink-1">
            {list.name}
          </span>
          {frequency ? (
            <span className="shrink-0 truncate text-[11px] text-ink-4">
              {frequency}
            </span>
          ) : null}
        </div>
        <div className="mt-1 space-y-0.5">
          {preview.map((track, index) => (
            // One truncating line, title first: as two separately truncating
            // spans both were cut ("《爱笑的天使》… 李嫣/窦…").
            <p
              key={`${track.id ?? index}-${track.first ?? track.name ?? ''}`}
              className="flex min-w-0 items-baseline gap-1.5 text-[12px]"
            >
              <span className="w-2.5 shrink-0 font-bold tabular-nums text-ink-4">
                {index + 1}
              </span>
              <span className="min-w-0 truncate">
                <span className="font-medium text-ink-2">
                  {track.first ?? track.name}
                </span>
                <span className="text-ink-4">
                  {' · '}
                  {track.second ?? formatArtists(track.ar)}
                </span>
              </span>
            </p>
          ))}
        </div>
      </div>
    </button>
  )
}

function DiscoveryPage() {
  const { i18n } = useLingui()
  useDocumentTitle(i18n._(msg`发现音乐`))
  const profile = useUserStore((state) => state.profile)
  const isLogin = useUserStore((state) => state.isLogin)
  const dailyRefreshKey = useDailyRefreshKey()
  const loadFeatured = useCallback(async () => {
    if (isLogin) {
      try {
        const daily = await fetchDailyRecommendPlaylists(15)
        if (daily.length) return daily
      } catch {
        // Fall through to the public curated list when the account daily
        // recommendation is unavailable.
      }
    }
    return loadCuratedPlaylists()
  }, [isLogin])
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    setNow(new Date())
  }, [dailyRefreshKey])
  const weekday = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.locale, { weekday: 'long' }).format(now),
    [i18n.locale, now],
  )
  const greetingText = i18n._(greeting(now.getHours()))
  const hello = profile?.nickname
    ? `${greetingText}，${profile.nickname}`
    : greetingText

  const {
    data: songs,
    loading: songLoading,
    failed: songFailed,
    retry: retrySongs,
  } = useSection(fetchAllDailyRecommendSongs, [] as Song[], dailyRefreshKey)
  const {
    data: playlists,
    loading: playlistLoading,
    failed: playlistFailed,
    retry: retryPlaylists,
  } = useSection(loadPersonalized, [] as Playlist[])
  const {
    data: charts,
    loading: chartLoading,
    failed: chartFailed,
    retry: retryCharts,
  } = useSection(fetchToplists, [] as Toplist[])
  const {
    data: featured,
    loading: featuredLoading,
    failed: featuredFailed,
    retry: retryFeatured,
  } = useSection(loadFeatured, [] as Playlist[], dailyRefreshKey)

  return (
    <div className="page">
      <PageHeader
        eyebrow={
          <>
            <Trans>{now.getMonth() + 1}月{now.getDate()}日</Trans> {weekday}
          </>
        }
        title={hello}
      />

      {songFailed ? (
        <div className="mt-5">
          <SectionError
            title={i18n._(msg`每日推荐加载失败`)}
            onRetry={retrySongs}
          />
        </div>
      ) : songLoading ? (
        <Skeleton className="mt-5 h-[212px] w-full rounded-[22px]" />
      ) : (
        <DailyHomeCard songs={songs} now={now} />
      )}

      <HomeSection title={i18n._(msg`今日为你推荐`)}>
        {playlistFailed ? (
          <SectionError
            title={i18n._(msg`推荐歌单加载失败`)}
            onRetry={retryPlaylists}
          />
        ) : playlistLoading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {Array.from({ length: 10 }).map((_, index) => (
              <div key={index}>
                <Skeleton className="aspect-square w-full rounded-[10px]" />
                <Skeleton className="mt-2 h-3 w-4/5 rounded-full" />
              </div>
            ))}
          </div>
        ) : playlists.length ? (
          <div className="grid grid-cols-2 gap-x-5 gap-y-7 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {playlists.slice(0, 10).map((playlist, index) => (
              <PlaylistCard
                key={playlist.id}
                playlist={playlist}
                priority={index < 5}
              />
            ))}
          </div>
        ) : (
          <EmptyState title={i18n._(msg`暂无推荐歌单`)} />
        )}
      </HomeSection>

      <HomeSection title={i18n._(msg`官方榜单`)} moreTo="/toplist">
        {chartFailed ? (
          <SectionError
            title={i18n._(msg`榜单加载失败`)}
            onRetry={retryCharts}
          />
        ) : chartLoading ? (
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-[108px] w-full rounded-[14px]" />
            ))}
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
            {charts.slice(0, 4).map((list) => (
              <ChartCard key={list.id} list={list} />
            ))}
          </div>
        )}
      </HomeSection>

      <HomeSection title={i18n._(msg`推荐歌单`)} moreTo="/songlists">
        {featuredFailed ? (
          <SectionError
            title={i18n._(msg`推荐歌单加载失败`)}
            onRetry={retryFeatured}
          />
        ) : featuredLoading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {Array.from({ length: 15 }).map((_, index) => (
              <div key={index}>
                <Skeleton className="aspect-square w-full rounded-[10px]" />
                <Skeleton className="mt-2 h-3 w-4/5 rounded-full" />
              </div>
            ))}
          </div>
        ) : featured.length ? (
          <div className="grid grid-cols-2 gap-x-5 gap-y-7 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {featured.map((playlist, index) => (
              <PlaylistCard
                key={playlist.id}
                playlist={playlist}
                priority={index < 5}
              />
            ))}
          </div>
        ) : (
          <EmptyState title={i18n._(msg`暂无推荐歌单`)} />
        )}
      </HomeSection>
    </div>
  )
}
