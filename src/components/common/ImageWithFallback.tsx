import { useEffect, useRef, useState } from 'react'
import { Music2 } from 'lucide-react'
import { cn } from '../../lib/format'

interface ImageWithFallbackProps {
  src?: string | null
  alt?: string
  className?: string
  imageClassName?: string
  rounded?: string
}

export function ImageWithFallback({
  src,
  alt = '',
  className,
  imageClassName,
  rounded = 'rounded-[12px]',
}: ImageWithFallbackProps) {
  const imgRef = useRef<HTMLImageElement>(null)
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setLoaded(false)
    setFailed(false)
    // Cached images may finish before React attaches onLoad; check the
    // element directly so the cover never stays at opacity 0.
    const image = imgRef.current
    if (!image?.complete) return
    if (image.naturalWidth > 0) setLoaded(true)
    else if (image.currentSrc) setFailed(true)
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
          ref={imgRef}
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={cn(
            'h-full w-full object-cover',
            'transition-[opacity,filter,transform] duration-[360ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none',
            loaded
              ? 'scale-100 opacity-100 blur-[0px]'
              : 'scale-[1.015] opacity-0 blur-[6px] will-change-[opacity,filter,transform]',
            imageClassName,
          )}
        />
      )}
    </div>
  )
}
