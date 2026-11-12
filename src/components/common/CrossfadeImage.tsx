import { memo, useEffect, useRef, useState } from 'react'
import { Music2 } from 'lucide-react'
import { cn } from '../../lib/format'
import { resizedImageUrl } from '../../lib/image'

interface CrossfadeImageProps {
  src?: string | null
  alt?: string
  className?: string
  rounded?: string
  resize?: string
  priority?: boolean
  /** Keep the outgoing cover visible while the new one fades over it. */
  durationMs?: number
}

/**
 * Album-art cover with a true crossfade: the old layer stays mounted and sharp
 * until the new image has loaded, then the new layer fades in above it. This
 * avoids the grey placeholder flash caused by replacing the <img> key.
 */
export const CrossfadeImage = memo(function CrossfadeImage({
  src,
  alt = '',
  className,
  rounded = 'rounded-[14px]',
  resize,
  priority = false,
  durationMs = 620,
}: CrossfadeImageProps) {
  const resolvedSrc = resizedImageUrl(src, resize) ?? ''
  const [displayedSrc, setDisplayedSrc] = useState(resolvedSrc)
  const [failedSrc, setFailedSrc] = useState('')
  const [incomingSrc, setIncomingSrc] = useState('')
  const [incomingVisible, setIncomingVisible] = useState(false)
  const incomingRef = useRef<HTMLImageElement>(null)

  useEffect(() => {
    if (!resolvedSrc) {
      setDisplayedSrc('')
      setIncomingSrc('')
      setIncomingVisible(false)
      return
    }
    if (resolvedSrc === displayedSrc) return
    if (!displayedSrc) {
      setDisplayedSrc(resolvedSrc)
      return
    }
    setIncomingSrc(resolvedSrc)
    setIncomingVisible(false)
  }, [displayedSrc, resolvedSrc])

  // Cached covers can finish before React attaches onLoad. Schedule the
  // reveal on the next frame so the opacity 0 -> 1 transition still runs
  // instead of committing the image at full opacity in the first paint.
  useEffect(() => {
    if (!incomingSrc) return
    const image = incomingRef.current
    if (!image?.complete || image.naturalWidth <= 0) return
    const frame = window.requestAnimationFrame(() => setIncomingVisible(true))
    return () => window.cancelAnimationFrame(frame)
  }, [incomingSrc])

  useEffect(() => {
    if (!incomingSrc || !incomingVisible) return
    const timer = window.setTimeout(() => {
      setDisplayedSrc(incomingSrc)
      setIncomingSrc('')
      setIncomingVisible(false)
    }, durationMs)
    return () => window.clearTimeout(timer)
  }, [durationMs, incomingSrc, incomingVisible])

  const frameClass = cn(
    'relative overflow-hidden bg-[#f0f0f2] dark:bg-white/[0.06]',
    rounded,
    className,
  )

  return (
    <div className={frameClass}>
      {displayedSrc && failedSrc !== displayedSrc ? (
        <img
          src={displayedSrc}
          alt={alt}
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : 'auto'}
          decoding="async"
          draggable={false}
          onError={() => setFailedSrc(displayedSrc)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div className="image-fallback flex h-full w-full items-center justify-center bg-gradient-to-br from-[#ececf0] to-[#dedee4] text-black/20">
          <Music2 className="h-8 w-8" strokeWidth={1.75} />
        </div>
      )}

      {incomingSrc ? (
        <img
          key={incomingSrc}
          ref={incomingRef}
          src={incomingSrc}
          alt=""
          aria-hidden="true"
          loading="eager"
          fetchPriority={priority ? 'high' : 'auto'}
          decoding="async"
          draggable={false}
          onLoad={() => {
            window.requestAnimationFrame(() => setIncomingVisible(true))
          }}
          onError={() => {
            setIncomingSrc('')
            setIncomingVisible(false)
          }}
          style={{ transitionDuration: `${durationMs}ms` }}
          className={cn(
            'pointer-events-none absolute inset-0 h-full w-full object-cover',
            'transition-[opacity,transform,filter] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
            incomingVisible
              ? 'scale-100 opacity-100 blur-[0px]'
              : 'scale-[1.015] opacity-0 blur-[6px]',
          )}
        />
      ) : null}
    </div>
  )
})
