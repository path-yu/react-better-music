import { i18n } from '../i18n'

export function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ')
}

export function formatNumber(value?: number | null) {
  if (!value) return '0'
  // Chinese keeps the compact 万/亿 scale; other locales use Intl's compact
  // notation (5.1M / 1.4B) so play counts do not leak Chinese units.
  if (!i18n.locale.startsWith('zh')) {
    return new Intl.NumberFormat(i18n.locale, {
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(value)
  }
  // From 1 万 up, like NetEase: one decimal below 100 of a unit (5.7万,
  // 2.5亿), whole numbers above. Counts used to stay raw up to 99998, so one
  // grid mixed "57148" with "17万", and 2.5亿 rounded to "3亿".
  if (value < 10_000) return String(value)
  const scaled = (amount: number) =>
    amount < 100 ? String(Math.round(amount * 10) / 10) : String(Math.round(amount))
  // 99,999,999 rounds to 10000万: promote it to 1亿.
  if (Math.round(value / 10_000) < 10_000) return `${scaled(value / 10_000)}万`
  return `${scaled(value / 100_000_000)}亿`
}

/** "更新14首" -> "更新 14 首": NetEase chart frequencies omit the spaces. */
export function formatFrequency(value?: string) {
  return value?.replace(/(\D)(\d+)(\D)/, '$1 $2 $3').trim() ?? ''
}

/** `m:ss`, or `h:mm:ss` from one hour, everywhere a duration is shown. */
export function formatDuration(ms?: number | null) {
  if (!ms || ms < 0) return '0:00'
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${minutes}:${seconds}`
}

/** Time left as `-m:ss`, the alternative right-hand label of progress bars. */
export function formatRemaining(ms?: number | null) {
  return `-${formatDuration(Math.max(0, ms ?? 0))}`
}

export function formatDate(timestamp?: number | string | null, withTime = false) {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return ''
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  if (!withTime) return `${y}-${m}-${d}`
  const h = String(date.getHours()).padStart(2, '0')
  const min = String(date.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${d} ${h}:${min}`
}

export function formatArtists(artists?: Array<{ name: string }> | null) {
  if (!artists?.length) return ''
  return artists.map((artist) => artist.name).join(' / ')
}

export function getArrLast<T>(arr: T[]): T | undefined {
  return arr[arr.length - 1]
}

export function matchesKeyword(keyword: string, ...values: Array<string | undefined>) {
  const k = keyword.trim().toLowerCase()
  if (!k) return true
  return values.some((value) => value?.toLowerCase().includes(k))
}
