export function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ')
}

export function formatNumber(value?: number | null) {
  if (!value) return '0'
  if (value < 99999) return String(value)
  if (value < 100000000) return `${Math.round(value / 10000)}万`
  return `${Math.round(value / 100000000)}亿`
}

export function formatDuration(ms?: number | null) {
  if (!ms || ms < 0) return '00:00'
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
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

export function throttle<Args extends unknown[]>(fn: (...args: Args) => void, delay: number) {
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastArgs: Args | null = null
  return (...args: Args) => {
    lastArgs = args
    if (timer) return
    timer = setTimeout(() => {
      timer = null
      if (lastArgs) fn(...lastArgs)
    }, delay)
  }
}

export function debounce<Args extends unknown[]>(fn: (...args: Args) => void, delay: number) {
  let timer: ReturnType<typeof setTimeout> | null = null
  return (...args: Args) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      fn(...args)
    }, delay)
  }
}

export function isEven(value: number) {
  return value % 2 === 0
}

export function matchesKeyword(keyword: string, ...values: Array<string | undefined>) {
  const k = keyword.trim().toLowerCase()
  if (!k) return true
  return values.some((value) => value?.toLowerCase().includes(k))
}
