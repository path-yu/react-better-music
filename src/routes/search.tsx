import { useEffect, useMemo, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { ListMusic, Search } from 'lucide-react'
import { Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from '@pikoloo/darwin-ui'
import { ImageWithFallback } from '../components/common/ImageWithFallback'
import { EmptyState } from '../components/common/EmptyState'
import { Pager } from '../components/common/Pager'
import { SongTable } from '../components/songs/SongTable'
import { PlayAllButton } from '../components/songs/PlayAllButton'
import { searchAll } from '../api'
import { formatNumber } from '../lib/format'
import { useDocumentTitle } from '../lib/title'
import { toast } from '../lib/toast'
import type { ArtistSummary, Playlist, Song } from '../types'

export const Route = createFileRoute('/search')({
  validateSearch: (search: Record<string, unknown>) => ({
    keyword: typeof search.keyword === 'string' ? search.keyword : '',
  }),
  component: SearchPage,
})

const SONG_PAGE_SIZE = 30
const PLAYLIST_PAGE_SIZE = 20
const ARTIST_PAGE_SIZE = 20

function SearchPage() {
  const { keyword } = Route.useSearch()
  const navigate = useNavigate()
  useDocumentTitle(keyword.trim() ? `搜索「${keyword.trim()}」` : '搜索')
  const [tab, setTab] = useState('songs')
  const [page, setPage] = useState(1)
  const [songs, setSongs] = useState<Song[]>([])
  const [songTotal, setSongTotal] = useState(0)
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [playlistTotal, setPlaylistTotal] = useState(0)
  const [artists, setArtists] = useState<ArtistSummary[]>([])
  const [artistTotal, setArtistTotal] = useState(0)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setPage(1)
    setSongs([])
    setPlaylists([])
    setArtists([])
    setSongTotal(0)
    setPlaylistTotal(0)
    setArtistTotal(0)
  }, [keyword])

  useEffect(() => {
    if (!keyword.trim()) return
    const controller = new AbortController()
    setLoading(true)
    const pageSize =
      tab === 'songs'
        ? SONG_PAGE_SIZE
        : tab === 'artists'
          ? ARTIST_PAGE_SIZE
          : PLAYLIST_PAGE_SIZE
    searchAll(
      {
        keywords: keyword,
        type: tab === 'songs' ? '1' : tab === 'artists' ? '100' : '1000',
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
        } else {
          setPlaylists(result.playlists ?? [])
          setPlaylistTotal(result.playlistCount ?? 0)
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) toast.error('搜索失败')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [keyword, tab, page])

  const pageSize =
    tab === 'songs'
      ? SONG_PAGE_SIZE
      : tab === 'artists'
        ? ARTIST_PAGE_SIZE
        : PLAYLIST_PAGE_SIZE
  const total =
    tab === 'songs' ? songTotal : tab === 'artists' ? artistTotal : playlistTotal
  const pageCount = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [pageSize, total])

  if (!keyword.trim()) {
    return (
      <div className="px-8 pt-10">
        <EmptyState
          icon={<Search className="h-6 w-6" />}
          title="搜索音乐、歌单、歌手或 MV"
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

      <Tabs
        value={tab}
        onValueChange={(value) => {
          setTab(value)
          setPage(1)
        }}
        className="mt-5"
      >
        <div className="flex items-center justify-between gap-3 border-b border-black/8 pb-2">
          <TabsList>
            <TabsTrigger value="songs">单曲</TabsTrigger>
            <TabsTrigger value="playlists">歌单</TabsTrigger>
            <TabsTrigger value="artists">歌手</TabsTrigger>
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
        </TabsContent>

        <TabsContent value="playlists" className="mt-3">
          <div className="mb-2 text-[11px] text-black/35">
            共找到 {playlistTotal} 个歌单
          </div>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-[68px] w-full rounded-[12px]" />
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
                  className="group flex w-full items-center gap-3 rounded-[12px] px-2 py-2 text-left transition-colors hover:bg-black/4"
                >
                  <ImageWithFallback
                    src={playlist.coverImgUrl}
                    alt={playlist.name}
                    rounded="rounded-[8px]"
                    className="h-14 w-14 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-1 text-[12.5px] text-black/75 group-hover:text-[#0066cc]">
                      {playlist.name}
                    </p>
                    <p className="mt-1 flex items-center gap-2 text-[10.5px] text-black/30">
                      <span>{playlist.trackCount} 首</span>
                      <span>by {playlist.creator?.nickname}</span>
                    </p>
                  </div>
                  <span className="flex shrink-0 items-center gap-1 text-[10.5px] text-black/30">
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
          {loading ? (
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
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] text-black/75 group-hover:text-[#0066cc]">
                      {artist.name}
                    </p>
                    <p className="mt-0.5 truncate text-[10.5px] text-black/35">
                      {artist.alias?.[0] ??
                        artist.transNames?.[0] ??
                        `${artist.albumSize ?? 0} 张专辑`}
                    </p>
                    <p className="mt-0.5 text-[10px] text-black/25">
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

      </Tabs>
    </div>
  )
}
