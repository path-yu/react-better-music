import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import {
  ChevronLeft,
  ChevronRight,
  Clock3,
  Play,
  Sparkles,
} from 'lucide-react'
import { Button, Skeleton } from '@pikoloo/darwin-ui'
import { PlaylistCard } from '../components/cards/PlaylistCard'
import { MvCard } from '../components/cards/MvCard'
import { ImageWithFallback } from '../components/common/ImageWithFallback'
import { ArtistLinks } from '../components/common/ArtistLinks'
import { EmptyState } from '../components/common/EmptyState'
import {
  fetchBanners,
  fetchDailyRecommendSongs,
  fetchPersonalized,
  fetchRecommendMv,
} from '../api'
import { usePlayerStore } from '../store/player'
import { formatDuration, cn } from '../lib/format'
import { useDocumentTitle } from '../lib/title'
import type { Banner, Mv, Playlist, Song } from '../types'

export const Route = createFileRoute('/')({
  component: DiscoveryPage,
})

/** Loads one home section and exposes an error flag plus a retry action. */
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

function SectionError({ title, onRetry }: { title: string; onRetry: () => void }) {
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

function DiscoveryPage() {
  const { i18n } = useLingui()
  const navigate = useNavigate()
  useDocumentTitle(i18n._(msg`发现音乐`))
  const [index, setIndex] = useState(0)
  const [hovered, setHovered] = useState(false)

  const {
    data: banners,
    loading: bannerLoading,
    failed: bannerFailed,
    retry: retryBanners,
  } = useSection(fetchBanners, [] as Banner[])
  const {
    data: playlists,
    loading: playlistLoading,
    failed: playlistFailed,
    retry: retryPlaylists,
  } = useSection(fetchPersonalized, [] as Playlist[])
  const {
    data: songs,
    loading: songLoading,
    failed: songFailed,
    retry: retrySongs,
  } = useSection(fetchDailyRecommendSongs, [] as Song[])
  const {
    data: mvs,
    loading: mvLoading,
    failed: mvFailed,
    retry: retryMvs,
  } = useSection(fetchRecommendMv, [] as Mv[])

  useEffect(() => {
    if (hovered || banners.length <= 1) return
    const timer = window.setInterval(() => {
      setIndex((value) => (value + 1) % banners.length)
    }, 6000)
    return () => window.clearInterval(timer)
  }, [banners.length, hovered])

  const currentBanner = banners[index]

  const step = (direction: 1 | -1) => {
    if (!banners.length) return
    setIndex((value) => (value + direction + banners.length) % banners.length)
  }

  const handleBannerClick = (banner: Banner) => {
    if (banner.targetType === 1000 && banner.targetId) {
      void navigate({ to: '/songlists/$id', params: { id: String(banner.targetId) } })
      return
    }
    if (banner.url) window.open(banner.url, '_blank', 'noopener')
  }

  return (
    <div className="px-8 pb-14 pt-6">
      <section
        className="relative"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {bannerLoading ? (
          <Skeleton className="h-[280px] w-full rounded-[22px]" />
        ) : bannerFailed ? (
          <SectionError title={i18n._(msg`轮播加载失败`)} onRetry={retryBanners} />
        ) : currentBanner ? (
          <div
            role="button"
            tabIndex={0}
            aria-label={
              currentBanner.typeTitle ?? i18n._(msg`推荐轮播`)
            }
            onClick={() => handleBannerClick(currentBanner)}
            onKeyDown={(event) => event.key === 'Enter' && handleBannerClick(currentBanner)}
            className="group relative block h-[clamp(190px,24vw,300px)] w-full cursor-pointer overflow-hidden rounded-[22px] bg-[#f0f0f2]"
          >
            <ImageWithFallback
              src={currentBanner.imageUrl}
              alt=""
              rounded="rounded-[22px]"
              className="h-full w-full"
              // The banner is at most ~900 CSS px wide; 1200×600 wasted ~200 KB
              // on the LCP image. The CDN accepts a smaller 2:1 crop.
              resize="900y450"
              priority
              imageClassName="transition-transform duration-[900ms] group-hover:scale-[1.02]"
            />
            {currentBanner.typeTitle ? (
              <span className="absolute left-4 top-4 rounded-full bg-black/30 px-2.5 py-1 text-[11px] text-white backdrop-blur-md">
                {currentBanner.typeTitle}
              </span>
            ) : null}
          </div>
        ) : (
          <EmptyState title={i18n._(msg`暂无轮播内容`)} />
        )}

        {banners.length > 1 && (
          <>
            <button
              type="button"
              aria-label={i18n._(msg`上一张`)}
              onClick={() => step(-1)}
              className={cn(
                'absolute left-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/80 text-black/60 shadow-md backdrop-blur-md transition-all hover:bg-white hover:text-black max-md:h-10 max-md:w-10',
                hovered ? 'opacity-100' : 'opacity-0',
              )}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label={i18n._(msg`下一张`)}
              onClick={() => step(1)}
              className={cn(
                'absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/80 text-black/60 shadow-md backdrop-blur-md transition-all hover:bg-white hover:text-black max-md:h-10 max-md:w-10',
                hovered ? 'opacity-100' : 'opacity-0',
              )}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5">
              {banners.map((banner, dotIndex) => (
                <button
                  key={banner.imageUrl}
                  type="button"
                  aria-label={`第 ${dotIndex + 1} 张`}
                  aria-current={dotIndex === index ? 'true' : undefined}
                  onClick={() => setIndex(dotIndex)}
                  className="flex h-6 w-6 items-center justify-center"
                >
                  <span
                    className={cn(
                      'block h-[3px] rounded-full transition-all',
                      dotIndex === index ? 'w-5 bg-white' : 'w-[7px] bg-white/45',
                    )}
                  />
                </button>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="mt-9">
        <SectionTitle
          title={i18n._(msg`推荐歌单`)}
          subtitle={i18n._(msg`根据你的口味精选`)}
        />
        {playlistLoading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {Array.from({ length: 10 }).map((_, item) => (
              <div key={item} className="apple-card p-2.5">
                <Skeleton className="aspect-square w-full rounded-[10px]" />
                <Skeleton className="mt-2 h-3 w-4/5 rounded-full" />
              </div>
            ))}
          </div>
        ) : playlistFailed ? (
          <SectionError title={i18n._(msg`推荐歌单加载失败`)} onRetry={retryPlaylists} />
        ) : playlists.length ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {playlists.map((playlist, index) => (
              <PlaylistCard
                key={playlist.id}
                playlist={playlist}
                priority={index < 4}
              />
            ))}
          </div>
        ) : (
          <EmptyState title={i18n._(msg`暂无推荐歌单`)} />
        )}
        <div className="mt-4 flex justify-end">
          <Button
            variant="link"
            size="sm"
            className="text-[11.5px] text-accent"
            onClick={() => void navigate({ to: '/songlists' })}
          >
            {i18n._(msg`查看全部歌单`)}
            <ChevronRight className="ml-0.5 h-3 w-3" />
          </Button>
        </div>
      </section>

      <section className="mt-7">
        <SectionTitle
          title={i18n._(msg`每日推荐`)}
          subtitle={
            new Date().toLocaleDateString(i18n.locale, {
              month: 'long',
              day: 'numeric',
            })
          }
          icon={<Sparkles className="h-4 w-4 text-accent" />}
        />
        {songLoading ? (
          <div className="grid gap-2 md:grid-cols-2">
            {Array.from({ length: 8 }).map((_, item) => (
              <Skeleton key={item} className="h-[56px] w-full rounded-[14px]" />
            ))}
          </div>
        ) : songFailed ? (
          <SectionError title={i18n._(msg`每日推荐加载失败`)} onRetry={retrySongs} />
        ) : (
          <DailySongGrid songs={songs} />
        )}
      </section>

      <section className="mt-9">
        <SectionTitle
          title={i18n._(msg`最新 MV`)}
          subtitle={i18n._(msg`精选音乐视频`)}
        />
        {mvLoading ? (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, item) => (
              <div key={item}>
                <Skeleton className="aspect-video w-full rounded-[14px]" />
                <Skeleton className="mt-2 h-3 w-3/5 rounded-full" />
              </div>
            ))}
          </div>
        ) : mvFailed ? (
          <SectionError title={i18n._(msg`MV 推荐加载失败`)} onRetry={retryMvs} />
        ) : mvs.length ? (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {/* The MV section sits below the first screen; keep these lazy so
                they don't compete with the banner (the LCP element). */}
            {mvs.map((mv) => (
              <MvCard key={mv.id} mv={mv} />
            ))}
          </div>
        ) : (
          <EmptyState title={i18n._(msg`暂无 MV 推荐`)} />
        )}
        <div className="mt-4 flex justify-end">
          <Button
            variant="link"
            size="sm"
            className="text-[11.5px] text-accent"
            onClick={() => void navigate({ to: '/latest-mv' })}
          >
            {i18n._(msg`查看全部 MV`)}
            <ChevronRight className="ml-0.5 h-3 w-3" />
          </Button>
        </div>
      </section>
    </div>
  )
}

function SectionTitle({
  title,
  subtitle,
  icon,
}: {
  title: string
  subtitle?: string
  icon?: ReactNode
}) {
  return (
    <div className="mb-4 flex items-end justify-between">
      <div>
        <h2 className="section-title flex items-center gap-2">
          {icon}
          {title}
        </h2>
        {subtitle ? <p className="mt-1 text-[11px] text-black/55">{subtitle}</p> : null}
      </div>
    </div>
  )
}

function DailySongGrid({ songs }: { songs: Song[] }) {
  const { i18n } = useLingui()
  const initQueue = usePlayerStore((state) => state.initQueue)
  const currentSong = usePlayerStore((state) => state.queue[state.currentIndex])
  const playing = usePlayerStore((state) => state.playing)
  const listId = useMemo(() => `daily-${new Date().toDateString()}`, [])

  if (!songs.length)
    return <EmptyState title={i18n._(msg`暂无推荐歌曲`)} />

  return (
    <div className="grid gap-1.5 md:grid-cols-2">
      {songs.map((song, index) => {
        const active = currentSong?.id === song.id
        return (
          <div
            key={song.id}
            role="button"
            tabIndex={0}
            onClick={() => void initQueue(songs, index, listId)}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return
              if (event.key === 'Enter') void initQueue(songs, index, listId)
            }}
            className={cn(
              'daily-song-row group relative flex cursor-pointer items-center gap-3 rounded-[14px] px-2.5 py-2 text-left transition-colors',
              active ? 'is-active bg-accent/6' : 'hover:bg-black/4',
            )}
          >
            <span className="relative shrink-0">
              <ImageWithFallback
                src={song.al.picUrl}
                alt={song.name}
                rounded="rounded-[6px]"
                className="h-10 w-10"
                resize="96y96"
              />
              <span className="absolute inset-0 flex items-center justify-center rounded-[6px] bg-black/30 text-white opacity-0 transition-opacity group-hover:opacity-100">
                <Play className="h-3 w-3 fill-current" />
              </span>
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span
                  className={cn(
                    'truncate text-[12px]',
                    active ? 'font-medium text-accent' : 'text-black/78',
                  )}
                >
                  {song.name}
                </span>
                {song.fee === 1 ? (
                  <span className="rounded-[6px] bg-[#ff2d55]/10 px-1 text-[11px] text-[#ff2d55]">
                    VIP
                  </span>
                ) : null}
              </div>
              <p className="mt-0.5 truncate text-[11px] text-black/35">
                <ArtistLinks artists={song.ar} />
              </p>
            </div>
            <span className="flex shrink-0 items-center gap-1 text-[11px] tabular-nums text-black/25">
              <Clock3 className="h-3 w-3" />
              {formatDuration(song.dt)}
            </span>
            {playing && active ? (
              <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-accent" />
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
