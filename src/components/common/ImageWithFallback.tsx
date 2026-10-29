import { memo, useLayoutEffect, useRef, useState } from 'react'
import { Music2 } from 'lucide-react'
import { cn } from '../../lib/format'
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
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null)
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const resolvedSrc = resizedImageUrl(src, resize)
  // Tracking the source instead of a boolean means a new image is never
  // rendered with the previous image's "loaded" state for a frame.
  const loaded = Boolean(resolvedSrc) && loadedSrc === resolvedSrc
  const failed = Boolean(resolvedSrc) && failedSrc === resolvedSrc

  useLayoutEffect(() => {
    const image = imgRef.current
    if (!resolvedSrc || !image?.complete) return
    // Cached images may finish before React attaches onLoad; check the element
    // directly before the first paint so they don't flash.
    if (image.naturalWidth > 0) setLoadedSrc(resolvedSrc)
    else if (image.currentSrc) setFailedSrc(resolvedSrc)
  }, [resolvedSrc])

  return (
    <div
      className={cn(
        'relative overflow-hidden bg-[#f0f0f2] dark:bg-white/[0.06]',
        rounded,
        className,
      )}
    >
      {failed || !resolvedSrc ? (
        <div className="image-fallback flex h-full w-full items-center justify-center bg-gradient-to-br from-[#ececf0] to-[#dedee4] text-black/20">
          <Music2 className="h-8 w-8" strokeWidth={1.75} />
        </div>
      ) : (
        <img
          key={resolvedSrc}
          ref={imgRef}
          src={resolvedSrc}
          alt={alt}
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : 'auto'}
          decoding="async"
          draggable={false}
          onLoad={() => setLoadedSrc(resolvedSrc)}
          onError={() => setFailedSrc(resolvedSrc)}
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
