import { useState } from 'react'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { Trans } from '@lingui/react/macro'
import {
  AudioLines,
  Check,
  ChevronRight,
  Ellipsis,
  Film,
  Heart,
  Languages,
  ListMusic,
  Loader2,
  Pause,
  Play,
  Radio,
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
import { SOURCE_OPTIONS } from '../../lib/sources'
import type { PlayLevel } from '../../types'
import { ToggleSwitch } from '../common/ToggleSwitch'
import { MenuSurface } from '../common/MenuSurface'
import { PlayerMenuContent } from './PlayerMenuContent'
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
  const invalidateUrls = usePlayerStore((state) => state.invalidateUrls)
  const refreshCurrentUrl = usePlayerStore((state) => state.refreshCurrentUrl)
  const switchingSource = usePlayerStore((state) => state.switchingSource)
  const switchToOtherSource = usePlayerStore(
    (state) => state.switchToOtherSource,
  )

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
  const preferredSource = useSettingsStore((state) => state.preferredSource)
  const setPreferredSource = useSettingsStore(
    (state) => state.setPreferredSource,
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
  const toggleVideo = useVideoPlaybackStore((state) => state.toggle)

  const [moreOpen, setMoreOpen] = useState(false)
  const [submenu, setSubmenu] = useState<
    'quality' | 'source' | 'lyrics' | null
  >(null)
  const [submenuPlacement, setSubmenuPlacement] = useState<{
    side: 'top' | 'bottom'
    maxHeight: number
  }>({ side: 'top', maxHeight: 320 })
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
  const clock = (ms: number) =>
    formatDuration(Math.max(0, ms)).replace(/^0(?=\d:)/, '')
  const qualityOption = PLAY_QUALITY_OPTIONS.find(
    (option) => option.value === playLevel,
  )
  const qualityLabel = qualityOption ? i18n._(qualityOption.label) : playLevel
  const currentSource = currentSong?.unblocked
    ? currentSong.matchedSource || preferredSource
    : ''
  const sourceOption = SOURCE_OPTIONS.find(
    (option) => option.value === currentSource,
  )
  const sourceLabel = sourceOption
    ? i18n._(sourceOption.label)
    : currentSong?.unblocked
      ? currentSource || i18n._(msg`其他音源`)
      : i18n._(msg`网易云官方`)
  const lyricOption = LYRIC_DISPLAY_OPTIONS.find(
    (option) => option.value === lyricDisplayMode,
  )
  const lyricLabel = lyricOption
    ? i18n._(lyricOption.label)
    : i18n._(msg`默认`)
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

  const handleQualityChange = (level: PlayLevel) => {
    if (level === playLevel) return
    setPlayLevel(level)
    invalidateUrls()
    const option = PLAY_QUALITY_OPTIONS.find((item) => item.value === level)
    toast.info(
      i18n._(
        msg`播放音质已切换为${option ? i18n._(option.label) : level}，正在重新加载`,
      ),
    )
    setMoreOpen(false)
    void refreshCurrentUrl()
  }

  const openSubmenu = (
    kind: 'quality' | 'source' | 'lyrics',
    target: HTMLElement,
  ) => {
    const row = target.getBoundingClientRect()
    const desired = kind === 'source' ? 300 : 120
    const gap = 8
    const below = window.innerHeight - row.bottom - gap
    const above = row.top - gap
    // Prefer a downward submenu; flip it above the row when the window cannot
    // fit the list, then cap the height to the actual free space.
    const side = below >= desired || below >= above ? 'top' : 'bottom'
    const available = side === 'top' ? below : above
    setSubmenuPlacement({
      side,
      maxHeight: Math.max(96, Math.min(desired, available)),
    })
    setSubmenu(kind)
  }

  const handleSourceSelect = (value: string) => {
    setPreferredSource(value)
    const shouldSwitch =
      value !== 'auto' || Boolean(currentSong?.unblocked || currentSong?.trialEnd)
    if (shouldSwitch) {
      void switchToOtherSource(value === 'auto' ? undefined : value, true)
    }
    setMoreOpen(false)
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
          aria-label={liked ? i18n._(msg`取消喜欢`) : i18n._(msg`喜欢`)}
          aria-pressed={liked}
          title={liked ? i18n._(msg`取消喜欢`) : i18n._(msg`喜欢`)}
          onClick={() => {
            if (isLogin) void likeSong(currentSong.id, !liked)
            else void toggleLocalFavorite(currentSong)
          }}
          className="pressable flex h-7 w-7 items-center justify-center transition-colors max-md:hidden"
        >
          <Heart
            className={cn(
              'h-4 w-4',
              liked
                ? 'fill-[#ff2d55] text-[#ff2d55]'
                : 'text-white/45 hover:text-white/80',
            )}
          />
        </button>
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
          title={
            playbackPlaying
              ? i18n._(msg`暂停（空格）`)
              : i18n._(msg`播放（空格）`)
          }
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
          onOpenChange={(open) => {
            setMoreOpen(open)
            if (!open) setSubmenu(null)
          }}
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
          <PlayerMenuContent
            immersive
            tint={tint}
            side="top"
            className="!overflow-visible w-[min(260px,calc(100vw-24px))]"
          >
            <p className="px-2 py-1 text-[11px] text-white/45">
              <Trans>播放选项</Trans>
            </p>

            {onOpenRelatedVideos ? (
              <>
                <button
                  type="button"
                  disabled={videoLoading}
                  onClick={() => {
                    setMoreOpen(false)
                    onOpenRelatedVideos()
                  }}
                  className="flex w-full items-center justify-between rounded-[7px] px-2 py-1.5 text-left text-[11.5px] text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
                >
                  <span className="flex items-center gap-1.5">
                    {videoLoading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-white/45" />
                    ) : (
                      <Film className="h-3.5 w-3.5 text-white/45" />
                    )}
                    <Trans>相关视频</Trans>
                  </span>
                </button>
                <div className="my-1 h-px bg-white/8" />
              </>
            ) : null}

            <div
              className="relative"
              onMouseEnter={(event) =>
                openSubmenu('quality', event.currentTarget)
              }
              onMouseLeave={() => setSubmenu(null)}
            >
              <button
                type="button"
                onFocus={(event) =>
                  openSubmenu('quality', event.currentTarget.parentElement!)
                }
                onClick={(event) =>
                  openSubmenu('quality', event.currentTarget.parentElement!)
                }
                className="flex w-full items-center justify-between rounded-[7px] px-2 py-1.5 text-left text-[11.5px] text-white/70 transition-colors hover:bg-white/10 hover:text-white"
              >
                <span className="flex items-center gap-1.5">
                  <AudioLines className="h-3.5 w-3.5 text-white/45" />
                  <Trans>播放音质</Trans>
                </span>
                <span className="flex items-center gap-1 text-[10px] text-white/40">
                  {qualityLabel}
                  <ChevronRight className="h-3 w-3" />
                </span>
              </button>
              {submenu === 'quality' ? (
                <MenuSurface
                  active
                  tint={tint}
                  className="absolute left-full z-50 w-[150px] p-1.5"
                  style={
                    submenuPlacement.side === 'bottom'
                      ? {
                          bottom: 0,
                          maxHeight: submenuPlacement.maxHeight,
                          overflowY: 'auto',
                        }
                      : {
                          top: 0,
                          maxHeight: submenuPlacement.maxHeight,
                          overflowY: 'auto',
                        }
                  }
                >
                  {PLAY_QUALITY_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => handleQualityChange(option.value)}
                      className={cn(
                        'flex w-full items-center justify-between rounded-[6px] px-2 py-1.5 text-left text-[11px] transition-colors',
                        playLevel === option.value
                          ? 'bg-white/14 text-white'
                          : 'text-white/65 hover:bg-white/8 hover:text-white/90',
                      )}
                    >
                      <span>{i18n._(option.label)}</span>
                      {playLevel === option.value ? (
                        <Check className="h-3 w-3" />
                      ) : null}
                    </button>
                  ))}
                </MenuSurface>
              ) : null}
            </div>

            <div
              className="relative"
              onMouseEnter={(event) => openSubmenu('source', event.currentTarget)}
              onMouseLeave={() => setSubmenu(null)}
            >
              <button
                type="button"
                onFocus={(event) =>
                  openSubmenu('source', event.currentTarget.parentElement!)
                }
                onClick={(event) =>
                  openSubmenu('source', event.currentTarget.parentElement!)
                }
                className="flex w-full items-center justify-between rounded-[7px] px-2 py-1.5 text-left text-[11.5px] text-white/70 transition-colors hover:bg-white/10 hover:text-white"
              >
                <span className="flex items-center gap-1.5">
                  <Radio className="h-3.5 w-3.5 text-white/45" />
                  <Trans>选择音源</Trans>
                </span>
                <span className="flex items-center gap-1 text-[10px] text-white/40">
                  {sourceLabel}
                  <ChevronRight className="h-3 w-3" />
                </span>
              </button>
              {submenu === 'source' ? (
                <MenuSurface
                  active
                  tint={tint}
                  className="absolute left-full z-50 w-[190px] overflow-y-auto p-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                  style={
                    submenuPlacement.side === 'bottom'
                      ? {
                          bottom: 0,
                          maxHeight: submenuPlacement.maxHeight,
                        }
                      : {
                          top: 0,
                          maxHeight: submenuPlacement.maxHeight,
                        }
                  }
                >
                  {SOURCE_OPTIONS.map((option) => {
                    const active = preferredSource === option.value
                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={active}
                        disabled={switchingSource}
                        onClick={() => handleSourceSelect(option.value)}
                        className={cn(
                          'flex w-full items-center justify-between rounded-[6px] px-2 py-1.5 text-left text-[11px] transition-colors disabled:opacity-50',
                          active
                            ? 'bg-white/14 text-white'
                            : 'text-white/65 hover:bg-white/8 hover:text-white/90',
                        )}
                      >
                        <span>{i18n._(option.label)}</span>
                        {active ? <Check className="h-3 w-3" /> : null}
                      </button>
                    )
                  })}
                </MenuSurface>
              ) : null}
            </div>

            <div className="my-1 h-px bg-white/8" />

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

            <div className="my-1 h-px bg-white/8" />

            {LYRIC_DISPLAY_OPTIONS.length ? (
              <div
                className="relative"
                onMouseEnter={(event) =>
                  openSubmenu('lyrics', event.currentTarget)
                }
                onMouseLeave={() => setSubmenu(null)}
              >
                <button
                  type="button"
                  onFocus={(event) =>
                    openSubmenu('lyrics', event.currentTarget.parentElement!)
                  }
                  onClick={(event) =>
                    openSubmenu('lyrics', event.currentTarget.parentElement!)
                  }
                  className="flex w-full items-center justify-between rounded-[7px] px-2 py-1.5 text-left text-[11.5px] text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <span className="flex items-center gap-1.5">
                    <Languages className="h-3.5 w-3.5 text-white/45" />
                    <Trans>歌词显示</Trans>
                  </span>
                  <span className="flex items-center gap-1 text-[10px] text-white/40">
                    {lyricLabel}
                    <ChevronRight className="h-3 w-3" />
                  </span>
                </button>
                {submenu === 'lyrics' ? (
                  <MenuSurface
                    active
                    tint={tint}
                    className="absolute left-full z-50 w-[150px] p-1.5"
                    style={
                      submenuPlacement.side === 'bottom'
                        ? {
                            bottom: 0,
                            maxHeight: submenuPlacement.maxHeight,
                            overflowY: 'auto',
                          }
                        : {
                            top: 0,
                            maxHeight: submenuPlacement.maxHeight,
                            overflowY: 'auto',
                          }
                    }
                  >
                    {LYRIC_DISPLAY_OPTIONS.map((option) => {
                      const active = lyricDisplayMode === option.value
                      return (
                        <button
                          key={option.value}
                          type="button"
                          aria-pressed={active}
                          onClick={() => {
                            setLyricDisplayMode(option.value)
                            setMoreOpen(false)
                          }}
                          className={cn(
                            'flex w-full items-center justify-between rounded-[6px] px-2 py-1.5 text-left text-[11px] transition-colors',
                            active
                              ? 'bg-white/14 text-white'
                              : 'text-white/65 hover:bg-white/8 hover:text-white/90',
                          )}
                        >
                          <span>{i18n._(option.label)}</span>
                          {active ? <Check className="h-3 w-3" /> : null}
                        </button>
                      )
                    })}
                  </MenuSurface>
                ) : null}
              </div>
            ) : null}
          </PlayerMenuContent>
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
