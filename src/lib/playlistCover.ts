/**
 * Local playlists have no artwork of their own. When they are created from an
 * artist or a set of albums, the source images are stitched into a single
 * square and stored as a data URL, so the cover survives without the network
 * and without a second request per row.
 */
const OUTPUT_SIZE = 400
const IMAGE_TIMEOUT = 8_000

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image()
    // The CDN either allows CORS (composable) or the load fails; both are fine.
    image.crossOrigin = 'anonymous'
    const timer = window.setTimeout(() => resolve(null), IMAGE_TIMEOUT)
    image.onload = () => {
      window.clearTimeout(timer)
      resolve(image)
    }
    image.onerror = () => {
      window.clearTimeout(timer)
      resolve(null)
    }
    image.src = url
  })
}

/** Cover-fit one image into the given rect. */
function drawCover(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const scale = Math.max(width / image.width, height / image.height)
  const drawWidth = image.width * scale
  const drawHeight = image.height * scale
  context.save()
  context.beginPath()
  context.rect(x, y, width, height)
  context.clip()
  context.drawImage(
    image,
    x + (width - drawWidth) / 2,
    y + (height - drawHeight) / 2,
    drawWidth,
    drawHeight,
  )
  context.restore()
}

/**
 * Stitch up to four images into a square JPEG data URL.
 *
 * - 1 image: fills the square
 * - 2 images: side by side
 * - 3–4 images: 2×2 grid (empty cells stay the placeholder colour)
 *
 * Returns `null` when nothing could be loaded or the canvas cannot be
 * exported (no CORS); callers then keep a remote URL instead.
 */
export async function composePlaylistCover(
  urls: Array<string | null | undefined>,
): Promise<string | null> {
  const unique = [
    ...new Set(
      urls
        .map((url) => (typeof url === 'string' ? url.trim() : ''))
        .filter((url): url is string => Boolean(url)),
    ),
  ].slice(0, 4)
  if (!unique.length) return null

  const loaded = await Promise.all(unique.map(loadImage))
  const images = loaded.filter(
    (image): image is HTMLImageElement => Boolean(image),
  )
  if (!images.length) return null

  const canvas = document.createElement('canvas')
  canvas.width = OUTPUT_SIZE
  canvas.height = OUTPUT_SIZE
  const context = canvas.getContext('2d')
  if (!context) return null

  context.fillStyle = '#1c1c1e'
  context.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE)

  const half = OUTPUT_SIZE / 2
  images.forEach((image, index) => {
    if (images.length === 1) {
      drawCover(context, image, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE)
      return
    }
    if (images.length === 2) {
      drawCover(context, image, index * half, 0, half, OUTPUT_SIZE)
      return
    }
    const column = index % 2
    const row = Math.floor(index / 2)
    drawCover(context, image, column * half, row * half, half, half)
  })

  try {
    return canvas.toDataURL('image/jpeg', 0.82)
  } catch {
    // Tainted canvas: the image host refused CORS.
    return null
  }
}
