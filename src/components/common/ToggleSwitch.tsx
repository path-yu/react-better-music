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
 * The switch's look on its own: track + thumb, no input. Used by ToggleSwitch
 * and by menu rows where the whole row is the button (a real input inside a
 * button would be nested interactive content). One component so the menu
 * switch can never drift from the settings switch again.
 *
 * `rounded-full` matters: styles.css gives every element squircle corners and
 * only exempts `rounded-full` (and a few named classes). A pill drawn with a
 * custom class and `border-radius: 999px` renders as a near-square.
 */
export function SwitchTrack({
  checked,
  className,
}: {
  checked: boolean
  className?: string
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex h-5 w-9 shrink-0 items-center rounded-full px-0.5 transition-colors duration-200 motion-reduce:transition-none',
        // Follow the active palette accent instead of a fixed green; the off
        // track uses the theme's strong border tone so it works in both themes.
        checked ? 'bg-accent' : 'bg-[var(--app-border-strong)]',
        className,
      )}
    >
      <span
        className={cn(
          'h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out motion-reduce:transition-none',
          checked ? 'translate-x-4' : 'translate-x-0',
        )}
      />
    </span>
  )
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
        <SwitchTrack
          checked={checked}
          className="peer-focus-visible:ring-2 peer-focus-visible:ring-accent/50"
        />
      </span>
    </label>
  )
}
