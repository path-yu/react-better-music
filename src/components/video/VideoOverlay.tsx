import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Loader2, Play, RotateCcw } from 'lucide-react'
import { ImageWithFallback } from '../common/ImageWithFallback'
import { fetchMlogUrl, fetchMvUrl, fetchVideoUrl } from '../../api'
import { formatDuration, formatNumber } from '../../lib/format'
import { usePlayerStore } from '../../store/player'
import { useVideoStore } from '../../store/video'
import { cn } from '../../lib/format'

const EMPTY_TEXT = '暂无视频播放地址'

/**
 * Standalone video screen shared by search results and a song's related
 * videos. The frame follows the media's natural aspect ratio, so portrait Mlog
 * clips and landscape MVs both play without being cropped.
 */
export function VideoOverlay() {
  const open = useVideoStore((state) => state.open)
  const source = useVideoStore((state) => state.source)
  const playlist = useVideoStore((state) => state.playlist)
  const playVideo = useVideoStore((state) => state.playVideo)
  const closeVideo = useVideoStore((state) => state.closeVideo)

  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const resumeMusicRef = useRef(false)

  const stopAndRestoreMusic = useCallback(() => {
    closeVideo()
    if (!resumeMusicRef.current) return
    resumeMusicRef.current = false
    usePlayerStore.getState().setPlaying(true)
  }, [closeVideo])

  useEffect(() => {
    if (!open || !source) return
    const controller = new AbortController()
    setUrl('')
    setFailed(false)
    setSize(null)
    setLoading(true)
    const request =
      source.kind === 'mv'
        ? fetchMvUrl(source.id, controller.signal)
        : source.kind === 'video'
          ? fetchVideoUrl(source.id, controller.signal)
          : fetchMlogUrl(source.id, controller.signal)
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
  }, [open, source, attempt])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      stopAndRestoreMusic()
    }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, stopAndRestoreMusic])

  // Leaving the overlay (route change, app teardown) must not leave music paused.
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

  if (!open || !source) return null

  const portrait = Boolean(size && size.height > size.width)
  const frameStyle = !size
    ? { width: 'min(1080px, 84vw)', aspectRatio: '16 / 9' }
    : portrait
      ? {
          height: 'min(72vh, 760px)',
          maxWidth: '86vw',
          aspectRatio: `${size.width} / ${size.height}`,
        }
      : {
          width: 'min(1080px, 84vw)',
          maxHeight: '72vh',
          aspectRatio: `${size.width} / ${size.height}`,
        }

  return (
    <div
      className="fixed inset-0 z-[130] flex flex-col bg-black/95 text-white backdrop-blur-2xl"
      role="dialog"
      aria-modal="true"
      aria-label={source.title}
    >
      <div className="flex flex-none items-center gap-3 px-5 py-3.5">
        <button
          type="button"
          aria-label="关闭视频"
          title="关闭（Esc）"
          onClick={stopAndRestoreMusic}
          className="pressable flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white/75 transition-colors hover:bg-white/20 hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold">{source.title}</p>
          <p className="mt-0.5 truncate text-[11px] text-white/45">
            {source.artist || (source.kind === 'mv' ? 'MV' : '视频')}
            {source.playCount ? ` · ${formatNumber(source.playCount)} 次播放` : ''}
          </p>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-4 px-5 pb-5">
        <div className="flex min-w-0 flex-1 items-center justify-center">
          {loading ? (
            <div className="flex flex-col items-center gap-2.5 text-white/50">
              <Loader2 className="h-6 w-6 animate-spin" />
              <span className="text-[12px]">正在获取视频…</span>
            </div>
          ) : url ? (
            <div
              style={frameStyle}
              className="relative overflow-hidden rounded-[18px] bg-black shadow-[0_30px_90px_-20px_rgba(0,0,0,0.85)]"
            >
              <video
                key={url}
                src={url}
                poster={source.cover}
                controls
                autoPlay
                playsInline
                onLoadedMetadata={(event) => {
                  const video = event.currentTarget
                  if (video.videoWidth > 0 && video.videoHeight > 0) {
                    setSize({ width: video.videoWidth, height: video.videoHeight })
                  }
                }}
                onPlay={handlePlay}
                onEnded={handleEnded}
                className="h-full w-full bg-black object-contain"
              />
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 text-white/45">
              <Play className="h-8 w-8" />
              <p className="text-[12px]">{failed ? EMPTY_TEXT : '视频加载失败'}</p>
              <button
                type="button"
                onClick={() => setAttempt((value) => value + 1)}
                className="pressable flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-[11px] text-white/75 transition-colors hover:bg-white/20 hover:text-white"
              >
                <RotateCcw className="h-3 w-3" />
                重试
              </button>
            </div>
          )}
        </div>

        {playlist.length > 1 ? (
          <aside className="hidden w-[300px] shrink-0 flex-col lg:flex">
            <p className="flex-none px-1 text-[12px] font-medium text-white/55">
              相关视频 · {playlist.length}
            </p>
            <div className="mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto pr-1 [scrollbar-width:thin]">
              {playlist.map((item, index) => {
                const active = source.kind === item.kind && source.id === item.id
                return (
                  <button
                    key={`${item.kind}-${item.id}-${index}`}
                    type="button"
                    onClick={() => playVideo(item)}
                    className={cn(
                      'group flex w-full items-center gap-2.5 rounded-[12px] p-2 text-left transition-colors',
                      active ? 'bg-white/15' : 'hover:bg-white/10',
                    )}
                  >
                    <div className="relative w-[104px] shrink-0">
                      <ImageWithFallback
                        src={item.cover}
                        alt={item.title}
                        rounded="rounded-[8px]"
                        resize="240y135"
                        className="aspect-video w-full"
                      />
                      {item.duration ? (
                        <span className="absolute bottom-1 right-1 rounded bg-black/50 px-1 text-[10px] tabular-nums text-white/90">
                          {formatDuration(item.duration)}
                        </span>
                      ) : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          'line-clamp-2 text-[11.5px] leading-snug',
                          active ? 'text-accent' : 'text-white/75 group-hover:text-white',
                        )}
                      >
                        {item.title}
                      </p>
                      <p className="mt-1 truncate text-[10.5px] text-white/35">
                        {item.artist || (item.kind === 'mv' ? 'MV' : '视频')}
                      </p>
                    </div>
                  </button>
                )
              })}
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  )
}
