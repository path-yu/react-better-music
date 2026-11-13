import { useState, type ReactNode } from 'react'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { Trans } from '@lingui/react/macro'
import {
  AudioLines,
  Check,
  ChevronRight,
  Film,
  Languages,
  Loader2,
  Radio,
} from 'lucide-react'
import { MenuSurface } from '../common/MenuSurface'
import { ToggleSwitch } from '../common/ToggleSwitch'
import { PlayerMenuContent } from './PlayerMenuContent'
import { usePlayerMenuTint } from '../../lib/menuSurface'
import { SOURCE_OPTIONS } from '../../lib/sources'
import { cn } from '../../lib/format'
import { toast } from '../../lib/toast'
import { usePlayerStore } from '../../store/player'
import {
  LYRIC_DISPLAY_OPTIONS,
  PLAY_QUALITY_OPTIONS,
  useSettingsStore,
} from '../../store/settings'
import type { PlayLevel } from '../../types'

interface MorePlaybackOptionsProps {
  /** Dark cover-tinted surface for NowPlaying; default light popover outside. */
  immersive: boolean
  onClose: () => void
  /** Opens the related-video picker (detail page only). */
  onOpenRelatedVideos?: () => void
  videoLoading?: boolean
  /** Detail menu opens right; the external bar sits at the window edge. */
  submenuSide?: 'left' | 'right'
  /** Render quality/source/lyrics directly instead of hover submenus. */
  flat?: boolean
  /** Optional desktop-only rows appended to the shared menu. */
  footer?: ReactNode
}

/**
 * Shared contents of every "more playback options" menu. Styling is selected
 * by `immersive` so the detail page keeps its dark tinted surface while the
 * normal player bar uses the default light popover without inheriting it.
 */
export function MorePlaybackOptions({
  immersive,
  onClose,
  onOpenRelatedVideos,
  videoLoading = false,
  submenuSide = 'right',
  flat = false,
  footer,
}: MorePlaybackOptionsProps) {
  const { i18n } = useLingui()
  const [submenu, setSubmenu] = useState<'quality' | 'source' | 'lyrics' | null>(
    null,
  )
  const [placement, setPlacement] = useState<{
    side: 'top' | 'bottom'
    maxHeight: number
  }>({ side: 'top', maxHeight: 300 })

  const queue = usePlayerStore((state) => state.queue)
  const currentIndex = usePlayerStore((state) => state.currentIndex)
  const currentSong = queue[currentIndex]
  const playLevel = useSettingsStore((state) => state.playLevel)
  const setPlayLevel = useSettingsStore((state) => state.setPlayLevel)
  const invalidateUrls = usePlayerStore((state) => state.invalidateUrls)
  const refreshCurrentUrl = usePlayerStore((state) => state.refreshCurrentUrl)
  const switchingSource = usePlayerStore((state) => state.switchingSource)
  const switchToOtherSource = usePlayerStore(
    (state) => state.switchToOtherSource,
  )
  const preferredSource = useSettingsStore((state) => state.preferredSource)
  const setPreferredSource = useSettingsStore(
    (state) => state.setPreferredSource,
  )
  const lyricDisplayMode = useSettingsStore((state) => state.lyricDisplayMode)
  const setLyricDisplayMode = useSettingsStore(
    (state) => state.setLyricDisplayMode,
  )
  const wordByWordLyrics = useSettingsStore((state) => state.wordByWordLyrics)
  const setWordByWordLyrics = useSettingsStore(
    (state) => state.setWordByWordLyrics,
  )
  const tint = usePlayerMenuTint(immersive, currentSong?.al.picUrl)

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

  const openSubmenu = (
    kind: 'quality' | 'source' | 'lyrics',
    target: HTMLElement,
  ) => {
    const row = target.getBoundingClientRect()
    const desired = kind === 'source' ? 300 : 120
    const gap = 8
    const below = window.innerHeight - row.bottom - gap
    const above = row.top - gap
    const side = below >= desired || below >= above ? 'top' : 'bottom'
    const available = side === 'top' ? below : above
    setPlacement({
      side,
      maxHeight: Math.max(84, Math.min(desired, available)),
    })
    setSubmenu(kind)
  }

  const handleQualityChange = (level: PlayLevel) => {
    if (level !== playLevel) {
      setPlayLevel(level)
      invalidateUrls()
      const option = PLAY_QUALITY_OPTIONS.find((item) => item.value === level)
      const label = option ? i18n._(option.label) : level
      toast.info(i18n._(msg`播放音质已切换为${label}，正在重新加载`))
      void refreshCurrentUrl()
    }
    onClose()
  }

  const handleSourceSelect = (value: string) => {
    setPreferredSource(value)
    const shouldSwitch =
      value !== 'auto' || Boolean(currentSong?.unblocked || currentSong?.trialEnd)
    if (shouldSwitch) {
      void switchToOtherSource(value === 'auto' ? undefined : value, true)
    }
    onClose()
  }

  const rowClass = immersive
    ? 'text-white/70 hover:bg-white/10 hover:text-white'
    : 'text-black/65 hover:bg-black/5 hover:text-black'
  const iconClass = immersive ? 'text-white/45' : 'text-black/40'
  const metaClass = immersive
    ? 'text-[10px] text-white/40'
    : 'text-[10px] text-black/35'
  const activeClass = immersive
    ? 'bg-white/14 text-white'
    : 'bg-accent/10 text-accent'
  const inactiveClass = immersive
    ? 'text-white/65 hover:bg-white/8 hover:text-white/90'
    : 'text-black/60 hover:bg-black/5 hover:text-black/85'
  const surfaceClass = immersive
    ? 'absolute z-50 p-1.5'
    : 'absolute z-50 rounded-[10px] border border-black/10 bg-[#fbfbfd]/98 p-1.5 shadow-[0_10px_40px_-12px_rgba(0,0,0,0.28)] backdrop-blur-xl'
  const placementStyle =
    placement.side === 'bottom'
      ? { bottom: 0, maxHeight: placement.maxHeight, overflowY: 'auto' as const }
      : { top: 0, maxHeight: placement.maxHeight, overflowY: 'auto' as const }
  const submenuPosition =
    submenuSide === 'left' ? 'right-full mr-1' : 'left-full'
  const sectionBoxClass = immersive ? 'bg-white/5' : 'bg-black/4'

  return (
    <PlayerMenuContent
      immersive={immersive}
      tint={tint}
      side="top"
      className={cn(
        'w-[min(260px,calc(100vw-24px))]',
        flat
          ? 'max-h-[min(70vh,520px)] overflow-y-auto'
          : '!overflow-visible',
      )}
    >
      <p
        className={cn(
          'px-2 py-1 text-[11px]',
          immersive ? 'text-white/45' : 'text-black/35',
        )}
      >
        <Trans>播放选项</Trans>
      </p>

      {onOpenRelatedVideos ? (
        <>
          <button
            type="button"
            disabled={videoLoading}
            onClick={() => {
              onClose()
              onOpenRelatedVideos()
            }}
            className={cn(
              'flex w-full items-center justify-between rounded-[7px] px-2 py-1.5 text-left text-[11.5px] transition-colors disabled:opacity-50',
              rowClass,
            )}
          >
            <span className="flex items-center gap-1.5">
              {videoLoading ? (
                <Loader2 className={cn('h-3.5 w-3.5 animate-spin', iconClass)} />
              ) : (
                <Film className={cn('h-3.5 w-3.5', iconClass)} />
              )}
              <Trans>相关视频</Trans>
            </span>
          </button>
          <div className={cn('my-1 h-px', immersive ? 'bg-white/8' : 'bg-black/8')} />
        </>
      ) : null}

      {flat ? (
        <div className="px-2 pb-1.5 pt-1">
          <p
            className={cn(
              'mb-1 flex items-center justify-between gap-2 text-[11px]',
              immersive ? 'text-white/50' : 'text-black/40',
            )}
          >
            <span className="flex items-center gap-1.5">
              <AudioLines className={cn('h-3.5 w-3.5', iconClass)} />
              <Trans>播放音质</Trans>
            </span>
            <span className={metaClass}>{qualityLabel}</span>
          </p>
          <div className={cn('space-y-0.5 rounded-[8px] p-0.5', sectionBoxClass)}>
            {PLAY_QUALITY_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => handleQualityChange(option.value)}
                className={cn(
                  'flex w-full items-center justify-between rounded-[6px] px-2 py-1.5 text-left text-[11px] transition-colors',
                  playLevel === option.value ? activeClass : inactiveClass,
                )}
              >
                <span>{i18n._(option.label)}</span>
                {playLevel === option.value ? (
                  <Check className="h-3 w-3" />
                ) : null}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div
          className="relative"
          onMouseEnter={(event) => openSubmenu('quality', event.currentTarget)}
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
            className={cn(
              'flex w-full items-center justify-between rounded-[7px] px-2 py-1.5 text-left text-[11.5px] transition-colors',
              rowClass,
            )}
          >
            <span className="flex items-center gap-1.5">
              <AudioLines className={cn('h-3.5 w-3.5', iconClass)} />
              <Trans>播放音质</Trans>
            </span>
            <span className={cn('flex items-center gap-1', metaClass)}>
              {qualityLabel}
              <ChevronRight className="h-3 w-3" />
            </span>
          </button>
          {submenu === 'quality' ? (
            <MenuSurface
              active={immersive}
              tint={immersive ? tint : undefined}
              className={cn(surfaceClass, submenuPosition, 'w-[150px]')}
              style={placementStyle}
            >
              {PLAY_QUALITY_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handleQualityChange(option.value)}
                  className={cn(
                    'flex w-full items-center justify-between rounded-[6px] px-2 py-1.5 text-left text-[11px] transition-colors',
                    playLevel === option.value ? activeClass : inactiveClass,
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
      )}

      {flat ? (
        <div className="px-2 pb-1.5 pt-1">
          <p
            className={cn(
              'mb-1 flex items-center justify-between gap-2 text-[11px]',
              immersive ? 'text-white/50' : 'text-black/40',
            )}
          >
            <span className="flex items-center gap-1.5">
              <Radio className={cn('h-3.5 w-3.5', iconClass)} />
              <Trans>选择音源</Trans>
            </span>
            <span className={metaClass}>{sourceLabel}</span>
          </p>
          <div className={cn('space-y-0.5 rounded-[8px] p-0.5', sectionBoxClass)}>
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
                    active ? activeClass : inactiveClass,
                  )}
                >
                  <span>{i18n._(option.label)}</span>
                  {active ? <Check className="h-3 w-3" /> : null}
                </button>
              )
            })}
          </div>
        </div>
      ) : (
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
            className={cn(
              'flex w-full items-center justify-between rounded-[7px] px-2 py-1.5 text-left text-[11.5px] transition-colors',
              rowClass,
            )}
          >
            <span className="flex items-center gap-1.5">
              <Radio className={cn('h-3.5 w-3.5', iconClass)} />
              <Trans>选择音源</Trans>
            </span>
            <span className={cn('flex items-center gap-1', metaClass)}>
              {sourceLabel}
              <ChevronRight className="h-3 w-3" />
            </span>
          </button>
          {submenu === 'source' ? (
            <MenuSurface
              active={immersive}
              tint={immersive ? tint : undefined}
              className={cn(
                surfaceClass,
                submenuPosition,
                'w-[190px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
              )}
              style={placementStyle}
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
                      active ? activeClass : inactiveClass,
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
      )}

      <div className={cn('my-1 h-px', immersive ? 'bg-white/8' : 'bg-black/8')} />

      <div className="flex items-center justify-between gap-3 px-2 pb-1.5 pt-2">
        <div>
          <p
            className={cn(
              'text-[11.5px] font-medium',
              immersive ? 'text-white/80' : 'text-black/70',
            )}
          >
            <Trans>逐字播放</Trans>
          </p>
          <p
            className={cn(
              'mt-0.5 text-[10px] leading-relaxed',
              immersive ? 'text-white/40' : 'text-black/35',
            )}
          >
            <Trans>关闭后只高亮整行，不做逐字动画</Trans>
          </p>
        </div>
        <ToggleSwitch
          checked={wordByWordLyrics}
          onChange={setWordByWordLyrics}
          ariaLabel={i18n._(msg`逐字播放`)}
        />
      </div>

      <div className={cn('my-1 h-px', immersive ? 'bg-white/8' : 'bg-black/8')} />

      {LYRIC_DISPLAY_OPTIONS.length ? (
        flat ? (
          <div className="px-2 pb-1.5 pt-1">
            <p
              className={cn(
                'mb-1 flex items-center justify-between gap-2 text-[11px]',
                immersive ? 'text-white/50' : 'text-black/40',
              )}
            >
              <span className="flex items-center gap-1.5">
                <Languages className={cn('h-3.5 w-3.5', iconClass)} />
                <Trans>歌词显示</Trans>
              </span>
              <span className={metaClass}>{lyricLabel}</span>
            </p>
            <div className={cn('space-y-0.5 rounded-[8px] p-0.5', sectionBoxClass)}>
              {LYRIC_DISPLAY_OPTIONS.map((option) => {
                const active = lyricDisplayMode === option.value
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      setLyricDisplayMode(option.value)
                      onClose()
                    }}
                    className={cn(
                      'flex w-full items-center justify-between rounded-[6px] px-2 py-1.5 text-left text-[11px] transition-colors',
                      active ? activeClass : inactiveClass,
                    )}
                  >
                    <span>{i18n._(option.label)}</span>
                    {active ? <Check className="h-3 w-3" /> : null}
                  </button>
                )
              })}
            </div>
          </div>
        ) : (
          <div
            className="relative"
            onMouseEnter={(event) => openSubmenu('lyrics', event.currentTarget)}
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
              className={cn(
                'flex w-full items-center justify-between rounded-[7px] px-2 py-1.5 text-left text-[11.5px] transition-colors',
                rowClass,
              )}
            >
              <span className="flex items-center gap-1.5">
                <Languages className={cn('h-3.5 w-3.5', iconClass)} />
                <Trans>歌词显示</Trans>
              </span>
              <span className={cn('flex items-center gap-1', metaClass)}>
                {lyricLabel}
                <ChevronRight className="h-3 w-3" />
              </span>
            </button>
            {submenu === 'lyrics' ? (
              <MenuSurface
                active={immersive}
                tint={immersive ? tint : undefined}
                className={cn(surfaceClass, submenuPosition, 'w-[150px]')}
                style={placementStyle}
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
                        onClose()
                      }}
                      className={cn(
                        'flex w-full items-center justify-between rounded-[6px] px-2 py-1.5 text-left text-[11px] transition-colors',
                        active ? activeClass : inactiveClass,
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
        )
      ) : null}

      {footer ? (
        <>
          <div
            className={cn('my-1 h-px', immersive ? 'bg-white/8' : 'bg-black/8')}
          />
          {footer}
        </>
      ) : null}
    </PlayerMenuContent>
  )
}
