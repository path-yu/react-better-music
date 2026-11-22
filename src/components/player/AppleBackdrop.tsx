import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '../../lib/format'
import type { AppleBackdropScene } from '../../lib/appleBackdrop'

/**
 * Apple Music–style backdrop. PixiJS (~450 KB) is loaded only when this
 * option is chosen and the song page opens. Any failure (no WebGL, the
 * library chunk failing to load, the cover not loading, a lost GPU context)
 * falls back to the CSS ambient background.
 */
export function AppleBackdrop({
  artwork,
  playing,
  fallback,
  className,
}: {
  artwork: string | null | undefined
  playing: boolean
  fallback: ReactNode
  className?: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<AppleBackdropScene | null>(null)
  const [failed, setFailed] = useState(false)
  // Read by the async scene set-up below, which may finish after a few renders.
  const latest = useRef({ artwork, playing })
  useEffect(() => {
    latest.current = { artwork, playing }
  })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let disposed = false
    const fail = () => {
      if (disposed) return
      sceneRef.current?.destroy()
      sceneRef.current = null
      setFailed(true)
    }
    import('../../lib/appleBackdrop')
      .then(({ AppleBackdropScene }) => {
        if (disposed) return
        const scene = new AppleBackdropScene(canvas, fail)
        sceneRef.current = scene
        scene.setPlaying(latest.current.playing)
        void scene.setArtwork(latest.current.artwork).then((ok) => {
          if (!ok && !scene.hasArtwork) fail()
        })
      })
      .catch(fail)
    return () => {
      disposed = true
      sceneRef.current?.destroy()
      sceneRef.current = null
    }
  }, [])

  useEffect(() => {
    void sceneRef.current?.setArtwork(artwork)
  }, [artwork])

  useEffect(() => {
    sceneRef.current?.setPlaying(playing)
  }, [playing])

  if (failed) return <>{fallback}</>

  return (
    <div
      aria-hidden="true"
      // Apple's resting colour (white under a 50 % black + 5 % white veil),
      // shown while PixiJS and the cover load.
      style={{ backgroundColor: '#878787' }}
      className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  )
}
