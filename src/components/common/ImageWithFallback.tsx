import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Music2 } from 'lucide-react'
import { cn } from '../../lib/format'
import { getCachedCoverUrl } from '../../lib/coverCache'
import { resizedImageUrl } from '../../lib/image'

interface ImageWithFallbackProps {
  src?: string | null
  alt?: string
  className?: string
  imageClassName?: string
  rounded?: string
  /** Skip the materialize transition (useful for tiny, repaint-prone covers). */
  instant?: boolean
  /** CDN resize hint, e.g. "300y300" or "480y270" (NetEase hosts only). */
  resize?: string
  /** Above-the-fold/LCP images should load eagerly with a high priority. */
  priority?: boolean
}

export const ImageWithFallback = memo(function ImageWithFallback({
  src,
  alt = '',
  className,
  imageClassName,
  rounded = 'rounded-[14px]',
  instant = false,
  resize,
  priority = false,
}: ImageWithFallbackProps) {
  const imgRef = useRef<HTMLImageElement>(null)
  const resolvedSrc = resizedImageUrl(src, resize) ?? null
  const [displaySrc, setDisplaySrc] = useState<string | null>(resolvedSrc)
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null)
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const displayRef = useRef<string | null>(resolvedSrc)
  displayRef.current = displaySrc
  // Tracking the source instead of a boolean means a new image is never
  // rendered with the previous image's "loaded" state for a frame.
  const loaded = Boolean(displaySrc) && loadedSrc === displaySrc
  const failed = Boolean(displaySrc) && failedSrc === displaySrc

  useEffect(() => {
    setDisplaySrc(resolvedSrc)
    setLoadedSrc(null)
    setFailedSrc(null)
  }, [resolvedSrc])

  useEffect(() => {
    if (!src || navigator.onLine !== false) return
    let active = true
    void getCachedCoverUrl(src).then((url) => {
      if (active && url) setDisplaySrc(url)
    })
    return () => {
      active = false
    }
  }, [src])

  useLayoutEffect(() => {
    const image = imgRef.current
    if (!displaySrc || !image?.complete) return
    // Cached images may finish before React attaches onLoad; check the element
    // directly before the first paint so they don't flash.
    if (image.naturalWidth > 0) setLoadedSrc(displaySrc)
    else if (image.currentSrc) setFailedSrc(displaySrc)
  }, [displaySrc])

  const handleError = () => {
    const failedCurrent = displaySrc
    if (!src || !failedCurrent || displaySrc !== resolvedSrc) {
      setFailedSrc(failedCurrent)
      return
    }
    void getCachedCoverUrl(src).then((url) => {
      if (displayRef.current !== failedCurrent) return
      if (!url) {
        setFailedSrc(failedCurrent)
        return
      }
      setDisplaySrc(url)
      setLoadedSrc(null)
      setFailedSrc(null)
    })
  }

  return (
    <div
      className={cn(
        'relative overflow-hidden bg-[#f0f0f2] dark:bg-white/[0.06]',
        rounded,
        className,
      )}
    >
      {failed || !displaySrc ? (
        <div className="image-fallback flex h-full w-full items-center justify-center bg-gradient-to-br from-[#ececf0] to-[#dedee4] text-black/20">
          <Music2 className="h-8 w-8" strokeWidth={1.75} />
        </div>
      ) : (
        <img
          key={displaySrc}
          ref={imgRef}
          src={displaySrc}
          alt={alt}
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : 'auto'}
          decoding="async"
          draggable={false}
          onLoad={() => setLoadedSrc(displaySrc)}
          onError={handleError}
          className={cn(
            'h-full w-full object-cover [backface-visibility:hidden]',
            instant
              ? 'opacity-100'
              : cn(
                  'transition-[opacity,filter,transform] duration-[360ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none',
                  loaded
                    ? 'scale-100 opacity-100 blur-[0px]'
                    : 'scale-[1.015] opacity-0 blur-[6px] will-change-[opacity,filter,transform]',
                ),
            imageClassName,
          )}
        />
      )}
    </div>
  )
})
