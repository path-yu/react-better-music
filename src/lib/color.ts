import { apiUrl } from './http'

const paletteCache = new Map<string, string[]>()

function toRgb(value: string): [number, number, number] | null {
  const hex = value.trim().match(/^#([\da-f]{3,8})$/i)
  if (hex) {
    const digits = hex[1]
    if (digits.length === 3 || digits.length === 4) {
      return [
        parseInt(digits[0] + digits[0], 16),
        parseInt(digits[1] + digits[1], 16),
        parseInt(digits[2] + digits[2], 16),
      ]
    }
    if (digits.length === 6 || digits.length === 8) {
      return [
        parseInt(digits.slice(0, 2), 16),
        parseInt(digits.slice(2, 4), 16),
        parseInt(digits.slice(4, 6), 16),
      ]
    }
    return null
  }
  const match = value.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/)
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

/**
 * Mix `color` into `base`. `amount` is how much of `color` is used (0 - 1).
 */
export function mixColor(color: string, base: string, amount: number) {
  const source = toRgb(color)
  const target = toRgb(base)
  if (!source || !target) return base
  const ratio = Math.min(1, Math.max(0, amount))
  const channels = source.map((channel, index) =>
    Math.round(channel * ratio + target[index] * (1 - ratio)),
  )
  return `rgb(${channels.join(', ')})`
}

/** Same colour, but translucent — used for the ambient now-playing gradients. */
export function withAlpha(color: string, alpha: number) {
  const rgb = toRgb(color)
  if (!rgb) return color
  const value = Math.min(1, Math.max(0, alpha))
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${value})`
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.decoding = 'async'
    image.onload = () => resolve(image)
    image.onerror = () => resolve(null)
    image.src = url
  })
}

const failedProxySources = new Set<string>()

/**
 * The local API server exposes a same-origin image proxy. Using the returned
 * data URL guarantees an untainted canvas even when the image CDN or a
 * developer proxy environment interferes with CORS requests.
 */
async function loadProxiedImage(src: string): Promise<HTMLImageElement | null> {
  if (failedProxySources.has(src)) return null
  try {
    const response = await fetch(apiUrl('/img/proxy', { url: src }), {
      credentials: 'include',
    })
    if (!response.ok) {
      failedProxySources.add(src)
      return null
    }
    const payload = (await response.json()) as { code?: number; data?: string }
    if (payload.code !== 200 || !payload.data) {
      failedProxySources.add(src)
      return null
    }
    return await loadImage(payload.data)
  } catch {
    failedProxySources.add(src)
    return null
  }
}

interface Bucket {
  r: number
  g: number
  b: number
  count: number
  score: number
}

function sampleBuckets(image: HTMLImageElement): Bucket[] {
  const canvas = document.createElement('canvas')
  try {
    const size = 32
    canvas.width = size
    canvas.height = size
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return []
    context.drawImage(image, 0, 0, size, size)
    const { data } = context.getImageData(0, 0, size, size)

    const buckets = new Map<number, Bucket>()
    for (let index = 0; index < data.length; index += 4) {
      const r = data[index]
      const g = data[index + 1]
      const b = data[index + 2]
      const alpha = data[index + 3]
      if (alpha < 180) continue

      const max = Math.max(r, g, b)
      const min = Math.min(r, g, b)
      if (max < 26 || min > 244) continue

      const saturation = (max - min) / 255
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
      const bucket = buckets.get(key)
      if (bucket) {
        bucket.r += r
        bucket.g += g
        bucket.b += b
        bucket.count += 1
        bucket.score += 1 + saturation * 4.5
      } else {
        buckets.set(key, {
          r,
          g,
          b,
          count: 1,
          score: 1 + saturation * 4.5,
        })
      }
    }

    return [...buckets.values()]
  } catch {
    return []
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}

function bucketColor(bucket: Bucket) {
  return `rgb(${Math.round(bucket.r / bucket.count)}, ${Math.round(
    bucket.g / bucket.count,
  )}, ${Math.round(bucket.b / bucket.count)})`
}

function bucketDistance(a: Bucket, b: Bucket) {
  return Math.hypot(
    a.r / a.count - b.r / b.count,
    a.g / a.count - b.g / b.count,
    a.b / a.count - b.b / b.count,
  )
}

/**
 * Apple Music builds its lyrics backdrop as a mesh of several artwork colours,
 * not a single tint. Return the most prominent yet visually distinct buckets.
 */
function samplePalette(image: HTMLImageElement, count: number): string[] {
  const buckets = sampleBuckets(image).sort((a, b) => b.score - a.score)
  if (!buckets.length) return []

  const picked: Bucket[] = []
  for (const bucket of buckets) {
    if (picked.length === count) break
    if (picked.every((entry) => bucketDistance(entry, bucket) >= 64)) picked.push(bucket)
  }
  // Palettes with fewer distinct hues still need enough stops for the mesh.
  for (const bucket of buckets) {
    if (picked.length === count) break
    if (!picked.includes(bucket)) picked.push(bucket)
  }
  return picked.map(bucketColor)
}

/**
 * Extract a small, visually distinct palette from an artwork image using a
 * quantised canvas sample. A resized probe URL is requested first so the
 * CORS request never reuses a non-CORS cache entry from a regular <img>.
 */
export async function extractArtworkPalette(
  src?: string | null,
  count = 4,
): Promise<string[]> {
  if (!src) return []
  const cached = paletteCache.get(src)
  if (cached) return cached.slice(0, count)

  const separator = src.includes('?') ? '&' : '?'
  const probe = `${src}${separator}param=64y64`

  let palette: string[] = []
  const proxied = await loadProxiedImage(src)
  if (proxied) palette = samplePalette(proxied, 5)

  if (!palette.length) {
    const probeImage = await loadImage(probe)
    if (probeImage) palette = samplePalette(probeImage, 5)
  }

  if (!palette.length) {
    const fallbackImage = await loadImage(src)
    if (fallbackImage) palette = samplePalette(fallbackImage, 5)
  }

  if (palette.length) paletteCache.set(src, palette)
  return palette.slice(0, count)
}

/** Backwards compatible single-colour helper. */
export async function extractDominantColor(src?: string | null): Promise<string | null> {
  const [color] = await extractArtworkPalette(src, 1)
  return color ?? null
}
