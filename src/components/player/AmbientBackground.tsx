import { useMemo, type CSSProperties } from 'react'
import { cn } from '../../lib/format'
import { FALLBACK_PALETTE, hexToRgb, type Palette } from '../../lib/color'

type Props = {
  artwork: string
  palette: Palette
  /** Kept for the fog fallback call site; the still backdrop does not pulse. */
  playing?: boolean
  soft?: boolean
  className?: string
}

function rgbToHsv(r: number, g: number, b: number) {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  let h = 0
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6
    else if (max === g) h = (b - r) / delta + 2
    else h = (r - g) / delta + 4
    h *= 60
    if (h < 0) h += 360
  }
  return {
    h,
    s: max === 0 ? 0 : delta / max,
    v: max / 255,
  }
}

function hsvToHex(h: number, s: number, v: number) {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  let r = 0
  let g = 0
  let b = 0
  if (h < 60) [r, g] = [c, x]
  else if (h < 120) [r, g] = [x, c]
  else if (h < 180) [g, b] = [c, x]
  else if (h < 240) [g, b] = [x, c]
  else if (h < 300) [r, b] = [x, c]
  else [r, b] = [c, x]
  const hex = (value: number) =>
    Math.round((value + m) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${hex(r)}${hex(g)}${hex(b)}`
}

/**
 * The reference renderer's still backdrop: a deep Oklab gradient made from the
 * cover's hue, a faint blurred cover wash, then a little darkening under the
 * controls. It is deliberately not the multi-blob animated wash.
 */
function backdropColors(tint: string) {
  const { r, g, b } = hexToRgb(tint)
  const { h, s: rawS } = rgbToHsv(r, g, b)
  const s =
    rawS > 0.12
      ? Math.min(0.66, Math.max(0.45, rawS * 1.3))
      : rawS
  return {
    top: hsvToHex(h, s, 0.35),
    foot: hsvToHex(h, Math.min(s * 1.05, 0.7), 0.24),
  }
}

export default function AmbientBackground({
  artwork,
  palette,
  className,
}: Props) {
  const tint = palette.colors[0] ?? FALLBACK_PALETTE.colors[0]
  const colors = useMemo(() => backdropColors(tint), [tint])

  return (
    <div
      className={cn(
        'ambient-backdrop pointer-events-none absolute inset-0 overflow-hidden',
        className,
      )}
      style={
        {
          '--ambient-bg-top': colors.top,
          '--ambient-bg-foot': colors.foot,
          background:
            'linear-gradient(in oklab, var(--ambient-bg-top) 0%, var(--ambient-bg-foot) 100%)',
        } as CSSProperties
      }
    >
      {artwork ? (
        <img
          key={artwork}
          src={artwork}
          alt=""
          aria-hidden
          className="ambient-art absolute inset-0 h-full w-full scale-[1.25] object-cover opacity-[0.1] blur-[56px] saturate-[1.15]"
        />
      ) : null}
      <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent_55%,rgba(0,0,0,0.18)_100%)]" />
    </div>
  )
}

/** Static wash used only when the cover has not been sampled yet. */
export function FallbackWash({ palette }: { palette: Palette }) {
  const colors = backdropColors(palette.colors[0] ?? FALLBACK_PALETTE.colors[0])
  return (
    <div
      className="ambient-backdrop absolute inset-0"
      style={
        {
          '--ambient-bg-top': colors.top,
          '--ambient-bg-foot': colors.foot,
          background:
            'linear-gradient(in oklab, var(--ambient-bg-top) 0%, var(--ambient-bg-foot) 100%)',
        } as CSSProperties
      }
    />
  )
}
