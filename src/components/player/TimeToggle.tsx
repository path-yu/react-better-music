import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { cn } from '../../lib/format'
import { useSettingsStore } from '../../store/settings'

/**
 * Right-hand label of a progress bar. Clicking flips total length / time left
 * for every progress bar at once (the same setting as 设置 → 播放).
 */
export function TimeToggle({
  label,
  showRemaining,
  className,
}: {
  label: string
  showRemaining: boolean
  className?: string
}) {
  const { i18n } = useLingui()
  const hint = showRemaining
    ? i18n._(msg`点击切换为总时长`)
    : i18n._(msg`点击切换为剩余时间`)
  return (
    <button
      type="button"
      title={hint}
      aria-label={`${label}, ${hint}`}
      onClick={(event) => {
        // The player bar treats a click on itself as "close the queue".
        event.stopPropagation()
        const settings = useSettingsStore.getState()
        settings.setShowRemainingTime(!settings.showRemainingTime)
      }}
      className={cn('cursor-pointer transition-colors', className)}
    >
      {label}
    </button>
  )
}
