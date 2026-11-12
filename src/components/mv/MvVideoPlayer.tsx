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
  poster,
  autoPlay = false,
  fill = false,
  onPlay,
  onEnded,
  onReady,
  onError,
}: MvVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
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
    if (playingRef.current) {
      hideTimerRef.current = window.setTimeout(() => {
        setControlsVisible(false)
      }, 1000)
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
