import { cn } from '../../lib/format'

interface ToggleSwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  /** Accessible name when the switch has no visible text label. */
  ariaLabel?: string
  className?: string
}

/**
 * CSS-only switch. Unlike Darwin's framer-motion switch, the initial render is
 * already in its checked position, so opening a popover does not animate the
 * thumb from off to on before the user touches anything.
 */
export function ToggleSwitch({
  checked,
  onChange,
  disabled = false,
  ariaLabel,
  className,
}: ToggleSwitchProps) {
  return (
    <label
      className={cn(
        'inline-flex items-center',
        disabled ? 'cursor-default opacity-50' : 'cursor-pointer',
        className,
      )}
    >
      <span className="relative inline-flex items-center">
        <input
          type="checkbox"
          role="switch"
          checked={checked}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          className="peer sr-only"
        />
        <span
          className={cn(
            'flex h-5 w-9 items-center rounded-full px-0.5 transition-colors duration-200 peer-focus-visible:ring-2 peer-focus-visible:ring-blue-500/50',
            checked ? 'bg-emerald-500' : 'bg-zinc-600',
          )}
        >
          <span
            className={cn(
              'h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out',
              checked ? 'translate-x-4' : 'translate-x-0',
            )}
          />
        </span>
      </span>
    </label>
  )
}
