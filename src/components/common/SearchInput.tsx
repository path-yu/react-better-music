import type { InputHTMLAttributes } from 'react'
import { X } from 'lucide-react'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { Input } from '@pikoloo/darwin-ui'
import { cn } from '../../lib/format'

interface SearchInputProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    'value' | 'onChange' | 'size' | 'className'
  > {
  value: string
  onChange: (value: string) => void
  /** Runs after the field is cleared (close suggestions, reset highlights). */
  onClear?: () => void
  ariaLabel?: string
  size?: 'sm' | 'md' | 'lg'
  /** Text/size classes for the input itself (rounding, font size). */
  className?: string
  /** Width and layout classes for the wrapper; the input fills it. */
  wrapperClassName?: string
  /** Extra classes for the clear button (hit area, colours). */
  clearClassName?: string
}

/**
 * Darwin's `Input.Search` has no clear affordance, and its right-side icon slot
 * is `pointer-events-none`. This wraps it with a floating button that keeps the
 * input focused, so clearing never closes an open suggestion list.
 */
export function SearchInput({
  value,
  onChange,
  onClear,
  placeholder,
  ariaLabel,
  size = 'sm',
  className,
  wrapperClassName,
  clearClassName,
  ...rest
}: SearchInputProps) {
  const { i18n } = useLingui()
  return (
    <div className={cn('relative', wrapperClassName)}>
      <Input.Search
        {...rest}
        value={value}
        size={size}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          // The top bar is a drag region; interactive controls opt out.
          'electrobun-webkit-app-region-no-drag',
          value ? 'pr-8' : undefined,
          className,
        )}
      />
      {value ? (
        <button
          type="button"
          aria-label={i18n._(msg`清除搜索`)}
          title={i18n._(msg`清除搜索`)}
          // Keep focus (and any open suggestion list) while clicking.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            onChange('')
            onClear?.()
          }}
          className={cn(
            'pressable electrobun-webkit-app-region-no-drag absolute right-1.5 top-1/2 z-10 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-ink-4 transition-colors hover:bg-black/10 hover:text-ink-2 dark:text-white/40 dark:hover:bg-white/15 dark:hover:text-white',
            clearClassName,
          )}
        >
          <X className="h-3 w-3" />
        </button>
      ) : null}
    </div>
  )
}
