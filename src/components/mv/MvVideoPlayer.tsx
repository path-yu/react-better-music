import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { Trans } from '@lingui/react/macro'
import { I18nProvider } from '@videojs/react/i18n'
import { Video, VideoPlayer, VideoSkin } from '@videojs/react/video'
import '@videojs/react/video/skin.css'
import { cn } from '../../lib/format'
import { usePlayerStore } from '../../store/player'
import { useVideoPlaybackStore } from '../../store/videoPlayback'

interface MvVideoPlayerProps {
  src: string
  /** NetEase MV id, used to remember/restore the playback position. */
  videoId?: number | string
  poster?: string
  autoPlay?: boolean
  /** Fill the parent box instead of enforcing a 16:9 aspect ratio. */
  fill?: boolean
  onPlay?: () => void
  onEnded?: () => void
  /** Fired once the browser has enough data to start playback. */
  onReady?: () => void
  onError?: () => void
}

type MvProgressMap = Record<string, { time: number; at: number }>
const MV_PROGRESS_KEY = 'react-music-mv-progress'

function readMvProgressMap(): MvProgressMap {
  try {
    const raw = localStorage.getItem(MV_PROGRESS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as MvProgressMap
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function saveMvProgress(
  videoId: number | string | undefined,
  time: number,
) {
  if (!videoId || !Number.isFinite(time) || time < 1) return
  try {
    const key = String(videoId)
    const map = readMvProgressMap()
    map[key] = { time: Math.floor(time), at: Date.now() }
    // Keep recent MVs only; this is a convenience, not a full watch history.
    const entries = Object.entries(map)
      .sort(([, left], [, right]) => right.at - left.at)
      .slice(0, 100)
    localStorage.setItem(MV_PROGRESS_KEY, JSON.stringify(Object.fromEntries(entries)))
  } catch {
    // storage may be unavailable
  }
}

function readMvProgress(videoId: number | string | undefined) {
  if (!videoId) return null
  const saved = readMvProgressMap()[String(videoId)]
  const time = Number(saved?.time)
  return Number.isFinite(time) && time >= 1 ? time : null
}

function clearMvProgress(videoId: number | string | undefined) {
  if (!videoId) return
  try {
    const map = readMvProgressMap()
    delete map[String(videoId)]
    localStorage.setItem(MV_PROGRESS_KEY, JSON.stringify(map))
  } catch {
    // storage may be unavailable
  }
}

/**
 * Video.js 10 skin tuned to the app's macOS look: frosted control bar, Apple
 * blue accent and the same 16px radius / font stack as the rest of the UI.
 * The packaged skin only exposes CSS custom properties, see
 * https://videojs.org/docs/framework/react/guides/customize-skins
 *
 * The skin ships a dark-only palette, so the light-mode tokens are remapped in
 * `src/styles.css` (search for "Video.js 10 player skin").
 */
const skinStyle = {
  width: '100%',
  aspectRatio: '16 / 9',
  '--media-accent-color': 'var(--apple-blue)',
  // Set explicitly: `contrast-color()` is not available in older WebViews.
  '--media-accent-text-color': '#ffffff',
  '--media-border-color': 'transparent',
  '--media-border-radius': '16px',
  '--media-font-family': 'var(--font-apple)',
  // `contain` keeps 4:3 MVs from being cropped; the shell is already 16:9.
  '--media-object-fit': 'contain',
} as CSSProperties

export function MvVideoPlayer({
  src,
  videoId,
  poster,
  autoPlay = false,
  fill = false,
  onPlay,
  onEnded,
  onReady,
  onError,
}: MvVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const shellRef = useRef<HTMLDivElement | null>(null)
  const [failed, setFailed] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [controlsVisible, setControlsVisible] = useState(true)
  const playingRef = useRef(false)
  const hideTimerRef = useRef<number | null>(null)

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
  }, [])

  const showControls = useCallback(() => {
    setControlsVisible(true)
    clearHideTimer()
    // Read the real media element as well as React state. Fast Refresh can
    // remount this component while the existing <video> keeps playing, which
    // used to leave `playingRef` false and stop the idle timer.
    const video = shellRef.current?.querySelector<HTMLVideoElement>('video')
    const isPlaying = video
      ? !video.paused && !video.ended
      : playingRef.current
    if (isPlaying) {
      hideTimerRef.current = window.setTimeout(() => {
        setControlsVisible(false)
      }, 800)
    }
  }, [clearHideTimer])

  useEffect(() => {
    playingRef.current = playing
    if (!playing) {
      clearHideTimer()
      setControlsVisible(true)
      return
    }
    showControls()
  }, [playing, showControls, clearHideTimer])

  // Restore the remembered position once the media is seekable. Without this,
  // returning from an artist page reloads the MV at 0 and autoplays from the top.
  useEffect(() => {
    if (!videoId) return
    const video = shellRef.current?.querySelector<HTMLVideoElement>('video')
    if (!video) return

    const onLoadedMetadata = () => {
      const target = readMvProgress(videoId)
      if (!target) return
      // Don't replay the final seconds as though they were unfinished.
      if (
        Number.isFinite(video.duration) &&
        video.duration > 0 &&
        target > video.duration - 2
      ) {
        return
      }
      video.currentTime = target
    }

    video.addEventListener('loadedmetadata', onLoadedMetadata)
    return () => video.removeEventListener('loadedmetadata', onLoadedMetadata)
  }, [videoId])

  // Save progress while playing, on pause, and when the tab/page is hidden.
  useEffect(() => {
    if (!videoId) return
    const video = shellRef.current?.querySelector<HTMLVideoElement>('video')
    if (!video) return
    let lastSavedAt = 0

    const save = () => saveMvProgress(videoId, video.currentTime)
    const onTimeUpdate = () => {
      const now = Date.now()
      if (now - lastSavedAt < 1000) return
      lastSavedAt = now
      save()
    }
    const onPause = () => save()
    const onEnded = () => clearMvProgress(videoId)
    const onPageHide = () => save()

    video.addEventListener('timeupdate', onTimeUpdate)
    video.addEventListener('pause', onPause)
    video.addEventListener('ended', onEnded)
    video.addEventListener('seeked', save)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      video.removeEventListener('timeupdate', onTimeUpdate)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('ended', onEnded)
      video.removeEventListener('seeked', save)
      window.removeEventListener('pagehide', onPageHide)
    }
  }, [videoId])

  // Closing the immersive page unmounts this player. Save first, then
  // explicitly stop the decoder; removing the DOM node alone can leave audio
  // playing.
  useEffect(
    () => () => {
      const video =
        videoRef.current ?? shellRef.current?.querySelector('video')
      if (video) {
        saveMvProgress(videoId, video.currentTime)
        video.pause()
        video.removeAttribute('src')
        video.load()
      }
      useVideoPlaybackStore.getState().setActive(false)
    },
    [videoId],
  )

  // Keep the local state in sync with the actual media element. This matters
  // in dev: HMR can recreate the component without replaying Video.js' onPlay,
  // even though the native video is still playing.
  useEffect(() => {
    const video = shellRef.current?.querySelector<HTMLVideoElement>('video')
    if (!video) return
    const onPlay = () => {
      playingRef.current = true
      setPlaying(true)
      showControls()
    }
    const onPause = () => {
      playingRef.current = false
      setPlaying(false)
      clearHideTimer()
      setControlsVisible(true)
    }
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('ended', onPause)
    // Autoplay may have started before this effect attached.
    if (!video.paused && !video.ended) {
      playingRef.current = true
      setPlaying(true)
      showControls()
    }
    return () => {
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('ended', onPause)
    }
  }, [showControls, clearHideTimer])

  useEffect(() => clearHideTimer, [clearHideTimer])

  useEffect(() => {
    setFailed(false)
    setPlaying(false)
    setControlsVisible(true)
    clearHideTimer()
  }, [src, clearHideTimer])

  // Audio is the other transport. If the playlist starts playing while this
  // MV is playing, stop the video and hand the player bar back to audio.
  useEffect(
    () =>
      usePlayerStore.subscribe((state, previous) => {
        if (!state.playing || previous.playing) return
        videoRef.current?.pause()
        useVideoPlaybackStore.getState().setActive(false)
      }),
    [],
  )

  // A dead CDN URL must never leave Video.js' raw MEDIA_ELEMENT_ERROR panel on
  // screen. This fallback is independent of the parent's error state.
  if (failed) {
    return (
      <div
        className={
          fill
            ? 'flex h-full w-full items-center justify-center bg-black px-6 text-center text-[12px] text-white/55'
            : 'flex aspect-video w-full items-center justify-center bg-black px-6 text-center text-[12px] text-white/55'
        }
      >
        <Trans>视频暂时无法播放，可能已下架或存在地区限制</Trans>
      </div>
    )
  }

  return (
    <div
      ref={shellRef}
      className={cn('mv-video-shell relative w-full', fill && 'h-full')}
      data-controls-hidden={!controlsVisible ? 'true' : undefined}
      onPointerMove={showControls}
      onPointerDown={showControls}
      onTouchStart={showControls}
      onKeyDown={showControls}
      onContextMenu={showControls}
    >
    <VideoPlayer>
      <I18nProvider locale="zh-CN">
        <VideoSkin
          style={
            fill
              ? ({
                  ...skinStyle,
                  height: '100%',
                  aspectRatio: 'auto',
                  '--media-frame-border': 'transparent',
                  '--media-video-border-radius': '0px',
                } as CSSProperties)
              : skinStyle
          }
        >
          <Video
            src={src}
            poster={poster}
            autoPlay={autoPlay}
            playsInline
            preload="metadata"
            onPlay={(event) => {
              videoRef.current = event.currentTarget
              setPlaying(true)
              // Any MV start (including autoplay and playback from the MV
              // detail page) must stop the playlist audio. Call the caller
              // first so its resume/ended bookkeeping still sees `playing`.
              onPlay?.()
              usePlayerStore.getState().setPlaying(false)
            }}
            onPause={() => setPlaying(false)}
            onEnded={() => {
              setPlaying(false)
              onEnded?.()
            }}
            onCanPlay={onReady}
            onError={() => {
              setPlaying(false)
              setFailed(true)
              onError?.()
            }}
          />
        </VideoSkin>
      </I18nProvider>
    </VideoPlayer>
    </div>
  )
}
