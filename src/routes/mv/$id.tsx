import { useEffect, useRef, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { Trans } from '@lingui/react/macro'
import { ArrowLeft, CalendarDays, Eye, Play } from 'lucide-react'
import { Avatar, Skeleton } from '@pikoloo/darwin-ui'
import { ImageWithFallback } from '../../components/common/ImageWithFallback'
import { ArtistLinks } from '../../components/common/ArtistLinks'
import { EmptyState } from '../../components/common/EmptyState'
import { CommentSection } from '../../components/comments/CommentSection'
import { MvVideoPlayer } from '../../components/mv/MvVideoPlayer'
import {
  fetchArtistDetail,
  fetchMvDetail,
  fetchMvUrl,
  fetchSimilarMv,
} from '../../api'
import { formatDate, formatNumber } from '../../lib/format'
import { resizedImageUrl } from '../../lib/image'
import { useDocumentTitle } from '../../lib/title'
import { toast } from '../../lib/toast'
import { usePlayerStore } from '../../store/player'
import type { Mv } from '../../types'

export const Route = createFileRoute('/mv/$id')({
  component: MvDetailPage,
})

interface AuthorInfo {
  id: number
  name: string
  picUrl?: string
  briefDesc?: string
}

function MvDetailPage() {
  const { i18n } = useLingui()
  const { id } = Route.useParams()
  const navigate = useNavigate()
  const [detail, setDetail] = useState<Mv | null>(null)
  const [videoUrl, setVideoUrl] = useState('')
  const [similar, setSimilar] = useState<Mv[]>([])
  const [author, setAuthor] = useState<AuthorInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [videoLoading, setVideoLoading] = useState(true)
  useDocumentTitle(detail?.name ?? i18n._(msg`MV`))
  const resumeMusicRef = useRef(false)

  const resumeMusic = () => {
    if (!resumeMusicRef.current) return
    resumeMusicRef.current = false
    usePlayerStore.getState().setPlaying(true)
  }

  const handleVideoPlay = () => {
    const state = usePlayerStore.getState()
    if (!state.playing || !state.queue.length) return
    // Remember that we interrupted playback so it can be restored when the
    // video ends or the page is left.
    resumeMusicRef.current = true
    state.setPlaying(false)
  }

  useEffect(() => {
    // Leaving the MV page stops the video; restore the music that we paused.
    return () => {
      if (resumeMusicRef.current) {
        resumeMusicRef.current = false
        usePlayerStore.getState().setPlaying(true)
      }
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setVideoLoading(true)
    setDetail(null)
    setVideoUrl('')
    setSimilar([])
    setAuthor(null)

    fetchMvDetail(id)
      .then(async (mv) => {
        if (cancelled || !mv) return
        setDetail(mv)
        if (mv.artistId) {
          fetchArtistDetail(mv.artistId)
            .then((artist) => {
              if (!cancelled) setAuthor(artist)
            })
            .catch(() => undefined)
        }
      })
      .catch(() => {
        if (!cancelled) toast.error(i18n._(msg`MV 详情加载失败`))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    fetchMvUrl(id)
      .then((url) => {
        if (!cancelled) setVideoUrl(url)
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setVideoLoading(false)
      })

    fetchSimilarMv(id)
      .then((list) => {
        if (!cancelled) setSimilar(list)
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [id])

  if (loading) {
    return (
      <div className="px-8 pt-6">
        <Skeleton className="h-4 w-24 rounded-full" />
        <div className="mt-4 flex gap-6">
          <div className="flex-1">
            <Skeleton className="aspect-video w-full rounded-[18px]" />
            <Skeleton className="mt-5 h-6 w-2/5 rounded-full" />
            <Skeleton className="mt-3 h-3 w-1/4 rounded-full" />
          </div>
          <Skeleton className="h-[420px] w-[300px] rounded-[18px]" />
        </div>
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="px-8 pt-10">
        <EmptyState title={i18n._(msg`MV 不存在或无法访问`)} />
      </div>
    )
  }

  return (
    <div className="px-8 pb-16 pt-5">
      <button
        type="button"
        onClick={() => {
          // Return to wherever the user came from (search MV tab, latest MV,
          // artist page, etc.), not always the latest-MV listing.
          if (window.history.length > 1) {
            window.history.back()
          } else {
            // Direct link / no in-app history: fall back to Discover rather
            // than implying the MV always came from the latest-MV listing.
            void navigate({ to: '/' })
          }
        }}
        className="pressable flex items-center gap-1.5 rounded-full px-2 py-1 text-[11.5px] text-black/40 transition-colors hover:bg-black/5 hover:text-black/70"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        <Trans>返回</Trans>
      </button>

      <div className="mt-4 flex flex-col gap-7 lg:flex-row">
        <div className="min-w-0 flex-1">
          <div className="relative aspect-video w-full overflow-hidden rounded-[18px] bg-black">
            {videoLoading ? (
              <Skeleton className="h-full w-full rounded-[18px]" />
            ) : videoUrl ? (
              <MvVideoPlayer
                key={videoUrl}
                src={videoUrl}
                poster={resizedImageUrl(detail.cover, '640y360') ?? undefined}
                onPlay={handleVideoPlay}
                onEnded={resumeMusic}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-white/40">
                <Play className="h-8 w-8" />
                <span className="text-[12px]">暂无视频资源</span>
              </div>
            )}
          </div>

          <h1 className="headline-lg mt-5 text-[24px]">{detail.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-4 text-[11px] text-black/35">
            {detail.publishTime ? (
              <span className="flex items-center gap-1">
                <CalendarDays className="h-3 w-3" />
                {formatDate(detail.publishTime)}
              </span>
            ) : null}
            <span className="flex items-center gap-1">
              <Eye className="h-3 w-3" />
              {formatNumber(detail.playCount)} 次播放
            </span>
            {detail.artists?.length ? (
              <span>
                <ArtistLinks artists={detail.artists} />
              </span>
            ) : null}
          </div>

          {author ? (
            <div className="mt-5 flex items-start gap-3 rounded-[18px] border border-black/8 bg-[#fafafc] p-4">
              <Avatar src={author.picUrl} alt={author.name} size="md" />
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-black/80">{author.name}</p>
                {author.briefDesc ? (
                  <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-black/40">
                    {author.briefDesc}
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="mt-8">
            <CommentSection
            type={1}
            resourceId={Number(detail.id)}
            title={i18n._(msg`MV 评论`)}
          />
          </div>
        </div>

        <aside className="w-full shrink-0 lg:w-[clamp(240px,24vw,300px)]">
          <p className="section-title text-[16px]">相关推荐</p>
          <div className="mt-3 flex flex-col gap-2.5">
            {similar.slice(0, 8).map((mv) => (
              <button
                key={mv.id}
                type="button"
                onClick={() => void navigate({ to: '/mv/$id', params: { id: String(mv.id) } })}
                className="group flex items-center gap-3 rounded-[14px] p-1.5 text-left transition-colors hover:bg-black/4"
              >
                <ImageWithFallback
                  src={mv.cover}
                  alt={mv.name}
                  rounded="rounded-[10px]"
                  className="aspect-video w-[112px] shrink-0"
                  resize="320y180"
                  imageClassName="transition-transform duration-500 group-hover:scale-105"
                />
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-[11.5px] leading-snug text-black/70 group-hover:text-accent">
                    {mv.name}
                  </p>
                  <p className="mt-1 truncate text-[11px] text-black/30">{mv.artistName}</p>
                </div>
              </button>
            ))}
            {!similar.length ? (
              <p className="py-6 text-center text-[11px] text-black/30">暂无相关推荐</p>
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  )
}
