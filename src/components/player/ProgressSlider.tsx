import { useRef, useState } from 'react'
import { cn } from '../../lib/format'

interface ProgressSliderProps {
  value: number
  buffered?: number
  onChange?: (value: number) => void
  /** Human-readable position, e.g. "1:23 / 3:45", read by screen readers. */
  valueText?: string
  className?: string
}

/**
 * macOS-style seek bar: a 4px rounded track (AppKit's mini scrubber height)
 * with a 13px white knob that stays inside the track at both ends.
 */
const THUMB_SIZE = 13

export function ProgressSlider({
  value,
  buffered = 0,
  onChange,
  valueText,
  className,
}: ProgressSliderProps) {
  const [dragging, setDragging] = useState(false)
  const [preview, setPreview] = useState<number | null>(null)
  const draggingRef = useRef(false)
  const pendingRef = useRef<number | null>(null)
  const percent = Math.min(100, Math.max(0, preview ?? value))
  const bufferedPercent = Math.min(100, Math.max(0, buffered))

  const finishDrag = (commit: boolean) => {
    draggingRef.current = false
    setDragging(false)
    const pending = pendingRef.current
    pendingRef.current = null
    setPreview(null)
    if (commit && pending !== null) onChange?.(pending)
  }

  return (
    <div className={cn('seek-slider relative flex h-5 w-full items-center', className)}>
      <div className="seek-slider__track" />
      <div
        className="seek-slider__buffer"
        style={{ width: `${bufferedPercent}%` }}
      />
      <div
        data-testid="progress-fill"
        data-value={percent.toFixed(2)}
        className="seek-slider__fill"
        style={{ width: `${percent}%` }}
      />
      <div
        className={cn('seek-slider__thumb', dragging && 'is-dragging')}
        style={{ left: `calc(${percent}% - ${((percent / 100) * THUMB_SIZE).toFixed(2)}px)` }}
      />
      <input
        type="range"
        min={0}
        max={100}
        step={0.1}
        value={percent}
        aria-label="播放进度"
        aria-valuetext={valueText}
        className="seek-slider__input relative z-10 h-5 w-full cursor-pointer appearance-none bg-transparent opacity-0"
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
