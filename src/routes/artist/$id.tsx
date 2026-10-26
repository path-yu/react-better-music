import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { ChevronDown, Disc3, Music2, Video } from 'lucide-react'
import { Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from '@pikoloo/darwin-ui'
import { ImageWithFallback } from '../../components/common/ImageWithFallback'
import { EmptyState } from '../../components/common/EmptyState'
import { MvCard } from '../../components/cards/MvCard'
import { PlayAllButton } from '../../components/songs/PlayAllButton'
import { SongTable } from '../../components/songs/SongTable'
import {
  fetchArtistAlbums,
  fetchArtistMvs,
  fetchArtistProfile,
  fetchArtistTopSongs,
  fetchSimilarArtists,
} from '../../api'
import { cn, formatDate, formatNumber } from '../../lib/format'
import { useDocumentTitle } from '../../lib/title'
import { toast } from '../../lib/toast'
import type { ArtistAlbum, ArtistProfile, ArtistSummary, Mv, Song } from '../../types'

export const Route = createFileRoute('/artist/$id')({
  component: ArtistPage,
})

const BIO_PREVIEW_HEIGHT = 75

function ArtistPage() {
  const { id } = Route.useParams()
  const navigate = useNavigate()
  const [profile, setProfile] = useState<ArtistProfile | null>(null)
  const [songs, setSongs] = useState<Song[]>([])
  const [albums, setAlbums] = useState<ArtistAlbum[]>([])
  const [mvs, setMvs] = useState<Mv[]>([])
  const [similar, setSimilar] = useState<ArtistSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('songs')
  const [bioExpanded, setBioExpanded] = useState(false)
  const [bioHeight, setBioHeight] = useState(0)
  const bioTextRef = useRef<HTMLParagraphElement>(null)
  useDocumentTitle(profile?.name ?? '歌手')

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false
    setLoading(true)
    setProfile(null)
    setSongs([])
    setAlbums([])
    setMvs([])
    setSimilar([])
    setBioExpanded(false)
    setBioHeight(0)

    Promise.allSettled([
      fetchArtistProfile(id, controller.signal),
      fetchArtistTopSongs(id, controller.signal),
      fetchArtistAlbums(id, 30, 0, controller.signal),
      fetchArtistMvs(id, 12, 0, controller.signal),
      fetchSimilarArtists(id, controller.signal),
    ])
      .then((results) => {
        if (cancelled) return
        const [artistResult, songsResult, albumsResult, mvsResult, similarResult] = results
        if (artistResult.status === 'fulfilled') setProfile(artistResult.value)
        if (songsResult.status === 'fulfilled') setSongs(songsResult.value)
        if (albumsResult.status === 'fulfilled') setAlbums(albumsResult.value)
        if (mvsResult.status === 'fulfilled') setMvs(mvsResult.value)
        if (similarResult.status === 'fulfilled') setSimilar(similarResult.value)
        if (results.some((result) => result.status === 'rejected')) {
          toast.error('部分歌手信息加载失败')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [id])

  useLayoutEffect(() => {
    const element = bioTextRef.current
    if (!element) return
    const measure = () => setBioHeight(element.scrollHeight)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [profile?.briefDesc])

  if (loading) {
    return (
      <div className="px-8 pb-16 pt-6">
        <div className="flex flex-col items-center gap-6 rounded-[20px] border border-black/8 bg-white/55 p-6 md:flex-row md:items-end">
          <Skeleton className="h-[168px] w-[168px] rounded-full" />
          <div className="flex-1 space-y-3">
            <Skeleton className="h-3 w-16 rounded-full" />
            <Skeleton className="h-8 w-2/5 rounded-full" />
            <Skeleton className="h-3 w-3/5 rounded-full" />
            <Skeleton className="h-3 w-4/5 rounded-full" />
          </div>
        </div>
        <Skeleton className="mt-6 h-[420px] w-full rounded-[16px]" />
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="px-8 pt-10">
        <EmptyState title="歌手不存在或无法访问" />
      </div>
    )
  }

  const aliasLine = [...(profile.transNames ?? []), ...(profile.alias ?? [])]
    .filter(Boolean)
    .join(' / ')
  const playlistId = `artist-${id}`

  return (
    <div className="px-8 pb-16 pt-6">
      <div className="rounded-[20px] border border-black/8 bg-white/55 p-6 backdrop-blur-xl">
        <div className="flex flex-col items-center gap-6 md:flex-row md:items-end">
          <ImageWithFallback
            src={profile.cover ?? profile.picUrl}
            alt={profile.name}
            rounded="rounded-full"
            className="artwork-shadow h-[168px] w-[168px] shrink-0"
            resize="400y400"
          />
          <div className="min-w-0 flex-1 text-center md:text-left">
            <span className="eyebrow">歌手</span>
            <h1 className="headline-lg mt-1.5 text-[32px]">{profile.name}</h1>
            {aliasLine ? (
              <p className="mt-1 text-[12px] text-black/45">{aliasLine}</p>
            ) : null}

            {profile.identities?.length ? (
              <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5 md:justify-start">
                {profile.identities.map((identity) => (
                  <span
                    key={identity}
                    className="rounded-full border border-black/8 bg-white/60 px-2 py-0.5 text-[10px] text-black/45"
                  >
                    {identity}
                  </span>
                ))}
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[11px] text-black/40 md:justify-start">
              <span className="flex items-center gap-1.5">
                <Music2 className="h-3.5 w-3.5" />
                {formatNumber(profile.musicSize)} 首单曲
              </span>
              <span className="flex items-center gap-1.5">
                <Disc3 className="h-3.5 w-3.5" />
                {formatNumber(profile.albumSize)} 张专辑
              </span>
              <span className="flex items-center gap-1.5">
                <Video className="h-3.5 w-3.5" />
                {formatNumber(profile.mvSize)} 个 MV
              </span>
              {profile.rank?.rank ? (
                <span className="rounded-full bg-[#0066cc]/8 px-2 py-0.5 text-[10px] text-[#0066cc]">
                  歌手榜 No.{profile.rank.rank}
                </span>
              ) : null}
            </div>

            {profile.briefDesc ? (
              <div className="mt-4 max-w-[860px]">
                <p className="eyebrow text-left">歌手简介</p>
                <div
                  className="mt-1.5 overflow-hidden transition-[height] duration-300 ease-in-out motion-reduce:transition-none"
                  style={{
                    height: bioHeight
                      ? bioHeight > BIO_PREVIEW_HEIGHT && !bioExpanded
                        ? BIO_PREVIEW_HEIGHT
                        : bioHeight
                      : undefined,
                  }}
                >
                  <p
                    ref={bioTextRef}
                    className="whitespace-pre-wrap text-left text-[11.5px] leading-relaxed text-black/40"
                  >
                    {profile.briefDesc}
                  </p>
                </div>
                {bioHeight > BIO_PREVIEW_HEIGHT ? (
                  <button
                    type="button"
                    aria-expanded={bioExpanded}
                    onClick={() => setBioExpanded((value) => !value)}
                    className="mt-1.5 inline-flex items-center gap-1 text-[10.5px] text-[#0066cc] transition-colors hover:text-[#0071e3]"
                  >
                    {bioExpanded ? '收起' : '展开全部'}
                    <ChevronDown
                      className={cn(
                        'h-3 w-3 transition-transform duration-300',
                        bioExpanded && 'rotate-180',
                      )}
                    />
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="mt-6">
        <div className="flex items-center justify-between gap-3 border-b border-black/8 pb-2">
          <TabsList>
            <TabsTrigger value="songs">热门作品</TabsTrigger>
            <TabsTrigger value="albums">专辑</TabsTrigger>
            <TabsTrigger value="mvs">MV</TabsTrigger>
          </TabsList>
          {tab === 'songs' && songs.length ? (
            <PlayAllButton songs={songs} playlistId={playlistId} label="播放热门歌曲" />
          ) : null}
        </div>

        <TabsContent value="songs" className="mt-3">
          <div className="mb-2 text-[11px] text-black/35">共 {songs.length} 首热门单曲</div>
          <SongTable
            songs={songs}
            playlistId={playlistId}
            emptyText="暂无热门单曲"
          />
        </TabsContent>

        <TabsContent value="albums" className="mt-3">
          {albums.length ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {albums.map((album) => (
                <div key={album.id} className="apple-card p-2.5">
                  <ImageWithFallback
                    src={album.picUrl}
                    alt={album.name}
                    rounded="rounded-[9px]"
                    className="aspect-square w-full"
                    resize="240y240"
                  />
                  <p className="mt-2 line-clamp-2 text-[12px] leading-[1.4] text-black/75">
                    {album.name}
                  </p>
                  <p className="mt-1 text-[10px] text-black/30">
                    {formatDate(album.publishTime).slice(0, 4)}
                    {album.size ? ` · ${album.size} 首` : ''}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="暂无专辑" />
          )}
        </TabsContent>

        <TabsContent value="mvs" className="mt-3">
          {mvs.length ? (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
              {mvs.map((mv) => (
                <MvCard key={mv.id} mv={mv} />
              ))}
            </div>
          ) : (
            <EmptyState title="暂无相关 MV" />
          )}
        </TabsContent>
      </Tabs>

      {similar.length ? (
        <section className="mt-10">
          <p className="section-title text-[16px]">相似歌手</p>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {similar.slice(0, 8).map((artist) => (
              <button
                key={artist.id}
                type="button"
                onClick={() =>
                  void navigate({ to: '/artist/$id', params: { id: String(artist.id) } })
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
                  <p className="truncate text-[12.5px] text-black/75 group-hover:text-[#0066cc]">
                    {artist.name}
                  </p>
                  <p className="mt-0.5 truncate text-[10.5px] text-black/35">
                    {artist.alias?.[0] ??
                      artist.transNames?.[0] ??
                      (artist.fansCount ? `${formatNumber(artist.fansCount)} 粉丝` : '相似歌手')}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}
