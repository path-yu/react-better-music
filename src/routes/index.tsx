import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { Trans } from '@lingui/react/macro'
import { LogIn, Play } from 'lucide-react'
import { Button, Skeleton } from '@pikoloo/darwin-ui'
import { PlaylistCard } from '../components/cards/PlaylistCard'
import { ImageWithFallback } from '../components/common/ImageWithFallback'
import { EmptyState } from '../components/common/EmptyState'
import {
  fetchAllDailyRecommendSongs,
  fetchPersonalized,
  fetchTopPlaylists,
  fetchToplists,
} from '../api'
import { usePlayerStore } from '../store/player'
import { useUiStore } from '../store/ui'
import { useUserStore } from '../store/user'
import {
  FALLBACK_PALETTE,
  extractPalette,
  withAlpha,
  type Palette,
} from '../lib/color'
import { resizedImageUrl } from '../lib/image'
import { formatArtists } from '../lib/format'
import { useDocumentTitle } from '../lib/title'
import type { Playlist, Song, Toplist } from '../types'

export const Route = createFileRoute('/')({
  component: DiscoveryPage,
})

function useSection<T>(load: () => Promise<T>, initial: T) {
  const [data, setData] = useState<T>(initial)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setFailed(false)
    load()
      .then((value) => {
        if (!cancelled) setData(value)
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
  }, [load, attempt])

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
  return (
    <EmptyState
      title={title}
      description="请检查网络或本地 API 服务"
      action={
        <Button
          variant="secondary"
          size="sm"
          className="rounded-full text-[11.5px]"
          onClick={onRetry}
        >
          重试
        </Button>
      }
    />
  )
}

function loadPersonalized() {
  return fetchPersonalized(15)
}

function loadFeatured() {
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

function DailyHomeCard({ songs }: { songs: Song[] }) {
  const { i18n } = useLingui()
  const navigate = useNavigate()
  const initQueue = usePlayerStore((state) => state.initQueue)
  const isLogin = useUserStore((state) => state.isLogin)
  const openLogin = useUiStore((state) => state.openLogin)
  const [palette, setPalette] = useState<Palette>(FALLBACK_PALETTE)
  const now = useMemo(() => new Date(), [])
  const month = now.getMonth() + 1
  const day = now.getDate()
  const weekday = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.locale, { weekday: 'long' }).format(now),
    [i18n.locale, now],
  )
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
        if (event.key === 'Enter' || event.key === ' ') opensDaily()
      }}
      className="group relative mt-5 flex h-[212px] w-full cursor-pointer overflow-hidden rounded-[24px] text-white shadow-[0_14px_34px_-14px_rgba(0,0,0,0.35)]"
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
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-14 right-[250px] hidden text-[210px] font-extrabold leading-none tracking-[-18px] text-white/[0.055] lg:block"
      >
        {day}
      </span>

      <div className="relative z-10 flex min-w-0 flex-1 flex-col justify-center px-8">
        <p className="truncate text-[12px] font-semibold text-white/65">
          {month}月{day}日 {weekday} ·{' '}
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
          {!isLogin ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={(event) => {
                event.stopPropagation()
                openLogin()
              }}
              className="h-[38px] rounded-full px-4 text-[13px] text-white/85 hover:bg-white/10 hover:text-white"
            >
              <LogIn className="h-3.5 w-3.5" />
              <Trans>登录</Trans>
            </Button>
          ) : null}
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
                  ? 'absolute left-[92px] z-30 h-[156px] w-[156px] overflow-hidden rounded-[16px] shadow-[0_18px_40px_-10px_rgba(0,0,0,0.5)] transition-transform duration-500 group-hover:-translate-y-1'
                  : index === 1
                    ? 'absolute left-[52px] top-2 z-20 h-[140px] w-[140px] -rotate-[5deg] overflow-hidden rounded-[14px] opacity-90 shadow-[0_18px_40px_-10px_rgba(0,0,0,0.45)] transition-transform duration-500 group-hover:-translate-x-8 group-hover:-rotate-[10deg]'
                    : 'absolute left-[12px] top-4 z-10 h-[124px] w-[124px] -rotate-[10deg] overflow-hidden rounded-[14px] opacity-75 shadow-[0_18px_40px_-10px_rgba(0,0,0,0.45)] transition-transform duration-500 group-hover:-translate-x-16 group-hover:-rotate-[16deg]'
              }
            >
              <ImageWithFallback
                src={song.al.picUrl}
                alt={song.name}
                rounded="rounded-[16px]"
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
  children,
}: {
  title: ReactNode
  children: ReactNode
}) {
  return (
    <section className="mt-[34px]">
      <h2 className="mb-3.5 text-[19px] font-bold tracking-[-0.3px]">
        {title}
      </h2>
      {children}
    </section>
  )
}

function ChartCard({ list }: { list: Toplist }) {
  const navigate = useNavigate()
  const preview = list.tracks?.slice(0, 3) ?? []
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
      <div className="h-[84px] w-[84px] shrink-0 overflow-hidden rounded-[9px] shadow-[0_3px_10px_-2px_rgba(0,0,0,0.25)]">
        <ImageWithFallback
          src={list.coverImgUrl}
          alt={list.name}
          rounded="rounded-[9px]"
          resize="200y200"
          className="h-full w-full"
          imageClassName="transition-transform duration-500 group-hover:scale-[1.04]"
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate text-[14px] font-bold text-black/80">
            {list.name}
          </span>
          {list.updateFrequency ? (
            <span className="shrink-0 truncate text-[11px] text-black/30">
              {list.updateFrequency}
            </span>
          ) : null}
        </div>
        <div className="mt-1 space-y-0.5">
          {preview.map((track, index) => (
            <p
              key={`${track.id ?? index}-${track.first ?? track.name ?? ''}`}
              className="flex min-w-0 items-baseline gap-1.5 text-[11.5px]"
            >
              <span className="w-2.5 shrink-0 font-bold tabular-nums text-black/35">
                {index + 1}
              </span>
              <span className="truncate font-medium text-black/70">
                {track.first ?? track.name}
              </span>
              <span className="truncate text-black/30">
                {track.second ?? formatArtists(track.ar)}
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
  const now = useMemo(() => new Date(), [])
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
  } = useSection(fetchAllDailyRecommendSongs, [] as Song[])
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
  } = useSection(loadFeatured, [] as Playlist[])

  return (
    <div className="px-10 pb-16 pt-8 max-md:px-5">
      <header>
        <p className="text-[12px] font-semibold tracking-[0.4px] text-black/35">
          {now.getMonth() + 1}月{now.getDate()}日 {weekday}
        </p>
        <h1 className="mt-1 text-[30px] font-bold leading-tight tracking-[-0.6px]">
          {hello}
        </h1>
      </header>

      {songFailed ? (
        <div className="mt-5">
          <SectionError
            title={i18n._(msg`每日推荐加载失败`)}
            onRetry={retrySongs}
          />
        </div>
      ) : songLoading ? (
        <Skeleton className="mt-5 h-[212px] w-full rounded-[24px]" />
      ) : (
        <DailyHomeCard songs={songs} />
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

      <HomeSection title={i18n._(msg`官方榜单`)}>
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

      <HomeSection title={i18n._(msg`推荐歌单`)}>
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
