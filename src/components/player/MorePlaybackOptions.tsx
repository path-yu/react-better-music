import { useEffect, useState, type ReactNode } from 'react'
import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { Trans } from '@lingui/react/macro'
import {
  AudioLines,
  CaseSensitive,
  Check,
  ChevronDown,
  Film,
  Languages,
  Loader2,
  Moon,
  PictureInPicture2,
  Radio,
  Subtitles,
  WholeWord,
} from 'lucide-react'
import { PlayerMenuContent } from './PlayerMenuContent'
import { SwitchTrack } from '../common/ToggleSwitch'
import { usePlayerMenuTint } from '../../lib/menuSurface'
import { cn } from '../../lib/format'
import { toast } from '../../lib/toast'
import { isDesktopShell } from '../../lib/desktop'
import {
  getDesktopLyricsVisible,
  getMiniPlayerVisible,
  setDesktopLyricsVisible,
  setMiniPlayerVisible,
} from '../../lib/desktopBridge'
import { usePlayerStore } from '../../store/player'
import {
  LYRIC_DISPLAY_OPTIONS,
  LYRIC_FONT_SIZE_OPTIONS,
  PLAY_QUALITY_OPTIONS,
  useSettingsStore,
} from '../../store/settings'
import { SOURCE_OPTIONS } from '../../lib/sources'
import { listCachedSources } from '../../lib/songCache'
import { useSleepTimerStore } from '../../store/sleepTimer'
import type { PlayLevel } from '../../types'

const SLEEP_OPTIONS = [
  { minutes: 15, label: msg`15 分钟` },
  { minutes: 30, label: msg`30 分钟` },
  { minutes: 60, label: msg`60 分钟` },
  { minutes: 90, label: msg`90 分钟` },
]

/** Countdown shown in the menu row, e.g. `28:15`. */
function formatCountdown(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

interface MorePlaybackOptionsProps {
  /** Dark cover-tinted surface for NowPlaying; default light popover outside. */
  immersive: boolean
  onClose: () => void
  /** Opens the related-video picker (detail page only). */
  onOpenRelatedVideos?: () => void
  videoLoading?: boolean
}

/**
 * A label row with a segmented control under it. Quality, lyric display and
 * lyric size each have three short choices, so one control per setting
 * replaces the old mix of an inline list in a box, hover submenus and a
 * description paragraph.
 */
function MenuChoice<T extends string>({
  icon,
  label,
  value,
  options,
  onChange,
}: {
  icon: ReactNode
  label: string
  value: T
  options: ReadonlyArray<{ value: T; label: MessageDescriptor }>
  onChange: (value: T) => void
}) {
  const { i18n } = useLingui()
  return (
    <div role="group" aria-label={label}>
      <div className="menu-item menu-item--static">
        <span className="menu-item__icon">{icon}</span>
        <span className="menu-item__label">{label}</span>
      </div>
      <div className="menu-segmented" role="radiogroup" aria-label={label}>
        {options.map((option) => {
          const selected = option.value === value
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(option.value)}
              className={cn('menu-segmented__option', selected && 'is-selected')}
            >
              {i18n._(option.label)}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * An on/off row: the whole row toggles, the switch only shows the state. The
 * switch is the settings page's own track, so both always look the same.
 */
function MenuSwitch({
  icon,
  label,
  title,
  checked,
  onToggle,
}: {
  icon: ReactNode
  label: ReactNode
  title?: string
  checked: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      title={title}
      onClick={onToggle}
      className="menu-item"
    >
      <span className="menu-item__icon">{icon}</span>
      <span className="menu-item__label">{label}</span>
      <SwitchTrack checked={checked} />
    </button>
  )
}

/**
 * Shared contents of every "more playback options" menu: the dark tinted
 * surface on the song page and the default popover in the player bar use the
 * same rows (`.menu-*` in styles.css), so both look like one menu family with
 * the song context menu.
 */
export function MorePlaybackOptions({
  immersive,
  onClose,
  onOpenRelatedVideos,
  videoLoading = false,
}: MorePlaybackOptionsProps) {
  const { i18n } = useLingui()
  const desktopShell = isDesktopShell()
  const [lyricsWindowOpen, setLyricsWindowOpen] = useState(false)
  const [miniWindowOpen, setMiniWindowOpen] = useState(false)

  const currentSong = usePlayerStore((state) => state.queue[state.currentIndex])
  const playLevel = useSettingsStore((state) => state.playLevel)
  const setPlayLevel = useSettingsStore((state) => state.setPlayLevel)
  const invalidateUrls = usePlayerStore((state) => state.invalidateUrls)
  const refreshCurrentUrl = usePlayerStore((state) => state.refreshCurrentUrl)
  const lyricDisplayMode = useSettingsStore((state) => state.lyricDisplayMode)
  const setLyricDisplayMode = useSettingsStore(
    (state) => state.setLyricDisplayMode,
  )
  const lyricFontSize = useSettingsStore((state) => state.lyricFontSize)
  const setLyricFontSize = useSettingsStore((state) => state.setLyricFontSize)
  const wordByWordLyrics = useSettingsStore((state) => state.wordByWordLyrics)
  const setWordByWordLyrics = useSettingsStore(
    (state) => state.setWordByWordLyrics,
  )
  const setPreferredSource = useSettingsStore((state) => state.setPreferredSource)
  const switchingSource = usePlayerStore((state) => state.switchingSource)
  const switchToOtherSource = usePlayerStore((state) => state.switchToOtherSource)
  const playCachedSource = usePlayerStore((state) => state.playCachedSource)
  const switchToRecommendedVersion = usePlayerStore(
    (state) => state.switchToRecommendedVersion,
  )
  const [sourceOpen, setSourceOpen] = useState(false)
  const [cachedSources, setCachedSources] = useState<string[]>([])
  const sleepEndsAt = useSleepTimerStore((state) => state.endsAt)
  const sleepRemaining = useSleepTimerStore((state) => state.remainingMs)
  const sleepMinutes = useSleepTimerStore((state) => state.minutes)
  const startSleepTimer = useSleepTimerStore((state) => state.start)
  const cancelSleepTimer = useSleepTimerStore((state) => state.cancel)
  const [sleepOpen, setSleepOpen] = useState(false)
  const tint = usePlayerMenuTint(immersive, currentSong?.al.picUrl)

  // What is actually playing, so a wrong match is visible before switching.
  // `copyright-rcmd` is tracked here too, unlike the old `unblocked` test.
  const playingSource = currentSong?.matchedSource ?? ''
  const playingOption = SOURCE_OPTIONS.find(
    (option) => option.value === playingSource,
  )
  const sourceLabel = playingSource
    ? playingOption
      ? i18n._(playingOption.label)
      : playingSource === 'copyright-rcmd'
        ? i18n._(msg`推荐版本`)
        : playingSource
    : i18n._(msg`网易云官方`)

  // Cached copies are listed when the picker opens; they play from disk and
  // therefore also work offline.
  const currentSongId = currentSong?.id
  useEffect(() => {
    if (!sourceOpen || !currentSongId) return
    let active = true
    void listCachedSources(currentSongId).then((sources) => {
      if (active) setCachedSources(sources)
    })
    return () => {
      active = false
    }
  }, [sourceOpen, currentSongId])

  const handleSelectSource = (value: string) => {
    setPreferredSource(value)
    if (cachedSources.includes(value)) {
      void playCachedSource(value)
      return
    }
    // Picking "auto" on a song that already has a full official URL should not
    // replace it with a third-party match. Blocked/trial tracks still switch.
    const shouldSwitch =
      value !== 'auto' || Boolean(currentSong?.unblocked || currentSong?.trialEnd)
    if (!shouldSwitch) return
    void switchToOtherSource(value === 'auto' ? undefined : value, true)
  }

  useEffect(() => {
    if (!desktopShell) return
    let active = true
    void getDesktopLyricsVisible().then(({ visible }) => {
      if (active) setLyricsWindowOpen(visible)
    })
    void getMiniPlayerVisible().then(({ visible }) => {
      if (active) setMiniWindowOpen(visible)
    })
    return () => {
      active = false
    }
  }, [desktopShell])

  const handleToggleDesktopLyrics = () => {
    void setDesktopLyricsVisible('toggle')
      .then(({ visible }) => setLyricsWindowOpen(visible))
      .catch(() => toast.warning(i18n._(msg`桌面歌词窗口暂不可用`)))
  }

  const handleToggleMiniPlayer = () => {
    void setMiniPlayerVisible('toggle')
      .then(({ visible }) => setMiniWindowOpen(visible))
      .catch(() => toast.warning(i18n._(msg`迷你播放器暂不可用`)))
  }

  // The menu stays open after a choice: these are settings, and the
  // segmented control already shows the new value.
  const handleQualityChange = (level: PlayLevel) => {
    if (level === playLevel) return
    setPlayLevel(level)
    invalidateUrls()
    const option = PLAY_QUALITY_OPTIONS.find((item) => item.value === level)
    const label = option ? i18n._(option.label) : level
    toast.info(i18n._(msg`播放音质已切换为${label}，正在重新加载`))
    void refreshCurrentUrl()
  }

  return (
    <PlayerMenuContent
      immersive={immersive}
      tint={tint}
      side="top"
      className="menu-list max-h-[min(80vh,560px)] w-[min(264px,calc(100vw-24px))] overflow-y-auto [scrollbar-width:thin]"
    >
      {onOpenRelatedVideos ? (
        <>
          <button
            type="button"
            disabled={videoLoading}
            onClick={() => {
              onClose()
              onOpenRelatedVideos()
            }}
            className="menu-item"
          >
            <span className="menu-item__icon">
              {videoLoading ? <Loader2 className="animate-spin" /> : <Film />}
            </span>
            <span className="menu-item__label">
              <Trans>相关视频</Trans>
            </span>
          </button>
          <div className="menu-separator" role="separator" />
        </>
      ) : null}

      <MenuChoice
        icon={<AudioLines />}
        label={i18n._(msg`播放音质`)}
        value={playLevel}
        options={PLAY_QUALITY_OPTIONS}
        onChange={handleQualityChange}
      />

      <button
        type="button"
        role="menuitem"
        aria-expanded={sourceOpen}
        onClick={() => setSourceOpen((value) => !value)}
        className="menu-item"
      >
        <span className="menu-item__icon">
          {switchingSource ? <Loader2 className="animate-spin" /> : <Radio />}
        </span>
        <span className="menu-item__label">
          <Trans>切换音源</Trans>
        </span>
        <span
          className={cn(
            'max-w-[92px] truncate text-[11px]',
            immersive ? 'text-white/45' : 'text-ink-4',
          )}
        >
          {sourceLabel}
        </span>
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 shrink-0 transition-transform',
            sourceOpen && 'rotate-180',
            immersive ? 'text-white/40' : 'text-ink-4',
          )}
        />
      </button>

      {sourceOpen ? (
        <div className="space-y-0.5 px-1 pb-1 pt-0.5">
          <button
            type="button"
            role="menuitemradio"
            aria-checked={playingSource === 'copyright-rcmd'}
            disabled={switchingSource}
            onClick={() =>
              cachedSources.includes('copyright-rcmd')
                ? void playCachedSource('copyright-rcmd')
                : void switchToRecommendedVersion()
            }
            className={cn(
              'flex w-full items-center justify-between gap-2 rounded-[6px] px-2 py-1.5 text-left text-[12px] transition-colors disabled:opacity-50',
              playingSource === 'copyright-rcmd'
                ? immersive
                  ? 'bg-white/14 text-white'
                  : 'bg-white text-accent shadow-sm dark:bg-white/15 dark:text-white'
                : immersive
                  ? 'text-white/65 hover:bg-white/8'
                  : 'text-ink-2 hover:bg-black/5 dark:text-white/60 dark:hover:bg-white/10',
            )}
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="min-w-0 truncate">{i18n._(msg`推荐版本`)}</span>
              {cachedSources.includes('copyright-rcmd') ? (
                <span
                  className={cn(
                    'shrink-0 rounded-full px-1.5 py-0.5 text-[11px]',
                    immersive
                      ? 'bg-white/12 text-white/60'
                      : 'bg-black/5 text-ink-4',
                  )}
                >
                  {i18n._(msg`已缓存`)}
                </span>
              ) : null}
            </span>
            {playingSource === 'copyright-rcmd' ? (
              <Check className="h-3 w-3 shrink-0" />
            ) : null}
          </button>
          {SOURCE_OPTIONS.map((option) => {
            // Only the source actually playing is checked. `preferredSource`
            // is the fallback for the *next* match, so marking it here made an
            // officially playing track look like it used the saved provider.
            const active = option.value === playingSource
            return (
              <button
                key={option.value}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                disabled={switchingSource}
                onClick={() => handleSelectSource(option.value)}
                className={cn(
                  'flex w-full items-center justify-between gap-2 rounded-[6px] px-2 py-1.5 text-left text-[12px] transition-colors disabled:opacity-50',
                  active
                    ? immersive
                      ? 'bg-white/14 text-white'
                      : 'bg-white text-accent shadow-sm dark:bg-white/15 dark:text-white'
                    : immersive
                      ? 'text-white/65 hover:bg-white/8'
                      : 'text-ink-2 hover:bg-black/5 dark:text-white/60 dark:hover:bg-white/10',
                )}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="min-w-0 truncate">{i18n._(option.label)}</span>
                  {cachedSources.includes(option.value) ? (
                    <span
                      className={cn(
                        'shrink-0 rounded-full px-1.5 py-0.5 text-[11px]',
                        immersive
                          ? 'bg-white/12 text-white/60'
                          : 'bg-black/5 text-ink-4',
                      )}
                    >
                      {i18n._(msg`已缓存`)}
                    </span>
                  ) : null}
                </span>
                {active ? <Check className="h-3 w-3 shrink-0" /> : null}
              </button>
            )
          })}
          <p
            className={cn(
              'px-1 pb-0.5 pt-1 text-[11px] leading-relaxed',
              immersive ? 'text-white/35' : 'text-ink-4',
            )}
          >
            <Trans>选择后立即重新获取当前歌曲；自动匹配会按内置顺序尝试。</Trans>
          </p>
        </div>
      ) : null}

      <button
        type="button"
        role="menuitem"
        aria-expanded={sleepOpen}
        onClick={() => setSleepOpen((value) => !value)}
        className="menu-item"
      >
        <span className="menu-item__icon">
          <Moon />
        </span>
        <span className="menu-item__label">
          <Trans>睡眠定时器</Trans>
        </span>
        <span
          className={cn(
            'max-w-[92px] truncate text-[11px] tabular-nums',
            sleepEndsAt
              ? immersive
                ? 'text-white/70'
                : 'text-accent'
              : immersive
                ? 'text-white/45'
                : 'text-ink-4',
          )}
        >
          {sleepEndsAt
            ? formatCountdown(sleepRemaining)
            : i18n._(msg`关闭`)}
        </span>
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 shrink-0 transition-transform',
            sleepOpen && 'rotate-180',
            immersive ? 'text-white/40' : 'text-ink-4',
          )}
        />
      </button>

      {sleepOpen ? (
        <div className="space-y-0.5 px-1 pb-1 pt-0.5">
          {SLEEP_OPTIONS.map((option) => {
            const active = sleepMinutes === option.minutes
            return (
              <button
                key={option.minutes}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => startSleepTimer(option.minutes)}
                className={cn(
                  'flex w-full items-center justify-between gap-2 rounded-[6px] px-2 py-1.5 text-left text-[12px] transition-colors',
                  active
                    ? immersive
                      ? 'bg-white/14 text-white'
                      : 'bg-white text-accent shadow-sm dark:bg-white/15 dark:text-white'
                    : immersive
                      ? 'text-white/65 hover:bg-white/8'
                      : 'text-ink-2 hover:bg-black/5 dark:text-white/60 dark:hover:bg-white/10',
                )}
              >
                <span className="min-w-0 truncate">{i18n._(option.label)}</span>
              </button>
            )
          })}
          {sleepEndsAt ? (
            <button
              type="button"
              onClick={cancelSleepTimer}
              className={cn(
                'flex w-full items-center justify-between gap-2 rounded-[6px] px-2 py-1.5 text-left text-[12px] transition-colors',
                immersive
                  ? 'text-white/65 hover:bg-white/8'
                  : 'text-ink-2 hover:bg-black/5 dark:text-white/60 dark:hover:bg-white/10',
              )}
            >
              <span>
                <Trans>关闭定时器</Trans>
              </span>
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="menu-separator" role="separator" />

      <MenuSwitch
        icon={<WholeWord />}
        label={<Trans>逐字播放</Trans>}
        title={i18n._(msg`关闭后只高亮整行，不做逐字动画`)}
        checked={wordByWordLyrics}
        onToggle={() => setWordByWordLyrics(!wordByWordLyrics)}
      />
      {LYRIC_DISPLAY_OPTIONS.length ? (
        <MenuChoice
          icon={<Languages />}
          label={i18n._(msg`歌词显示`)}
          value={lyricDisplayMode}
          options={LYRIC_DISPLAY_OPTIONS}
          onChange={setLyricDisplayMode}
        />
      ) : null}
      <MenuChoice
        icon={<CaseSensitive />}
        label={i18n._(msg`歌词字号`)}
        value={lyricFontSize}
        options={LYRIC_FONT_SIZE_OPTIONS}
        onChange={setLyricFontSize}
      />

      {desktopShell ? (
        <>
          <div className="menu-separator" role="separator" />
          <MenuSwitch
            icon={<Subtitles />}
            label={<Trans>桌面歌词</Trans>}
            checked={lyricsWindowOpen}
            onToggle={handleToggleDesktopLyrics}
          />
          <MenuSwitch
            icon={<PictureInPicture2 />}
            label={<Trans>迷你播放器</Trans>}
            checked={miniWindowOpen}
            onToggle={handleToggleMiniPlayer}
          />
        </>
      ) : null}
    </PlayerMenuContent>
  )
}
