import { useEffect, useMemo, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Building2, CalendarDays } from 'lucide-react'
import {
  Button,
  Input,
  Skeleton,
} from '@pikoloo/darwin-ui'
import { ImageWithFallback } from '../../components/common/ImageWithFallback'
import { EmptyState } from '../../components/common/EmptyState'
import { ArtistLinks } from '../../components/common/ArtistLinks'
import { SongTable } from '../../components/songs/SongTable'
import { PlayAllButton } from '../../components/songs/PlayAllButton'
import { fetchAlbumDetail } from '../../api'
import type { AlbumDetail } from '../../types'
import { cn, formatDate, matchesKeyword } from '../../lib/format'
import { useDocumentTitle } from '../../lib/title'
import { toast } from '../../lib/toast'

export const Route = createFileRoute('/albums/$id')({
  component: AlbumDetailPage,
})

function AlbumDetailPage() {
  const { id } = Route.useParams()
  const navigate = useNavigate()
  const [album, setAlbum] = useState<AlbumDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [keyword, setKeyword] = useState('')
  const [descExpanded, setDescExpanded] = useState(false)
  useDocumentTitle(album?.name ?? '专辑')

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setAlbum(null)
    setKeyword('')
    setDescExpanded(false)

    void fetchAlbumDetail(id)
      .then((detail) => {
        if (!controller.signal.aborted) setAlbum(detail)
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          toast.error('专辑加载失败')
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [id])

  const songs = album?.songs ?? []

  const filteredSongs = useMemo(() => {
    if (!keyword.trim()) return songs
    return songs.filter((song) =>
      matchesKeyword(
        keyword,
        song.name,
        song.al?.name,
        song.ar.map((artist) => artist.name).join(' '),
      ),
    )
  }, [keyword, songs])

  if (loading) {
    return (
      <div className="px-8 pt-8">
        <div className="flex gap-6">
          <Skeleton className="h-[208px] w-[208px] rounded-[16px]" />
          <div className="flex-1">
            <Skeleton className="h-4 w-16 rounded-full" />
            <Skeleton className="mt-3 h-8 w-[42%] rounded-full" />
            <Skeleton className="mt-4 h-3 w-[260px] rounded-full" />
            <Skeleton className="mt-3 h-3 w-[70%] rounded-full" />
            <Skeleton className="mt-5 h-9 w-[200px] rounded-full" />
          </div>
        </div>
        <Skeleton className="mt-8 h-[300px] w-full rounded-[16px]" />
      </div>
    )
  }

  if (!album) {
    return (
      <div className="px-8 pt-10">
        <EmptyState
          title="专辑不存在或无法访问"
          action={
            <Button
              variant="primary"
              size="sm"
              className="rounded-full"
              onClick={() => window.history.back()}
            >
              返回上一页
            </Button>
          }
        />
      </div>
    )
  }

  const artists = album.artists?.length
    ? album.artists
    : album.artist
      ? [album.artist]
      : []
  const description = album.description || album.briefDesc

  return (
    <div className="px-8 pb-16 pt-7">
      <div className="flex gap-6">
        <ImageWithFallback
          src={album.picUrl}
          alt={album.name}
          rounded="rounded-[16px]"
          className="artwork-shadow h-[208px] w-[208px] shrink-0"
          resize="400y400"
        />
        <div className="min-w-0 flex-1">
          <span className="inline-flex items-center rounded-full bg-[#0066cc]/8 px-2.5 py-0.5 text-[10px] font-medium text-[#0066cc]">
            专辑
          </span>
          <h1 className="headline-lg mt-2.5 line-clamp-2 text-[28px]">{album.name}</h1>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11.5px] text-black/40">
            <ArtistLinks artists={artists} className="font-medium text-[#0066cc]" />
            {album.publishTime ? (
              <span className="flex items-center gap-1">
                <CalendarDays className="h-3 w-3" />
                {formatDate(album.publishTime)} 发行
              </span>
            ) : null}
            <span>{songs.length} 首歌曲</span>
            {album.company ? (
              <span className="flex items-center gap-1">
                <Building2 className="h-3 w-3" />
                {album.company}
              </span>
            ) : null}
          </div>

          {description ? (
            <div className="mt-2.5 max-w-[760px]">
              <p
                className={cn(
                  'whitespace-pre-wrap text-[11.5px] leading-relaxed text-black/40',
                  !descExpanded && 'line-clamp-2',
                )}
              >
                {description}
              </p>
              {description.length > 120 ? (
                <button
                  type="button"
                  className="mt-1 text-[10.5px] text-[#0066cc]"
                  onClick={() => setDescExpanded((value) => !value)}
                >
                  {descExpanded ? '收起' : '展开'}
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <PlayAllButton songs={songs} playlistId={`album-${album.id}`} />
            <Button
              variant="secondary"
              size="sm"
              className="rounded-full px-3.5 text-[12px]"
              onClick={() =>
                void navigate({
                  to: '/artist/$id',
                  params: {
                    id: String(artists[0]?.id ?? ''),
                  },
                })
              }
              disabled={!artists[0]?.id}
            >
              查看歌手
            </Button>
          </div>
        </div>
      </div>

      <div className="sticky top-0 z-20 -mx-8 mt-7 flex items-center justify-between gap-4 border-b border-black/8 bg-white/90 px-8 py-2 backdrop-blur-xl">
        <p className="text-[12px] font-medium text-black/70">
          歌曲列表
          <span className="ml-1 text-[10px] text-black/30">{songs.length}</span>
        </p>
        <Input.Search
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder="搜索专辑歌曲"
          size="sm"
          className="w-[190px] rounded-full text-[12px]"
        />
      </div>

      <div className="mt-3">
        <SongTable
          songs={filteredSongs}
          playlistId={`album-${album.id}`}
          emptyText={keyword ? '没有匹配的歌曲' : '专辑暂时没有歌曲'}
        />
      </div>
    </div>
  )
}
