/**
 * One optical scale for every Lucide icon.
 *
 * Apple's SF Symbols tune stroke weight per point size; Lucide's default 2px
 * stroke becomes visually heavy at 12–16px and too light at 24px. Components
 * should use these buckets instead of ad-hoc sizes/strokes.
 */
export const ICON_TOKENS = {
  xs: { size: 12, strokeWidth: 1.5 },
  sm: { size: 14, strokeWidth: 1.6 },
  md: { size: 16, strokeWidth: 1.75 },
  lg: { size: 20, strokeWidth: 1.9 },
  xl: { size: 24, strokeWidth: 2 },
} as const

export type IconToken = keyof typeof ICON_TOKENS
