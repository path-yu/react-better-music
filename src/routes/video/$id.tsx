import { useEffect, useRef, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { Trans } from '@lingui/react/macro'
import { ArrowLeft, Loader2, Play, RotateCcw } from 'lucide-react'
import { fetchMlogUrl, fetchVideoUrl } from '../../api'
import { CommentSection } from '../../components/comments/CommentSection'
import { MvVideoPlayer } from '../../components/mv/MvVideoPlayer'
import { formatDuration } from '../../lib/format'
import { resizedImageUrl } from '../../lib/image'
import { useDocumentTitle } from '../../lib/title'
import { usePlayerStore } from '../../store/player'

export const Route = createFileRoute('/video/$id')({
  validateSearch: (search: Record<string, unknown>) => ({
    kind: search.kind === 'mlog' ? ('mlog' as const) : ('video' as const),
    title: typeof search.title === 'string' ? search.title : '',
    cover: typeof search.cover === 'string' ? search.cover : '',
    artist: typeof search.artist === 'string' ? search.artist : '',
    duration: Number(search.duration) || 0,
  }),
  component: VideoPage,
})

/**
 * Full-page player for user videos and Mlog clips. Official MVs keep their own
 * `/mv/$id` page; this one mirrors it but follows the clip's natural orientation
 * so portrait uploads are not forced into a 16:9 frame.
 */
function VideoPage() {
  const { i18n } = useLingui()
  const { id } = Route.useParams()
  const { kind, title, cover, artist, duration } = Route.useSearch()
  const navigate = useNavigate()
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const resumeMusicRef = useRef(false)
  useDocumentTitle(
    title || (kind === 'mlog' ? 'Mlog' : i18n._(msg`视频`)),
  )

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setFailed(false)
    setUrl('')
    const request =
      kind === 'mlog' ? fetchMlogUrl(id, controller.signal) : fetchVideoUrl(id, controller.signal)
    request
      .then((nextUrl) => {
        if (controller.signal.aborted) return
        setUrl(nextUrl)
        setFailed(!nextUrl)
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [id, kind, attempt])

  // Leaving the page must not leave the music paused behind the video.
  useEffect(() => {
    return () => {
      if (!resumeMusicRef.current) return
      resumeMusicRef.current = false
      usePlayerStore.getState().setPlaying(true)
    }
  }, [])

  const handlePlay = () => {
    const state = usePlayerStore.getState()
    if (!state.playing) return
    resumeMusicRef.current = true
    state.setPlaying(false)
  }

  const handleEnded = () => {
    if (!resumeMusicRef.current) return
    resumeMusicRef.current = false
    usePlayerStore.getState().setPlaying(true)
  }

  const goBack = () => {
    if (window.history.length > 1) {
      window.history.back()
      return
    }
    void navigate({ to: '/' })
  }



  return (
    <div className="px-8 pb-16 pt-5">
      <button
        type="button"
        onClick={goBack}
        className="pressable flex items-center gap-1.5 rounded-full px-2 py-1 text-[11.5px] text-black/40 transition-colors hover:bg-black/5 hover:text-black/70"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        <Trans>返回</Trans>
      </button>

      <div className="mt-4 flex flex-col gap-6">
        <div className="flex min-h-[260px] items-center justify-center rounded-[20px] bg-[#0b0b0d] p-3">
          {loading ? (
            <div className="flex flex-col items-center gap-2.5 text-white/50">
              <Loader2 className="h-6 w-6 animate-spin" />
              <span className="text-[12px]">
                <Trans>正在获取视频…</Trans>
              </span>
            </div>
          ) : url ? (
            <div className="w-full overflow-hidden rounded-[16px] bg-black">
              <MvVideoPlayer
                key={url}
                src={url}
                poster={resizedImageUrl(cover, '640y360') ?? undefined}
                autoPlay
                onPlay={handlePlay}
                onEnded={handleEnded}
              />
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 text-white/45">
              <Play className="h-8 w-8" />
              <p className="text-[12px]">
                {failed ? (
                  <Trans>暂无视频播放地址</Trans>
                ) : (
                  <Trans>视频加载失败</Trans>
                )}
              </p>
              <button
                type="button"
                onClick={() => setAttempt((value) => value + 1)}
                className="pressable flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-[11px] text-white/75 transition-colors hover:bg-white/20 hover:text-white"
              >
                <RotateCcw className="h-3 w-3" />
                <Trans>重试</Trans>
              </button>
            </div>
          )}
        </div>

        <div>
          <p className="eyebrow">{kind === 'mlog' ? 'Mlog' : <Trans>视频</Trans>}</p>
          <h1 className="headline-lg mt-1 text-[24px]">
            {title || i18n._(msg`视频`)}
          </h1>
          <p className="mt-2 text-[12px] text-black/40">
            {artist || i18n._(msg`网易云音乐`)}
            {duration ? ` · ${formatDuration(duration)}` : ''}
          </p>
        </div>

        <div>
          <CommentSection
            type={1}
            resourceId={Number(id)}
            title={i18n._(msg`视频评论`)}
          />
        </div>
      </div>
    </div>
  )
}
