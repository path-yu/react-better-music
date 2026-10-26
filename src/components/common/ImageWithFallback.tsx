import { memo, useLayoutEffect, useRef, useState } from 'react'
import { Music2 } from 'lucide-react'
import { cn } from '../../lib/format'

interface ImageWithFallbackProps {
  src?: string | null
  alt?: string
  className?: string
  imageClassName?: string
  rounded?: string
  /** Skip the materialize transition (useful for tiny, repaint-prone covers). */
  instant?: boolean
}

export const ImageWithFallback = memo(function ImageWithFallback({
  src,
  alt = '',
  className,
  imageClassName,
  rounded = 'rounded-[12px]',
  instant = false,
}: ImageWithFallbackProps) {
  const imgRef = useRef<HTMLImageElement>(null)
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null)
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  // Tracking the source instead of a boolean means a new image is never
  // rendered with the previous image's "loaded" state for a frame.
  const loaded = Boolean(src) && loadedSrc === src
  const failed = Boolean(src) && failedSrc === src

  useLayoutEffect(() => {
    const image = imgRef.current
    if (!src || !image?.complete) return
    // Cached images may finish before React attaches onLoad; check the element
    // directly before the first paint so they don't flash.
    if (image.naturalWidth > 0) setLoadedSrc(src)
    else if (image.currentSrc) setFailedSrc(src)
  }, [src])

  return (
    <div
      className={cn(
        'relative overflow-hidden bg-[#f0f0f2] dark:bg-white/[0.06]',
        rounded,
        className,
      )}
    >
      {failed || !src ? (
        <div className="image-fallback flex h-full w-full items-center justify-center bg-gradient-to-br from-[#ececf0] to-[#dedee4] text-black/20">
          <Music2 className="h-8 w-8" strokeWidth={1.5} />
        </div>
      ) : (
        <img
          key={src}
          ref={imgRef}
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={() => setLoadedSrc(src)}
          onError={() => setFailedSrc(src)}
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
