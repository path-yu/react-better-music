import { useEffect, useMemo, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { ListMusic, Search } from 'lucide-react'
import { Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from '@pikoloo/darwin-ui'
import { ImageWithFallback } from '../components/common/ImageWithFallback'
import { EmptyState } from '../components/common/EmptyState'
import { Pager } from '../components/common/Pager'
import { SongTable } from '../components/songs/SongTable'
import { PlayAllButton } from '../components/songs/PlayAllButton'
import { VideoCard } from '../components/video/VideoCard'
import { searchAll } from '../api'
import { formatNumber } from '../lib/format'
import { useDocumentTitle } from '../lib/title'
import { toast } from '../lib/toast'
import type { ArtistSummary, Playlist, Song, VideoItem } from '../types'

const SEARCH_TABS = ['songs', 'playlists', 'artists', 'mvs', 'videos'] as const
type SearchTab = (typeof SEARCH_TABS)[number]

function normalizeTab(value: unknown): SearchTab {
  return SEARCH_TABS.includes(value as SearchTab) ? (value as SearchTab) : 'songs'
}

export const Route = createFileRoute('/search')({
  validateSearch: (search: Record<string, unknown>) => ({
    keyword: typeof search.keyword === 'string' ? search.keyword : '',
    // Keeping the tab in the URL makes browser Back restore it instead of
    // falling back to 单曲 after visiting a video/MV page.
    tab: normalizeTab(search.tab),
  }),
  component: SearchPage,
})

const SONG_PAGE_SIZE = 30
const PLAYLIST_PAGE_SIZE = 20
const ARTIST_PAGE_SIZE = 20
const VIDEO_PAGE_SIZE = 20

function SearchPage() {
  const { keyword, tab } = Route.useSearch()
  const navigate = useNavigate()
  useDocumentTitle(keyword.trim() ? `搜索「${keyword.trim()}」` : '搜索')
  const [page, setPage] = useState(1)
  const [songs, setSongs] = useState<Song[]>([])
  const [songTotal, setSongTotal] = useState(0)
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [playlistTotal, setPlaylistTotal] = useState(0)
  const [artists, setArtists] = useState<ArtistSummary[]>([])
  const [artistTotal, setArtistTotal] = useState(0)
  const [mvs, setMvs] = useState<VideoItem[]>([])
  const [mvTotal, setMvTotal] = useState(0)
  const [videos, setVideos] = useState<VideoItem[]>([])
  const [videoTotal, setVideoTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  // A failed request must not look like an empty result set.
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    setPage(1)
    setSongs([])
    setPlaylists([])
    setArtists([])
    setMvs([])
    setVideos([])
    setSongTotal(0)
    setPlaylistTotal(0)
    setArtistTotal(0)
    setMvTotal(0)
    setVideoTotal(0)
    setFailed(false)
  }, [keyword])

  useEffect(() => {
    if (!keyword.trim()) return
    const controller = new AbortController()
    setLoading(true)
    setFailed(false)
    const pageSize =
      tab === 'songs'
        ? SONG_PAGE_SIZE
        : tab === 'artists'
          ? ARTIST_PAGE_SIZE
          : tab === 'mvs' || tab === 'videos'
            ? VIDEO_PAGE_SIZE
            : PLAYLIST_PAGE_SIZE
    const type: '1' | '100' | '1000' | '1004' | '1014' =
      tab === 'songs'
        ? '1'
        : tab === 'artists'
          ? '100'
          : tab === 'mvs'
            ? '1004'
            : tab === 'videos'
              ? '1014'
              : '1000'
    searchAll(
      {
        keywords: keyword,
        type,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      },
      controller.signal,
    )
      .then((result) => {
        if (controller.signal.aborted) return
        if (tab === 'songs') {
          setSongs(result.songs ?? [])
          setSongTotal(result.songCount ?? 0)
        } else if (tab === 'artists') {
          setArtists(result.artists ?? [])
          setArtistTotal(result.artistCount ?? 0)
        } else if (tab === 'mvs') {
          setMvs(result.mvs ?? [])
          setMvTotal(result.mvCount ?? 0)
        } else if (tab === 'videos') {
          setVideos(result.videos ?? [])
          setVideoTotal(result.videoCount ?? 0)
        } else {
          setPlaylists(result.playlists ?? [])
          setPlaylistTotal(result.playlistCount ?? 0)
        }
      })
      .catch(() => {
        if (controller.signal.aborted) return
        setFailed(true)
        toast.error('搜索失败')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [keyword, tab, page, attempt])

  const retry = () => setAttempt((value) => value + 1)

  const changeTab = (value: string) => {
    setPage(1)
    void navigate({
      to: '/search',
      search: { keyword, tab: normalizeTab(value) },
      replace: true,
    })
  }

  const openVideoItem = (item: VideoItem) => {
    if (item.kind === 'mv') {
      void navigate({ to: '/mv/$id', params: { id: String(item.id) } })
      return
    }
    void navigate({
      to: '/video/$id',
      params: { id: String(item.id) },
      search: {
        kind: item.kind,
        title: item.title,
        cover: item.cover ?? '',
        artist: item.artist ?? '',
        duration: item.duration ?? 0,
      },
    })
  }

  const pageSize =
    tab === 'songs'
      ? SONG_PAGE_SIZE
      : tab === 'artists'
        ? ARTIST_PAGE_SIZE
        : tab === 'mvs' || tab === 'videos'
          ? VIDEO_PAGE_SIZE
          : PLAYLIST_PAGE_SIZE
  const total =
    tab === 'songs'
      ? songTotal
      : tab === 'artists'
        ? artistTotal
        : tab === 'mvs'
          ? mvTotal
          : tab === 'videos'
            ? videoTotal
            : playlistTotal
  const pageCount = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [pageSize, total])

  if (!keyword.trim()) {
    return (
      <div className="px-8 pt-10">
        <EmptyState
          icon={<Search className="h-6 w-6" />}
          title="搜索音乐、歌单、歌手、MV 或视频"
          description="在顶部搜索框输入关键词后回车"
        />
      </div>
    )
  }

  return (
    <div className="px-8 pb-14 pt-6">
      <div>
        <p className="eyebrow">搜索结果</p>
        <h1 className="headline-lg mt-1.5 line-clamp-1">“{keyword}”</h1>
      </div>

      <Tabs value={tab} onValueChange={changeTab} className="mt-5">
        <div className="flex items-center justify-between gap-3 border-b border-black/8 pb-2">
          <TabsList className="max-w-full overflow-x-auto">
            <TabsTrigger value="songs">单曲</TabsTrigger>
            <TabsTrigger value="playlists">歌单</TabsTrigger>
            <TabsTrigger value="artists">歌手</TabsTrigger>
            <TabsTrigger value="mvs">MV</TabsTrigger>
            <TabsTrigger value="videos">视频</TabsTrigger>
          </TabsList>
          {tab === 'songs' && songs.length ? (
            <PlayAllButton
              songs={songs}
              playlistId={`search-${keyword}-${page}`}
              label="播放本页"
            />
          ) : null}
        </div>

        <TabsContent value="songs" className="mt-3">
          {failed ? (
            <EmptyState
              variant="error"
              title="搜索失败"
              description="请检查网络或本地 API 服务后重试"
              onRetry={retry}
            />
          ) : (
            <>
              <div className="mb-2 flex items-center justify-between text-[11px] text-black/35">
                <span>共找到 {songTotal} 首单曲</span>
              </div>
              <SongTable
                songs={songs}
                playlistId={`search-${keyword}-${page}`}
                loading={loading}
                emptyText="没有找到相关单曲"
              />
              <Pager page={page} pageCount={pageCount} onChange={setPage} className="mt-6" />
            </>
          )}
        </TabsContent>

        <TabsContent value="playlists" className="mt-3">
          <div className="mb-2 text-[11px] text-black/35">
            共找到 {playlistTotal} 个歌单
          </div>
          {failed ? (
            <EmptyState
              variant="error"
              title="歌单加载失败"
              description="请检查网络或本地 API 服务后重试"
              onRetry={retry}
            />
          ) : loading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-[68px] w-full rounded-[14px]" />
              ))}
            </div>
          ) : playlists.length ? (
            <div className="space-y-1">
              {playlists.map((playlist) => (
                <button
                  key={playlist.id}
                  type="button"
                  onClick={() =>
                    void navigate({
                      to: '/songlists/$id',
                      params: { id: String(playlist.id) },
                    })
                  }
                  className="group flex w-full items-center gap-3 rounded-[14px] px-2 py-2 text-left transition-colors hover:bg-black/4"
                >
                  <ImageWithFallback
                    src={playlist.coverImgUrl}
                    alt={playlist.name}
                    rounded="rounded-[10px]"
                    className="h-14 w-14 shrink-0"
                    resize="128y128"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-1 text-[12.5px] text-black/75 group-hover:text-accent">
                      {playlist.name}
                    </p>
                    <p className="mt-1 flex items-center gap-2 text-[11px] text-black/30">
                      <span>{playlist.trackCount} 首</span>
                      <span>by {playlist.creator?.nickname}</span>
                    </p>
                  </div>
                  <span className="flex shrink-0 items-center gap-1 text-[11px] text-black/30">
                    <ListMusic className="h-3 w-3" />
                    {formatNumber(playlist.playCount)}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState title="没有找到相关歌单" />
          )}
          <Pager page={page} pageCount={pageCount} onChange={setPage} className="mt-6" />
        </TabsContent>
        <TabsContent value="artists" className="mt-3">
          <div className="mb-2 text-[11px] text-black/35">
            共找到 {artistTotal} 位歌手
          </div>
          {failed ? (
            <EmptyState
              variant="error"
              title="歌手加载失败"
              description="请检查网络或本地 API 服务后重试"
              onRetry={retry}
            />
          ) : loading ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {Array.from({ length: 8 }).map((_, index) => (
                <Skeleton key={index} className="h-[84px] w-full rounded-[14px]" />
              ))}
            </div>
          ) : artists.length ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {artists.map((artist) => (
                <button
                  key={artist.id}
                  type="button"
                  onClick={() =>
                    void navigate({
                      to: '/artist/$id',
                      params: { id: String(artist.id) },
                    })
                  }
                  className="group flex items-center gap-3 rounded-[14px] border border-black/8 bg-white/55 p-3 text-left transition-colors hover:bg-white/80"
                >
                  <ImageWithFallback
                    src={artist.picUrl}
                    alt={artist.name}
                    rounded="rounded-full"
                    className="h-14 w-14 shrink-0"
                    resize="128y128"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] text-black/75 group-hover:text-accent">
                      {artist.name}
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-black/35">
                      {artist.alias?.[0] ??
                        artist.transNames?.[0] ??
                        `${artist.albumSize ?? 0} 张专辑`}
                    </p>
                    <p className="mt-0.5 text-[11px] text-black/25">
                      {artist.albumSize ?? 0} 张专辑 · {artist.mvSize ?? 0} 个 MV
                    </p>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState title="没有找到相关歌手" />
          )}
          <Pager page={page} pageCount={pageCount} onChange={setPage} className="mt-6" />
        </TabsContent>
        <TabsContent value="mvs" className="mt-3">
          <div className="mb-2 text-[11px] text-black/35">共找到 {mvTotal} 个 MV</div>
          {failed ? (
            <EmptyState
              variant="error"
              title="MV 加载失败"
              description="请检查网络或本地 API 服务后重试"
              onRetry={retry}
            />
          ) : loading ? (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, index) => (
                <div key={index}>
                  <Skeleton className="aspect-video w-full rounded-[14px]" />
                  <Skeleton className="mt-2 h-3 w-3/5 rounded-full" />
                </div>
              ))}
            </div>
          ) : mvs.length ? (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
              {mvs.map((item, index) => (
                <VideoCard
                  key={`${item.kind}-${item.id}`}
                  item={item}
                  priority={index < 4}
                  onClick={() => openVideoItem(item)}
                />
              ))}
            </div>
          ) : (
            <EmptyState title="没有找到相关 MV" />
          )}
          <Pager page={page} pageCount={pageCount} onChange={setPage} className="mt-6" />
        </TabsContent>
        <TabsContent value="videos" className="mt-3">
          <div className="mb-2 text-[11px] text-black/35">共找到 {videoTotal} 个视频</div>
          {failed ? (
            <EmptyState
              variant="error"
              title="视频加载失败"
              description="请检查网络或本地 API 服务后重试"
              onRetry={retry}
            />
          ) : loading ? (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, index) => (
                <div key={index}>
                  <Skeleton className="aspect-video w-full rounded-[14px]" />
                  <Skeleton className="mt-2 h-3 w-3/5 rounded-full" />
                </div>
              ))}
            </div>
          ) : videos.length ? (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
              {videos.map((item, index) => (
                <VideoCard
                  key={`${item.kind}-${item.id}`}
                  item={item}
                  priority={index < 4}
                  onClick={() => openVideoItem(item)}
                />
              ))}
            </div>
          ) : (
            <EmptyState title="没有找到相关视频" />
          )}
          <Pager page={page} pageCount={pageCount} onChange={setPage} className="mt-6" />
        </TabsContent>

      </Tabs>
    </div>
  )
}
