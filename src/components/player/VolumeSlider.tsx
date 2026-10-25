import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { cn } from '../../lib/format'

interface VolumeSliderProps {
  value: number
  onChange: (value: number) => void
  className?: string
}

export function VolumeSlider({ value, onChange, className }: VolumeSliderProps) {
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
    let next = value
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
      aria-label="音量"
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(percent)}
      data-testid="volume-slider"
      data-value={percent.toFixed(0)}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={handleKeyDown}
      className={cn(
        'group relative flex h-[112px] w-7 cursor-pointer touch-none select-none items-center justify-center outline-none',
        className,
      )}
    >
      <div className="relative h-full w-[4px] rounded-full bg-black/10">
        <div
          className="absolute bottom-0 left-0 w-full rounded-full bg-[#0066cc]"
          style={{ height: `${percent}%` }}
        />
        <div
          className={cn(
            'pointer-events-none absolute left-1/2 h-3 w-3 -translate-x-1/2 translate-y-1/2 rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.3)] ring-1 ring-black/5 transition-transform',
            dragging ? 'scale-110' : 'group-hover:scale-110',
          )}
          style={{ bottom: `${percent}%` }}
        />
      </div>
    </div>
  )
}
