import { useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { Trans } from '@lingui/react/macro'
import {
  AudioLines,
  Ellipsis,
  ListMusic,
  Loader2,
  Mic2,
  MicVocal,
  Music2,
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
import {
  Button,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Popover,
  PopoverTrigger,
} from '@pikoloo/darwin-ui'
import { cn, formatDuration, formatRemaining } from '../../lib/format'
import { TimeToggle } from './TimeToggle'
import { PLAY_MODE_LABELS } from '../../lib/playMode'
import { isInstrumentalSong } from '../../lib/songs'
import { seekAudio } from '../../lib/audio'
import { toast } from '../../lib/toast'
import { KaraokeVocalFader } from './KaraokeVocalFader'
import { selectOverlayTime, usePlayerStore } from '../../store/player'
import { useSettingsStore } from '../../store/settings'
import { useSmartStemStore } from '../../store/smartStem'
import { useVideoPlaybackStore } from '../../store/videoPlayback'
import { MorePlaybackOptions } from './MorePlaybackOptions'
import { ProgressSlider } from './ProgressSlider'

import {
  TRANSPORT_BUSY_ICON,
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
  const navigate = useNavigate()
  const queue = usePlayerStore((state) => state.queue)
  const currentIndex = usePlayerStore((state) => state.currentIndex)
  const currentSong = queue[currentIndex]
  const playing = usePlayerStore((state) => state.playing)
  const sourceReady = usePlayerStore((state) => state.sourceReady)
  const audioReady = usePlayerStore((state) => state.audioReady)
  // Mounted (hidden) while the overlay is closed: don't tick in the background.
  const currentTime = usePlayerStore(selectOverlayTime)
  const showRemaining = useSettingsStore((state) => state.showRemainingTime)
  const mediaDuration = usePlayerStore((state) => state.mediaDuration)
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
  const songStemState = useSettingsStore((state) =>
    currentSong
      ? state.stemSongs?.[String(currentSong.id)]
      : undefined,
  )
  const setSongStemEnabled = useSettingsStore(
    (state) => state.setSongStemEnabled,
  )
  const smartInstalled = useSmartStemStore((state) => state.installed)
  const smartStatus = useSmartStemStore((state) => state.status)
  const smartProgress = useSmartStemStore((state) => state.progress)
  const smartEtaMs = useSmartStemStore((state) => state.etaMs)
  const smartError = useSmartStemStore((state) => state.error)
  const smartGeneratingSong = useSmartStemStore(
    (state) => state.generatingSongId,
  )
  const smartActiveSong = useSmartStemStore((state) => state.activeSongId)
  const smartActiveStem = useSmartStemStore((state) => state.activeStem)
  const switchSmartStem = useSmartStemStore((state) => state.switchStem)
  const setSmartVocalLevel = useSmartStemStore(
    (state) => state.setVocalLevel,
  )
  const karaokeVocalLevel = useSettingsStore(
    (state) => state.karaokeVocalLevel ?? 0.08,
  )
  const checkSmartEnvironment = useSmartStemStore(
    (state) => state.checkEnvironment,
  )
  const prepareSmartStem = useSmartStemStore(
    (state) => state.prepareForSong,
  )
  const restoreSmartStem = useSmartStemStore(
    (state) => state.restoreOriginal,
  )

  const [moreOpen, setMoreOpen] = useState(false)
  const [installPromptOpen, setInstallPromptOpen] = useState(false)
  const lastStemToggleRef = useRef(0)

  const currentSongIsInstrumental = isInstrumentalSong(currentSong)
  const songStemEnabled = Boolean(songStemState?.enabled)
  const smartActiveThisSong =
    Boolean(currentSong) &&
    smartActiveSong === currentSong?.id &&
    smartActiveStem !== null

  useEffect(() => {
    // Do not compete with the home page's first data requests while the
    // player is paused. The button checks on demand when smart mode is enabled.
    if (videoActive || !songStemEnabled || currentSongIsInstrumental) return
    const timer = window.setTimeout(() => {
      void checkSmartEnvironment()
    }, 900)
    return () => window.clearTimeout(timer)
  }, [
    checkSmartEnvironment,
    currentSongIsInstrumental,
    songStemEnabled,
    videoActive,
  ])


  if (!currentSong) return null

  const playbackPlaying = videoActive ? videoPlaying : playing
  const playbackBusy = videoActive
    ? false
    : playbackPlaying && (!sourceReady || !audioReady)
  const durationMs = videoActive
    ? videoDuration * 1000
    : currentSong.trialEnd && currentSong.trialEnd > 0
      ? currentSong.trialEnd * 1000
      : sourceReady && mediaDuration > 0
        ? mediaDuration
        : currentSong.dt || 0
  const playbackMs = videoActive ? videoTime * 1000 : currentTime * 1000
  const percent = durationMs
    ? Math.min(100, Math.max(0, (playbackMs / durationMs) * 100))
    : 0
  const clock = (ms: number) =>
    formatDuration(Math.max(0, ms)).replace(/^0(?=\d:)/, '')
  const smartGeneratingThisSong =
    smartGeneratingSong === currentSong.id && smartStatus === 'generating'
  const etaSeconds = Math.max(0, Math.round(smartEtaMs / 1000))
  const etaMinutes = Math.floor(etaSeconds / 60)
  const etaRest = String(etaSeconds % 60).padStart(2, '0')
  const etaText =
    etaSeconds >= 60
      ? i18n._(msg`${etaMinutes}分${etaRest}秒`)
      : i18n._(msg`${etaSeconds}秒`)

  const handleStemMode = async () => {
    // A click on the freshly-expanded stem selector can otherwise land on the
    // same control again and immediately turn smart mode back off.
    const now = Date.now()
    if (now - lastStemToggleRef.current < 600) return
    lastStemToggleRef.current = now
    if (!songStemEnabled) {
      if (currentSongIsInstrumental) {
        toast.info(i18n._(msg`当前是纯音乐，无需分离人声`))
        return
      }
      // Show the checking spinner immediately; the environment request can
      // take a few hundred milliseconds on a cold bridge.
      setSongStemEnabled(currentSong.id, true)
      // Always re-check before preparing a job. A cached `installed` flag can
      // become stale after the environment is uninstalled or moved.
      const installed = await checkSmartEnvironment(true)
      if (!installed) {
        setSongStemEnabled(currentSong.id, false)
        setInstallPromptOpen(true)
        return
      }
      void prepareSmartStem(currentSong.id)
      return
    }
    setSongStemEnabled(currentSong.id, false)
    void restoreSmartStem()
  }

  const stemTitle =
    !songStemEnabled
      ? smartInstalled === false
        ? i18n._(msg`Spleeter 未安装，请先在设置中安装`)
        : i18n._(msg`智能伴奏关闭：点击开启`)
      : smartStatus === 'checking'
        ? i18n._(msg`正在检查 Spleeter 环境…`)
        : smartStatus === 'instrumental' || currentSongIsInstrumental
          ? i18n._(msg`当前是纯音乐，无需分离人声`)
          : smartActiveThisSong
            ? smartActiveStem === 'karaoke'
              ? i18n._(msg`随心唱已启用：拖动音量调整人声`)
              : smartActiveStem === 'vocals'
                ? i18n._(msg`人声轨已启用：点击关闭`)
                : i18n._(msg`智能伴奏已启用：点击关闭`)
            : smartGeneratingThisSong
              ? i18n._(
                  msg`智能伴奏生成中 ${Math.round(smartProgress * 100)}% · 预计剩余 ${etaText}`,
                )
              : smartStatus === 'error'
                ? i18n._(
                    msg`智能伴奏生成失败：${smartError || '未知错误'}`,
                  )
                : i18n._(msg`智能伴奏已开启：播放时生成`)

  const smartLoading =
    songStemEnabled &&
    !smartActiveThisSong &&
    (smartStatus === 'checking' ||
      (smartStatus === 'generating' && smartGeneratingThisSong))

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
              ? 'text-love'
              : 'text-white/45 hover:text-white/80',
          )}
        >
          {heartLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
        </button>
        {!videoActive ? (
          <button
            type="button"
            title={stemTitle}
            aria-label={stemTitle}
            aria-pressed={songStemEnabled}
            aria-busy={smartLoading}
            disabled={smartLoading}
            onClick={() => void handleStemMode()}
            className={cn(
              'pressable flex h-8 w-8 items-center justify-center rounded-full transition-colors disabled:cursor-default',
              !songStemEnabled
                ? 'text-white/45 hover:text-white/80'
                : smartActiveThisSong
                  ? 'bg-emerald-400/12 text-emerald-300'
                  : 'bg-white/10 text-accent hover:text-white',
            )}
          >
            {smartLoading ? (
              <CircularProgress
                value={Math.round(smartProgress * 100)}
                size={32}
                strokeWidth={2.5}
                showValue={smartStatus !== 'checking'}
                indeterminate={smartStatus === 'checking'}
              />
            ) : currentSongIsInstrumental ? (
              <Music2 className="h-4 w-4" />
            ) : (
              <AudioLines className="h-4 w-4" />
            )}
          </button>
        ) : null}

        {!videoActive &&
        songStemEnabled &&
        smartActiveThisSong ? (
          <div className="flex items-center gap-1">
            {smartActiveStem === 'karaoke' ? (
              <KaraokeVocalFader
                value={Math.round(karaokeVocalLevel * 100)}
                onChange={setSmartVocalLevel}
              />
            ) : null}
            <div className="flex items-center rounded-full bg-white/8 p-0.5">
            <button
              type="button"
              title={i18n._(msg`随心唱`)}
              aria-label={i18n._(msg`随心唱`)}
              aria-pressed={smartActiveStem === 'karaoke'}
              onClick={() => void switchSmartStem('karaoke')}
              className={cn(
                'pressable flex h-6 w-6 items-center justify-center rounded-full transition-colors',
                smartActiveStem === 'karaoke'
                  ? 'bg-white/16 text-accent'
                  : 'text-white/40 hover:text-white/75',
              )}
            >
              <Mic2 className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              title={i18n._(msg`播放伴奏`)}
              aria-label={i18n._(msg`播放伴奏`)}
              aria-pressed={smartActiveStem === 'accompaniment'}
              onClick={() =>
                void switchSmartStem('accompaniment')
              }
              className={cn(
                'pressable flex h-6 w-6 items-center justify-center rounded-full transition-colors',
                smartActiveStem === 'accompaniment'
                  ? 'bg-white/16 text-accent'
                  : 'text-white/40 hover:text-white/75',
              )}
            >
              <AudioLines className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              title={i18n._(msg`播放人声`)}
              aria-label={i18n._(msg`播放人声`)}
              aria-pressed={smartActiveStem === 'vocals'}
              onClick={() => void switchSmartStem('vocals')}
              className={cn(
                'pressable flex h-6 w-6 items-center justify-center rounded-full transition-colors',
                smartActiveStem === 'vocals'
                  ? 'bg-rose-400/12 text-rose-300'
                  : 'text-white/40 hover:text-white/75',
              )}
            >
              <MicVocal className="h-3.5 w-3.5" />
            </button>
            </div>
          </div>
        ) : null}
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
          aria-label={
            videoActive
              ? playbackPlaying
                ? i18n._(msg`暂停`)
                : i18n._(msg`播放`)
              : playbackBusy
                ? sourceReady
                  ? i18n._(msg`正在缓冲`)
                  : i18n._(msg`正在加载音源`)
                : playbackPlaying
                  ? i18n._(msg`暂停`)
                  : i18n._(msg`播放`)
          }
          onClick={() => {
            if (videoActive) toggleVideo()
            else void togglePlay()
          }}
          className="pressable flex h-11 w-11 items-center justify-center rounded-full text-white hover:text-white/80"
        >
          {playbackBusy ? (
            <Loader2 className={TRANSPORT_BUSY_ICON} />
          ) : playbackPlaying ? (
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
          title={
            i18n._(PLAY_MODE_LABELS[mode])
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
            expandAudioOptions
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
          <div className="mt-0.5 flex items-center justify-between px-0.5 text-[11px] tabular-nums text-white/45">
            <span>{clock(playbackMs)}</span>
            <TimeToggle
              className="tabular-nums hover:text-white/75"
              showRemaining={showRemaining}
              label={
                showRemaining
                  ? formatRemaining(durationMs - playbackMs)
                  : clock(durationMs)
              }
            />
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

      <Dialog open={installPromptOpen} onOpenChange={setInstallPromptOpen}>
        <DialogContent size="sm" glass>
          <DialogHeader>
            <DialogTitle>
              <Trans>开启智能伴奏需要安装 Spleeter</Trans>
            </DialogTitle>
            <DialogDescription>
              <Trans>
                首次安装需要下载约 1 GB 的 Python、TensorFlow 和 Spleeter 运行环境，通常需要 300–600 秒，具体取决于网络速度。
              </Trans>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setInstallPromptOpen(false)}
            >
              <Trans>稍后</Trans>
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setInstallPromptOpen(false)
                void navigate({
                  to: '/settings',
                  search: { tab: 'playback' },
                })
              }}
            >
              <Trans>前往设置安装</Trans>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
