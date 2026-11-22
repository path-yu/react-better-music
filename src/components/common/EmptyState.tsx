import type { ReactNode } from 'react'
import { Disc3, RotateCw, TriangleAlert } from 'lucide-react'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { Trans } from '@lingui/react/macro'
import { cn } from '../../lib/format'

export function EmptyState({
  title,
  description,
  action,
  icon,
  variant = 'empty',
  onRetry,
}: {
  title?: string
  description?: string
  action?: ReactNode
  icon?: ReactNode
  /**
   * `error` distinguishes "the request failed" from "there is genuinely
   * nothing here", so users know whether to retry or change the query.
   */
  variant?: 'empty' | 'error'
  onRetry?: () => void
}) {
  const { i18n } = useLingui()
  const isError = variant === 'error'
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div
        className={cn(
          'flex h-14 w-14 items-center justify-center rounded-full',
          isError ? 'bg-[#ff2d55]/10 text-[#ff2d55]' : 'bg-black/4 text-black/25',
        )}
      >
        {icon ??
          (isError ? (
            <TriangleAlert className="h-6 w-6" strokeWidth={2} />
          ) : (
            <Disc3 className="h-6 w-6" strokeWidth={2} />
          ))}
      </div>
      <p className="mt-4 text-[13px] font-medium text-black/55">{title ?? i18n._(msg`暂无数据`)}</p>
      {description ? <p className="mt-1 text-[11.5px] text-black/30">{description}</p> : null}
      {action || (isError && onRetry) ? (
        <div className="mt-4 flex items-center gap-2">
          {action}
          {isError && onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="pressable flex items-center gap-1.5 rounded-full border border-black/10 bg-white px-4 py-1.5 text-[12px] text-black/70 transition-colors hover:bg-black/4 hover:text-black/85"
            >
              <RotateCw className="h-3.5 w-3.5" />
              <Trans>重试</Trans>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
