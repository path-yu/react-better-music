import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { Trans } from '@lingui/react/macro'
import { ListFilter } from 'lucide-react'
import { cn } from '../../lib/format'

/**
 * Toggle that narrows a song list to the rows NetEase cannot play directly
 * (no license, or another edition only) — the ones worth resolving through
 * `/song/url/match`.
 */
export function UnblockFilterButton({
  count,
  active,
  onToggle,
}: {
  count: number
  active: boolean
  onToggle: () => void
}) {
  const { i18n } = useLingui()
  const disabled = count === 0

  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      title={i18n._(msg`只显示无版权或其它版本可播的歌曲`)}
      onClick={onToggle}
      className={cn(
        'pressable flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[12px] transition-colors',
        active
          ? 'border-accent/40 bg-accent/10 text-accent'
          : 'border-black/8 bg-white/60 text-ink-3 hover:bg-black/4 hover:text-ink-2 dark:border-white/10 dark:bg-white/6 dark:text-white/60 dark:hover:bg-white/10',
        disabled && 'cursor-default opacity-40',
      )}
    >
      <ListFilter className="h-3.5 w-3.5" />
      <span>
        {active ? <Trans>仅看可换源</Trans> : <Trans>可换源</Trans>}
      </span>
      <span className="tabular-nums">{count}</span>
    </button>
  )
}
