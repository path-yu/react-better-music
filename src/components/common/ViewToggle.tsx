import type { ReactNode } from 'react'
import { cn } from '../../lib/format'

export interface ViewToggleOption<T extends string> {
  value: T
  /** Accessible name and tooltip, already translated by the caller. */
  label: string
  icon: ReactNode
}

interface ViewToggleProps<T extends string> {
  value: T
  options: ReadonlyArray<ViewToggleOption<T>>
  onChange: (value: T) => void
  /** `dark` matches the immersive player surface, `light` the page surface. */
  tone?: 'light' | 'dark'
  /** Group label for screen readers, e.g. "队列视图". */
  label: string
  className?: string
}

/**
 * Two-position view switch (list / grid) with a sliding thumb. Shared by the
 * playback queue and the library page so both look and behave identically.
 */
export function ViewToggle<T extends string>({
  value,
  options,
  onChange,
  tone = 'light',
  label,
  className,
}: ViewToggleProps<T>) {
  const activeIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  )
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        'relative flex h-8 shrink-0 items-center rounded-full p-1',
        tone === 'dark'
          ? 'bg-white/6 backdrop-blur-md'
          : 'bg-[var(--app-chip)]',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute left-1 top-1 h-6 w-6 rounded-full transition-transform duration-150 ease-out motion-reduce:transition-none',
          tone === 'dark'
            ? 'bg-white/16 shadow-[0_1px_4px_rgba(0,0,0,0.28)]'
            : 'bg-white shadow-sm dark:bg-white/20',
        )}
        style={{ transform: `translateX(${activeIndex * 24}px)` }}
      />
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            aria-label={option.label}
            title={option.label}
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'relative z-10 flex h-6 w-6 items-center justify-center rounded-full transition-colors duration-150',
              active
                ? tone === 'dark'
                  ? 'text-white'
                  : 'text-ink-1'
                : tone === 'dark'
                  ? 'text-white/65 hover:text-white/90'
                  : 'text-ink-4 hover:text-ink-2',
            )}
          >
            {option.icon}
          </button>
        )
      })}
    </div>
  )
}
