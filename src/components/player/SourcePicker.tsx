import { useState } from 'react'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { Trans } from '@lingui/react/macro'
import { Check, Loader2, Radio } from 'lucide-react'
import { Popover, PopoverTrigger } from '@pikoloo/darwin-ui'
import { usePlayerStore } from '../../store/player'
import { useSettingsStore } from '../../store/settings'
import { PlayerMenuContent } from './PlayerMenuContent'
import { SOURCE_OPTIONS } from '../../lib/sources'
import { cn } from '../../lib/format'

/**
 * Standalone provider picker. Each option maps to a module accepted by
 * `/song/url/match?source=`; selecting one re-resolves the current song and
 * preserves its playback position.
 */
export function SourcePicker({ tint }: { tint?: string }) {
  const { i18n } = useLingui()
  const [open, setOpen] = useState(false)
  const immersive = usePlayerStore((state) => state.showNowPlaying)
  const queue = usePlayerStore((state) => state.queue)
  const currentIndex = usePlayerStore((state) => state.currentIndex)
  const currentSong = queue[currentIndex]
  const switchingSource = usePlayerStore((state) => state.switchingSource)
  const switchToOtherSource = usePlayerStore((state) => state.switchToOtherSource)
  const preferredSource = useSettingsStore((state) => state.preferredSource)
  const setPreferredSource = useSettingsStore((state) => state.setPreferredSource)

  const currentProvider = currentSong?.unblocked
    ? currentSong.matchedSource || preferredSource
    : ''
  const currentOption = SOURCE_OPTIONS.find(
    (option) => option.value === currentProvider,
  )
  const currentLabel = currentOption
    ? i18n._(currentOption.label)
    : currentSong?.unblocked
      ? currentProvider || i18n._(msg`其他音源`)
      : i18n._(msg`网易云官方`)

  const handleSelect = (value: string) => {
    setPreferredSource(value)
    setOpen(false)
    // Picking "auto" on a song that already has a full official URL should not
    // replace it with a third-party match. Blocked/trial tracks still switch.
    const shouldSwitch =
      value !== 'auto' ||
      Boolean(currentSong?.unblocked || currentSong?.trialEnd)
    if (shouldSwitch) {
      void switchToOtherSource(value === 'auto' ? undefined : value, true)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={i18n._(msg`选择音源`)}
          title={`${i18n._(msg`选择音源`)} · ${currentLabel}`}
          className={cn(
            'pressable flex h-7 w-7 items-center justify-center rounded-full transition-colors max-md:h-10 max-md:w-10',
            immersive
              ? 'text-white/55 hover:bg-white/10 hover:text-white'
              : 'text-black/45 hover:bg-black/5 hover:text-black/75',
          )}
        >
          {switchingSource ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Radio className="h-4 w-4" />
          )}
        </button>
      </PopoverTrigger>
      <PlayerMenuContent
        immersive={immersive}
        tint={tint}
        className="w-[min(264px,calc(100vw-24px))]"
      >
          <div className="flex items-baseline justify-between px-2 pb-1.5 pt-1">
            <p
              className={cn(
                'text-[11px]',
                immersive ? 'text-white/45' : 'text-black/35',
              )}
            >
              <Trans>选择音源</Trans>
            </p>
            <p
              className={cn(
                'max-w-[120px] truncate text-[10px]',
                immersive ? 'text-white/40' : 'text-black/30',
              )}
              title={currentLabel}
            >
              <Trans>当前：{currentLabel}</Trans>
            </p>
          </div>

          <div
            className={cn(
              'max-h-[min(46vh,320px)] space-y-0.5 overflow-y-auto rounded-[8px] p-0.5',
              immersive ? 'bg-white/5' : 'bg-black/4',
            )}
          >
            {SOURCE_OPTIONS.map((option) => {
              const active = preferredSource === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={active}
                  disabled={switchingSource}
                  onClick={() => handleSelect(option.value)}
                  className={cn(
                    'flex w-full items-start justify-between gap-2 rounded-[7px] px-2 py-1.5 text-left transition-colors disabled:opacity-50',
                    active
                      ? immersive
                        ? 'bg-white/14 text-white shadow-sm'
                        : 'bg-white text-accent shadow-sm dark:bg-white/15 dark:text-white'
                      : immersive
                        ? 'text-white/65 hover:bg-white/8'
                        : 'text-black/65 hover:bg-black/5 dark:text-white/60 dark:hover:bg-white/10',
                  )}
                >
                  <span className="min-w-0">
                    <span className="block text-[11.5px] font-medium">
                      {i18n._(option.label)}
                    </span>
                    <span
                      className={cn(
                        'mt-0.5 block text-[10px] leading-relaxed',
                        immersive
                          ? 'text-white/40'
                          : 'text-black/35 dark:text-white/35',
                      )}
                    >
                      {i18n._(option.description)}
                    </span>
                  </span>
                  {active ? <Check className="mt-0.5 h-3 w-3 shrink-0" /> : null}
                </button>
              )
            })}
          </div>

          <p
            className={cn(
              'px-2 pb-1 pt-1.5 text-[10px] leading-relaxed',
              immersive ? 'text-white/35' : 'text-black/30 dark:text-white/30',
            )}
          >
            <Trans>选择后立即重新获取当前歌曲；自动匹配会按内置顺序尝试。</Trans>
          </p>
      </PlayerMenuContent>
    </Popover>
  )
}
