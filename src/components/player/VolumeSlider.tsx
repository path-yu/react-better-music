import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { cn } from '../../lib/format'

interface VolumeSliderProps {
  value: number
  onChange: (value: number) => void
  className?: string
}

/**
 * Vertical twin of `ProgressSlider`: same macOS tokens (4px rounded track,
 * 13px white knob) defined once in `styles.css` for both sliders.
 */
const THUMB_SIZE = 13

export function VolumeSlider({ value, onChange, className }: VolumeSliderProps) {
  const { i18n } = useLingui()
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const percent = Math.min(100, Math.max(0, value))

  const emitFromPointer = (clientY: number) => {
    const track = trackRef.current
    if (!track) return
    const rect = track.getBoundingClientRect()
    if (!rect.height) return
    const ratio = 1 - (clientY - rect.top) / rect.height
    onChange(Math.round(Math.min(1, Math.max(0, ratio)) * 100))
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(true)
    emitFromPointer(event.clientY)
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return
    emitFromPointer(event.clientY)
  }

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    setDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    let next: number
    switch (event.key) {
      case 'ArrowUp':
      case 'ArrowRight':
        next = value + 1
        break
      case 'ArrowDown':
      case 'ArrowLeft':
        next = value - 1
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = 100
        break
      default:
        return
    }
    event.preventDefault()
    onChange(Math.min(100, Math.max(0, next)))
  }

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={0}
      aria-label={i18n._(msg`音量`)}
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(percent)}
      aria-valuetext={`音量 ${Math.round(percent)}%`}
      data-testid="volume-slider"
      data-value={percent.toFixed(0)}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={handleKeyDown}
      className={cn(
        'volume-slider relative flex h-[112px] w-7 cursor-pointer touch-none select-none items-center justify-center outline-none',
        className,
      )}
    >
      <div className="volume-slider__track">
        <div className="volume-slider__fill" style={{ height: `${percent}%` }} />
        <div
          className={cn('volume-slider__thumb', dragging && 'is-dragging')}
          style={{
            bottom: `calc(${percent}% - ${((percent / 100) * THUMB_SIZE).toFixed(2)}px)`,
          }}
        />
      </div>
    </div>
  )
}
