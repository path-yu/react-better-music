import { useState } from 'react'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { Trans } from '@lingui/react/macro'
import {
  AudioLines,
  Check,
  ChevronDown,
  Ellipsis,
  Heart,
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
import { usePlayerMenuTint } from '../../lib/menuSurface'
import { toast } from '../../lib/toast'
import {
  LYRIC_DISPLAY_OPTIONS,
  PLAY_QUALITY_OPTIONS,
  useSettingsStore,
} from '../../store/settings'
import { usePlayerStore } from '../../store/player'
import { useUserStore } from '../../store/user'
import { useLocalLibraryStore } from '../../store/localLibrary'
import { useVideoPlaybackStore } from '../../store/videoPlayback'
import type { PlayLevel } from '../../types'
import { ToggleSwitch } from '../common/ToggleSwitch'
import { ImmersiveProgressBar } from './ImmersiveProgressBar'
import { PlayerMenuContent } from './PlayerMenuContent'
import { PlaylistPicker } from './PlaylistPicker'
import { ProgressSlider } from './ProgressSlider'
import { SourcePicker } from './SourcePicker'
import { VolumeSlider } from './VolumeSlider'
import {
  TRANSPORT_PAUSE_ICON,
  TRANSPORT_PLAY_ICON,
} from './transportIcons'

/**
 * The song-detail transport. It reuses the player's transport widgets
 * (seeker, source/playlist menus, volume) but has its own Apple-Music-style
 * progress line and lives entirely inside NowPlaying. The external PlayerBar
 * stays mounted only as the audio engine while this view is open.
 */
export function ImmersivePlayerBar() {
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
  const setCurrentTime = usePlayerStore((state) => state.setCurrentTime)
  const togglePlay = usePlayerStore((state) => state.togglePlay)
  const next = usePlayerStore((state) => state.next)
  const prev = usePlayerStore((state) => state.prev)
  const cycleMode = usePlayerStore((state) => state.cycleMode)
  const toggleHeartMode = usePlayerStore((state) => state.toggleHeartMode)
  const toggleQueue = usePlayerStore((state) => state.toggleQueue)
  const toggleNowPlaying = usePlayerStore((state) => state.toggleNowPlaying)
  const setVolume = usePlayerStore((state) => state.setVolume)
  const invalidateUrls = usePlayerStore((state) => state.invalidateUrls)
  const refreshCurrentUrl = usePlayerStore((state) => state.refreshCurrentUrl)

  const playLevel = useSettingsStore((state) => state.playLevel)
  const setPlayLevel = useSettingsStore((state) => state.setPlayLevel)
  const lyricDisplayMode = useSettingsStore((state) => state.lyricDisplayMode)
  const setLyricDisplayMode = useSettingsStore(
    (state) => state.setLyricDisplayMode,
  )
  const wordByWordLyrics = useSettingsStore((state) => state.wordByWordLyrics)
  const setWordByWordLyrics = useSettingsStore(
    (state) => state.setWordByWordLyrics,
  )

  const isLogin = useUserStore((state) => state.isLogin)
  const likedIds = useUserStore((state) => state.likedIds)
  const likeSong = useUserStore((state) => state.likeSong)
  const localFavorites = useLocalLibraryStore((state) => state.favorites)
  const toggleLocalFavorite = useLocalLibraryStore(
    (state) => state.toggleFavorite,
  )

  const videoActive = useVideoPlaybackStore((state) => state.active)
  const videoPlaying = useVideoPlaybackStore((state) => state.playing)
  const videoTime = useVideoPlaybackStore((state) => state.currentTime)
  const videoDuration = useVideoPlaybackStore((state) => state.duration)
  const videoVolume = useVideoPlaybackStore((state) => state.volume)
  const toggleVideo = useVideoPlaybackStore((state) => state.toggle)
  const seekVideo = useVideoPlaybackStore((state) => state.seek)
  const setVideoVolume = useVideoPlaybackStore((state) => state.setVolume)

  const [qualityOpen, setQualityOpen] = useState(false)
  const tint = usePlayerMenuTint(true, currentSong?.al.picUrl)

  if (!currentSong) return null

  const liked = isLogin
    ? likedIds.includes(currentSong.id)
    : localFavorites.some((song) => song.id === currentSong.id)
  const playbackPlaying = videoActive ? videoPlaying : playing
  const durationMs = videoActive ? videoDuration * 1000 : currentSong.dt || 0
  const playbackMs = videoActive ? videoTime * 1000 : currentTime * 1000
  const percent = durationMs
    ? Math.min(100, Math.max(0, (playbackMs / durationMs) * 100))
    : 0
  const currentVolume = videoActive ? videoVolume : volume
  const clock = (ms: number) =>
    formatDuration(Math.max(0, ms)).replace(/^0(?=\d:)/, '')
  const qualityOption = PLAY_QUALITY_OPTIONS.find(
    (option) => option.value === playLevel,
  )
  const qualityLabel = qualityOption ? i18n._(qualityOption.label) : playLevel
  const modeIcon =
    mode === 'random' ? (
      <Shuffle className="h-[18px] w-[18px]" />
    ) : mode === 'singleLoop' ? (
      <Repeat1 className="h-[18px] w-[18px]" />
    ) : (
      <Repeat className="h-[18px] w-[18px]" />
    )

  const handleQualityChange = (level: PlayLevel) => {
    setQualityOpen(false)
    if (level === playLevel) return
    setPlayLevel(level)
    invalidateUrls()
    const option = PLAY_QUALITY_OPTIONS.find((item) => item.value === level)
    toast.info(
      i18n._(
        msg`播放音质已切换为${option ? i18n._(option.label) : level}，正在重新加载`,
      ),
    )
    void refreshCurrentUrl()
  }

  const seek = (value: number) => {
    if (!durationMs) return
    const seconds = (value / 100) * (durationMs / 1000)
    if (videoActive) seekVideo(seconds)
    else {
      seekAudio(seconds)
      setCurrentTime(seconds)
    }
  }

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-40">
      <div
        className="player-glass pointer-events-auto relative grid h-[76px] grid-cols-[minmax(0,1fr)_minmax(340px,560px)_minmax(0,1fr)] items-center gap-2 px-4 max-md:grid-cols-[minmax(0,1fr)_auto] max-md:gap-2 max-md:px-3"
        style={{
          background: 'transparent',
          backdropFilter: 'none',
          WebkitBackdropFilter: 'none',
          borderTopColor: 'transparent',
        }}
      >
        {videoActive ? (
          <ImmersiveProgressBar
            value={percent}
            durationMs={durationMs}
            onChange={seek}
          />
        ) : null}

        <div className="flex min-w-0 items-center">
          <button
            type="button"
            onClick={() => toggleNowPlaying(false)}
            aria-label={i18n._(msg`收起播放页`)}
            title={i18n._(msg`收起播放页（Esc）`)}
            className="np-round-button pressable flex h-9 w-9 items-center justify-center rounded-full text-white/75"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        </div>

        {/* The transport now lives under the artwork in NowPlaying. Keep this
            bottom bar for the overlay chrome + utility menus only. */}
        <div
          className={cn(
            'flex items-center',
            videoActive ? 'flex-col gap-2 max-md:items-end' : 'hidden',
          )}
        >
          <div className="flex items-center gap-5 max-md:gap-3">
            <button
              type="button"
              aria-label={liked ? i18n._(msg`取消喜欢`) : i18n._(msg`喜欢`)}
              aria-pressed={liked}
              title={liked ? i18n._(msg`取消喜欢`) : i18n._(msg`喜欢`)}
              onClick={() => {
                if (isLogin) void likeSong(currentSong.id, !liked)
                else void toggleLocalFavorite(currentSong)
              }}
              className="pressable flex h-8 w-8 items-center justify-center transition-colors max-md:hidden"
            >
              <Heart
                className={cn(
                  'h-4 w-4 transition-colors',
                  liked
                    ? 'fill-[#ff2d55] text-[#ff2d55]'
                    : 'text-white/35 hover:text-white/70',
                )}
              />
            </button>
            <button
              type="button"
              title={
                heartMode ? i18n._(msg`关闭心动模式`) : i18n._(msg`心动模式`)
              }
              aria-label={i18n._(msg`心动模式`)}
              aria-pressed={heartMode}
              disabled={heartLoading}
              onClick={() => void toggleHeartMode()}
              className={cn(
                'pressable flex h-8 w-8 items-center justify-center transition-colors disabled:opacity-50 max-md:hidden',
                heartMode ? 'text-[#ff2d55]' : 'text-white/35 hover:text-white/70',
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
                'pressable flex h-8 w-8 items-center justify-center transition-colors max-md:h-10 max-md:w-10',
                mode === 'order'
                  ? 'text-white/35 hover:text-white/70'
                  : 'text-white/75 hover:text-white',
              )}
            >
              {modeIcon}
            </button>
            <button
              type="button"
              aria-label={i18n._(msg`上一首`)}
              onClick={() => void prev()}
              className="pressable flex h-8 w-8 items-center justify-center text-white/85 hover:text-white max-md:h-10 max-md:w-10"
            >
              <SkipBack className="h-6 w-6 fill-current" />
            </button>
            <button
              type="button"
              aria-label={
                playbackPlaying ? i18n._(msg`暂停`) : i18n._(msg`播放`)
              }
              onClick={() => {
                if (videoActive) toggleVideo()
                else void togglePlay()
              }}
              className="pressable flex h-12 w-12 items-center justify-center rounded-full text-white hover:text-white/80"
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
              className="pressable flex h-8 w-8 items-center justify-center text-white/85 hover:text-white max-md:h-10 max-md:w-10"
            >
              <SkipForward className="h-6 w-6 fill-current" />
            </button>
            <button
              type="button"
              onClick={() => toggleQueue()}
              className="pressable flex h-8 w-8 items-center justify-center text-white/35 transition-colors hover:text-white/70 max-md:hidden"
              title={i18n._(msg`播放列表`)}
            >
              <ListMusic className="h-4 w-4" />
            </button>
          </div>

          {!videoActive ? (
            <div className="flex w-full items-center gap-2.5 max-md:absolute max-md:inset-x-0 max-md:top-0 max-md:mt-0 max-md:px-3">
              <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-white/45 max-md:hidden">
                {clock(playbackMs)}
              </span>
              <ProgressSlider
                key={`${currentSong.id}-immersive`}
                value={percent}
                onChange={seek}
                immersive
                valueText={`${clock(playbackMs)} / ${clock(durationMs)}`}
              />
              <span className="w-9 shrink-0 text-[11px] tabular-nums text-white/45 max-md:hidden">
                -{clock(durationMs - playbackMs)}
              </span>
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 max-md:hidden">
          <Popover open={qualityOpen} onOpenChange={setQualityOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={i18n._(msg`播放音质`)}
                title={i18n._(msg`播放音质`)}
                className="pressable flex h-7 items-center gap-1 rounded-full px-2 text-[11px] text-white/45 transition-colors hover:bg-white/10 hover:text-white/75"
              >
                <AudioLines className="h-3.5 w-3.5" />
                {qualityLabel}
              </button>
            </PopoverTrigger>
            <PlayerMenuContent
              immersive
              tint={tint}
              className="w-[min(190px,calc(100vw-24px))]"
            >
              <p className="px-2 py-1 text-[11px] text-white/45">
                <Trans>播放音质</Trans>
              </p>
              {PLAY_QUALITY_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handleQualityChange(option.value)}
                  className={cn(
                    'flex w-full items-center justify-between rounded-[6px] px-2 py-1.5 text-left text-[12px] transition-colors',
                    playLevel === option.value
                      ? 'bg-white/12 text-white'
                      : 'text-white/65 hover:bg-white/8',
                  )}
                >
                  <span>{i18n._(option.label)}</span>
                  {playLevel === option.value ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : null}
                </button>
              ))}
            </PlayerMenuContent>
          </Popover>

          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={i18n._(msg`音量`)}
                title={i18n._(msg`音量（Alt + ↑ / ↓）`)}
                className="pressable flex h-7 w-7 items-center justify-center rounded-full text-white/55 transition-colors hover:bg-white/10 hover:text-white"
              >
                {currentVolume === 0 ? (
                  <VolumeX className="h-4 w-4" />
                ) : currentVolume < 45 ? (
                  <Volume1 className="h-4 w-4" />
                ) : (
                  <Volume2 className="h-4 w-4" />
                )}
              </button>
            </PopoverTrigger>
            <PlayerMenuContent immersive tint={tint} align="center" className="w-[52px]">
              <div className="flex flex-col items-center gap-2 py-2">
                <VolumeSlider
                  value={currentVolume}
                  onChange={videoActive ? setVideoVolume : setVolume}
                />
                <span className="text-[11px] tabular-nums text-white/45">
                  {currentVolume}
                </span>
              </div>
            </PlayerMenuContent>
          </Popover>

          <SourcePicker tint={tint} />
          <PlaylistPicker
            song={currentSong}
            tint={tint}
            buttonClassName="flex h-7 w-7 items-center justify-center rounded-full hover:bg-white/10"
          />

          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={i18n._(msg`更多播放选项`)}
                title={i18n._(msg`更多播放选项`)}
                className="pressable flex h-7 w-7 items-center justify-center rounded-full text-white/55 transition-colors hover:bg-white/10 hover:text-white"
              >
                <Ellipsis className="h-4 w-4" />
              </button>
            </PopoverTrigger>
            <PlayerMenuContent
              immersive
              tint={tint}
              className="w-[min(236px,calc(100vw-24px))]"
            >
              <p className="px-2 py-1 text-[11px] text-white/45">
                <Trans>播放选项</Trans>
              </p>
              <div className="flex items-center justify-between gap-3 px-2 pb-1.5 pt-2">
                <div>
                  <p className="text-[11.5px] font-medium text-white/80">
                    <Trans>逐字播放</Trans>
                  </p>
                  <p className="mt-0.5 text-[10px] leading-relaxed text-white/40">
                    <Trans>关闭后只高亮整行，不做逐字动画</Trans>
                  </p>
                </div>
                <ToggleSwitch
                  checked={wordByWordLyrics}
                  onChange={setWordByWordLyrics}
                  ariaLabel={i18n._(msg`逐字播放`)}
                />
              </div>
              {LYRIC_DISPLAY_OPTIONS.length ? (
                <div className="px-2 pb-1.5 pt-1">
                  <p className="mb-1 text-[11px] text-white/50">
                    <Trans>歌词显示</Trans>
                  </p>
                  <div className="space-y-0.5 rounded-[8px] bg-white/5 p-0.5">
                    {LYRIC_DISPLAY_OPTIONS.map((option) => {
                      const active = lyricDisplayMode === option.value
                      return (
                        <button
                          key={option.value}
                          type="button"
                          aria-pressed={active}
                          onClick={() => setLyricDisplayMode(option.value)}
                          className={cn(
                            'flex w-full items-center justify-between gap-2 rounded-[6px] px-2 py-1.5 text-left text-[11px] transition-colors',
                            active
                              ? 'bg-white/14 text-white'
                              : 'text-white/60 hover:bg-white/8 hover:text-white/85',
                          )}
                        >
                          <span>{i18n._(option.label)}</span>
                          {active ? <Check className="h-3 w-3" /> : null}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ) : null}
            </PlayerMenuContent>
          </Popover>
        </div>
      </div>
    </div>
  )
}
