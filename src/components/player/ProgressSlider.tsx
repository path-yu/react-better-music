import { useRef, useState } from 'react'
import { cn } from '../../lib/format'

interface ProgressSliderProps {
  value: number
  buffered?: number
  onChange?: (value: number) => void
  className?: string
}

export function ProgressSlider({ value, buffered = 0, onChange, className }: ProgressSliderProps) {
  const [dragging, setDragging] = useState(false)
  const [preview, setPreview] = useState<number | null>(null)
  const draggingRef = useRef(false)
  const pendingRef = useRef<number | null>(null)
  const percent = Math.min(100, Math.max(0, preview ?? value))

  const finishDrag = (commit: boolean) => {
    draggingRef.current = false
    setDragging(false)
    const pending = pendingRef.current
    pendingRef.current = null
    setPreview(null)
    if (commit && pending !== null) onChange?.(pending)
  }

  return (
    <div className={cn('group relative flex h-4 w-full items-center', className)}>
      <div className="absolute h-[3px] w-full rounded-full bg-black/10" />
      <div
        className="absolute h-[3px] rounded-full bg-black/20 transition-[width] duration-200"
        style={{ width: `${Math.min(100, Math.max(0, buffered))}%` }}
      />
      <div
        data-testid="progress-fill"
        data-value={percent.toFixed(2)}
        className="absolute h-[3px] rounded-full bg-[#0066cc]"
        style={{ width: `${percent}%` }}
      />
      <div
        className={cn(
          'pointer-events-none absolute h-[9px] w-[9px] -translate-x-1/2 rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.35)] transition-opacity',
          dragging ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
        )}
        style={{ left: `${percent}%` }}
      />
      <input
        type="range"
        min={0}
        max={100}
        step={0.1}
        value={percent}
        aria-label="播放进度"
        className="relative z-10 h-4 w-full cursor-pointer appearance-none bg-transparent opacity-0"
        onPointerDown={(event) => {
          // Capture the pointer so releasing outside the input still commits
          // the seek instead of leaving the slider stuck in drag mode.
          event.currentTarget.setPointerCapture(event.pointerId)
          draggingRef.current = true
          setDragging(true)
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
          }
          finishDrag(true)
        }}
        onPointerCancel={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
          }
          finishDrag(false)
        }}
        onLostPointerCapture={() => {
          if (draggingRef.current) finishDrag(true)
        }}
        onChange={(event) => {
          const next = Number(event.target.value)
          if (draggingRef.current) {
            // Follow the pointer locally and only seek once on release, so the
            // player/lyrics tree is not re-rendered on every pointer move.
            pendingRef.current = next
            setPreview(next)
          } else {
            setPreview(null)
            onChange?.(next)
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.stopPropagation()
          }
        }}
      />
    </div>
  )
}
