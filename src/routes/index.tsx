import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
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
import type { Banner, Mv, Playlist, Song } from '../types'

export const Route = createFileRoute('/')({
  component: DiscoveryPage,
})

function DiscoveryPage() {
  const navigate = useNavigate()
  const [banners, setBanners] = useState<Banner[]>([])
  const [bannerLoading, setBannerLoading] = useState(true)
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [playlistLoading, setPlaylistLoading] = useState(true)
  const [songs, setSongs] = useState<Song[]>([])
  const [songLoading, setSongLoading] = useState(true)
  const [mvs, setMvs] = useState<Mv[]>([])
  const [mvLoading, setMvLoading] = useState(true)
  const [index, setIndex] = useState(0)
  const [hovered, setHovered] = useState(false)

  useEffect(() => {
    fetchBanners()
      .then(setBanners)
      .catch(() => undefined)
      .finally(() => setBannerLoading(false))
    fetchPersonalized(15)
      .then(setPlaylists)
      .catch(() => undefined)
      .finally(() => setPlaylistLoading(false))
    fetchDailyRecommendSongs()
      .then(setSongs)
      .catch(() => undefined)
      .finally(() => setSongLoading(false))
    fetchRecommendMv(4)
      .then(setMvs)
      .catch(() => undefined)
      .finally(() => setMvLoading(false))
  }, [])

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
        ) : currentBanner ? (
          <div
            role="button"
            tabIndex={0}
            onClick={() => handleBannerClick(currentBanner)}
            onKeyDown={(event) => event.key === 'Enter' && handleBannerClick(currentBanner)}
            className="group relative block h-[clamp(190px,24vw,300px)] w-full cursor-pointer overflow-hidden rounded-[22px] bg-[#f0f0f2]"
          >
            <ImageWithFallback
              src={currentBanner.imageUrl}
              alt={currentBanner.typeTitle ?? '推荐'}
              rounded="rounded-[22px]"
              className="h-full w-full"
              imageClassName="transition-transform duration-[900ms] group-hover:scale-[1.02]"
            />
            {currentBanner.typeTitle ? (
              <span className="absolute left-4 top-4 rounded-full bg-black/30 px-2.5 py-1 text-[10px] text-white backdrop-blur-md">
                {currentBanner.typeTitle}
              </span>
            ) : null}
          </div>
        ) : (
          <EmptyState title="暂无轮播内容" />
        )}

        {banners.length > 1 && (
          <>
            <button
              type="button"
              aria-label="上一张"
              onClick={() => step(-1)}
              className={cn(
                'absolute left-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/80 text-black/60 shadow-md backdrop-blur-md transition-all hover:bg-white hover:text-black',
                hovered ? 'opacity-100' : 'opacity-0',
              )}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="下一张"
              onClick={() => step(1)}
              className={cn(
                'absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/80 text-black/60 shadow-md backdrop-blur-md transition-all hover:bg-white hover:text-black',
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
                  onClick={() => setIndex(dotIndex)}
                  className={cn(
                    'h-[3px] rounded-full transition-all',
                    dotIndex === index ? 'w-5 bg-white' : 'w-[7px] bg-white/45',
                  )}
                />
              ))}
            </div>
          </>
        )}
      </section>

      <section className="mt-9">
        <SectionTitle title="推荐歌单" subtitle="根据你的口味精选" />
        {playlistLoading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {Array.from({ length: 10 }).map((_, item) => (
              <div key={item} className="apple-card p-2.5">
                <Skeleton className="aspect-square w-full rounded-[9px]" />
                <Skeleton className="mt-2 h-3 w-4/5 rounded-full" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {playlists.map((playlist) => (
              <PlaylistCard key={playlist.id} playlist={playlist} />
            ))}
          </div>
        )}
        <div className="mt-4 flex justify-end">
          <Button
            variant="link"
            size="sm"
            className="text-[11.5px] text-[#0066cc]"
            onClick={() => void navigate({ to: '/songlists' })}
          >
            查看全部歌单
            <ChevronRight className="ml-0.5 h-3 w-3" />
          </Button>
        </div>
      </section>

      <section className="mt-7">
        <SectionTitle
          title="每日推荐"
          subtitle={
            new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })
          }
          icon={<Sparkles className="h-4 w-4 text-[#0066cc]" />}
        />
        {songLoading ? (
          <div className="grid gap-2 md:grid-cols-2">
            {Array.from({ length: 8 }).map((_, item) => (
              <Skeleton key={item} className="h-[56px] w-full rounded-[12px]" />
            ))}
          </div>
        ) : (
          <DailySongGrid songs={songs} />
        )}
      </section>

      <section className="mt-9">
        <SectionTitle title="最新 MV" subtitle="精选音乐视频" />
        {mvLoading ? (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, item) => (
              <div key={item}>
                <Skeleton className="aspect-video w-full rounded-[12px]" />
                <Skeleton className="mt-2 h-3 w-3/5 rounded-full" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {mvs.map((mv) => (
              <MvCard key={mv.id} mv={mv} />
            ))}
          </div>
        )}
        <div className="mt-4 flex justify-end">
          <Button
            variant="link"
            size="sm"
            className="text-[11.5px] text-[#0066cc]"
            onClick={() => void navigate({ to: '/latest-mv' })}
          >
            查看全部 MV
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
        {subtitle ? <p className="mt-1 text-[11px] text-black/35">{subtitle}</p> : null}
      </div>
    </div>
  )
}

function DailySongGrid({ songs }: { songs: Song[] }) {
  const initQueue = usePlayerStore((state) => state.initQueue)
  const currentSong = usePlayerStore((state) => state.queue[state.currentIndex])
  const playing = usePlayerStore((state) => state.playing)
  const listId = useMemo(() => `daily-${new Date().toDateString()}`, [])

  if (!songs.length) return <EmptyState title="暂无推荐歌曲" />

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
              'group flex cursor-pointer items-center gap-3 rounded-[12px] px-2.5 py-2 text-left transition-colors',
              active ? 'bg-[#0066cc]/6' : 'hover:bg-black/4',
            )}
          >
            <span className="relative shrink-0">
              <ImageWithFallback
                src={song.al.picUrl}
                alt={song.name}
                rounded="rounded-[7px]"
                className="h-10 w-10"
              />
              <span className="absolute inset-0 flex items-center justify-center rounded-[7px] bg-black/30 text-white opacity-0 transition-opacity group-hover:opacity-100">
                <Play className="h-3 w-3 fill-current" />
              </span>
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span
                  className={cn(
                    'truncate text-[12px]',
                    active ? 'font-medium text-[#0066cc]' : 'text-black/78',
                  )}
                >
                  {song.name}
                </span>
                {song.fee === 1 ? (
                  <span className="rounded-[3px] bg-[#ff2d55]/10 px-1 text-[9px] text-[#ff2d55]">
                    VIP
                  </span>
                ) : null}
              </div>
              <p className="mt-0.5 truncate text-[10.5px] text-black/35">
                <ArtistLinks artists={song.ar} />
              </p>
            </div>
            <span className="flex shrink-0 items-center gap-1 text-[10px] tabular-nums text-black/25">
              <Clock3 className="h-3 w-3" />
              {formatDuration(song.dt)}
            </span>
            {playing && active ? (
              <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[#0066cc]" />
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
