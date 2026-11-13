import { useState } from 'react'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import {
  Ellipsis,
  ListMusic,
  Loader2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Sparkles,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { Popover, PopoverTrigger } from '@pikoloo/darwin-ui'
import { cn, formatDuration } from '../../lib/format'
import { seekAudio } from '../../lib/audio'
import { usePlayerStore } from '../../store/player'
import { useVideoPlaybackStore } from '../../store/videoPlayback'
import { MorePlaybackOptions } from './MorePlaybackOptions'
import { ProgressSlider } from './ProgressSlider'

import {
  TRANSPORT_PAUSE_ICON,
  TRANSPORT_PLAY_ICON,
} from './transportIcons'

/**
 * Primary transport under the album art. The secondary utility cluster also
 * lives here so the detail page does not need an almost-empty bottom bar.
 */
export function NowPlayingTransport({
  className,
  onOpenRelatedVideos,
  videoLoading = false,
}: {
  className?: string
  onOpenRelatedVideos?: () => void
  videoLoading?: boolean
}) {
  const { i18n } = useLingui()
  const queue = usePlayerStore((state) => state.queue)
  const currentIndex = usePlayerStore((state) => state.currentIndex)
  const currentSong = queue[currentIndex]
  const playing = usePlayerStore((state) => state.playing)
  const currentTime = usePlayerStore((state) => state.currentTime)
  const mode = usePlayerStore((state) => state.mode)
  const volume = usePlayerStore((state) => state.volume)
  const heartMode = usePlayerStore((state) => state.heartMode)
  const heartLoading = usePlayerStore((state) => state.heartLoading)
  const togglePlay = usePlayerStore((state) => state.togglePlay)
  const next = usePlayerStore((state) => state.next)
  const prev = usePlayerStore((state) => state.prev)
  const cycleMode = usePlayerStore((state) => state.cycleMode)
  const toggleHeartMode = usePlayerStore((state) => state.toggleHeartMode)
  const toggleQueue = usePlayerStore((state) => state.toggleQueue)
  const setCurrentTime = usePlayerStore((state) => state.setCurrentTime)
  const setVolume = usePlayerStore((state) => state.setVolume)

  const videoActive = useVideoPlaybackStore((state) => state.active)
  const videoPlaying = useVideoPlaybackStore((state) => state.playing)
  const videoTime = useVideoPlaybackStore((state) => state.currentTime)
  const videoDuration = useVideoPlaybackStore((state) => state.duration)
  const toggleVideo = useVideoPlaybackStore((state) => state.toggle)

  const [moreOpen, setMoreOpen] = useState(false)

  if (!currentSong) return null

  const playbackPlaying = videoActive ? videoPlaying : playing
  const durationMs = videoActive ? videoDuration * 1000 : currentSong.dt || 0
  const playbackMs = videoActive ? videoTime * 1000 : currentTime * 1000
  const percent = durationMs
    ? Math.min(100, Math.max(0, (playbackMs / durationMs) * 100))
    : 0
  const clock = (ms: number) =>
    formatDuration(Math.max(0, ms)).replace(/^0(?=\d:)/, '')
  const modeIcon =
    mode === 'random' ? (
      <Shuffle className="h-[18px] w-[18px]" />
    ) : mode === 'singleLoop' ? (
      <Repeat1 className="h-[18px] w-[18px]" />
    ) : (
      <Repeat className="h-[18px] w-[18px]" />
    )

  const seek = (value: number) => {
    if (!durationMs) return
    const seconds = (value / 100) * (durationMs / 1000)
    if (videoActive) {
      useVideoPlaybackStore.getState().seek(seconds)
    } else {
      seekAudio(seconds)
      setCurrentTime(seconds)
    }
  }

  return (
    <div
      className={cn(
        'flex w-full flex-col items-center gap-2 text-white',
        className,
      )}
    >
      <div className="order-2 flex w-full items-center justify-center gap-4">
        <button
          type="button"
          title={heartMode ? i18n._(msg`关闭心动模式`) : i18n._(msg`心动模式`)}
          aria-label={i18n._(msg`心动模式`)}
          aria-pressed={heartMode}
          disabled={heartLoading}
          onClick={() => void toggleHeartMode()}
          className={cn(
            'pressable flex h-7 w-7 items-center justify-center transition-colors disabled:opacity-50',
            heartMode
              ? 'text-[#ff2d55]'
              : 'text-white/45 hover:text-white/80',
          )}
        >
          {heartLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
        </button>
        <button
          type="button"
          title={
            mode === 'order'
              ? i18n._(msg`顺序播放`)
              : mode === 'random'
                ? i18n._(msg`随机播放`)
                : i18n._(msg`单曲循环`)
          }
          onClick={cycleMode}
          className={cn(
            'pressable flex h-7 w-7 items-center justify-center transition-colors',
            mode === 'order'
              ? 'text-white/45 hover:text-white/80'
              : 'text-white/80 hover:text-white',
          )}
        >
          {modeIcon}
        </button>
        <button
          type="button"
          aria-label={i18n._(msg`上一首`)}
          onClick={() => void prev()}
          className="pressable flex h-7 w-7 items-center justify-center text-white/80 hover:text-white"
        >
          <SkipBack className="h-5 w-5 fill-current" />
        </button>
        <button
          type="button"
          aria-label={playbackPlaying ? i18n._(msg`暂停`) : i18n._(msg`播放`)}
          onClick={() => {
            if (videoActive) toggleVideo()
            else void togglePlay()
          }}
          className="pressable flex h-11 w-11 items-center justify-center rounded-full text-white hover:text-white/80"
        >
          {playbackPlaying ? (
            <Pause className={TRANSPORT_PAUSE_ICON} />
          ) : (
            <Play className={TRANSPORT_PLAY_ICON} />
          )}
        </button>
        <button
          type="button"
          aria-label={i18n._(msg`下一首`)}
          onClick={() => void next()}
          className="pressable flex h-7 w-7 items-center justify-center text-white/80 hover:text-white"
        >
          <SkipForward className="h-5 w-5 fill-current" />
        </button>
        <button
          type="button"
          onClick={() => toggleQueue()}
          className="pressable flex h-7 w-7 items-center justify-center rounded-full text-white/45 transition-colors hover:bg-white/10 hover:text-white/80"
          title={i18n._(msg`播放列表`)}
          aria-label={i18n._(msg`播放列表`)}
        >
          <ListMusic className="h-4 w-4" />
        </button>
        <Popover
          open={moreOpen}
          onOpenChange={setMoreOpen}
        >
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={i18n._(msg`更多播放选项`)}
              title={i18n._(msg`更多播放选项`)}
              className="pressable flex h-7 w-7 items-center justify-center rounded-full text-white/45 transition-colors hover:bg-white/10 hover:text-white/80"
            >
              <Ellipsis className="h-4 w-4" />
            </button>
          </PopoverTrigger>
          <MorePlaybackOptions
            immersive
            submenuSide="right"
            onClose={() => setMoreOpen(false)}
            onOpenRelatedVideos={onOpenRelatedVideos}
            videoLoading={videoLoading}
          />
        </Popover>
      </div>

      {!videoActive ? (
        <div className="order-1 w-full">
          <ProgressSlider
            value={percent}
            onChange={seek}
            immersive
            valueText={`${clock(playbackMs)} / ${clock(durationMs)}`}
          />
          {/* Apple places the clock under the scrubber so the line itself can
              use the full width of the artwork column. */}
          <div className="mt-0.5 flex items-center justify-between px-0.5 text-[10.5px] tabular-nums text-white/45">
            <span>{clock(playbackMs)}</span>
            <span>-{clock(durationMs - playbackMs)}</span>
          </div>
        </div>
      ) : null}

      {/* Apple Music-style standalone volume scrubber. */}
      <div className="order-3 flex w-full items-center gap-2.5">
        <span className="flex w-4 shrink-0 items-center justify-center text-white/45">
          {volume === 0 ? (
            <VolumeX className="h-3.5 w-3.5" />
          ) : volume < 45 ? (
            <Volume1 className="h-3.5 w-3.5" />
          ) : (
            <Volume2 className="h-3.5 w-3.5" />
          )}
        </span>
        <ProgressSlider
          value={volume}
          onChange={setVolume}
          immersive
          ariaLabel={i18n._(msg`音量`)}
        />
      </div>

    </div>
  )
}
