import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'

interface KaraokeVocalFaderProps {
  value: number
  onChange: (value: number) => void
}

/** Compact vertical vocal fader used only by the karaoke mix. */
export function KaraokeVocalFader({
  value,
  onChange,
}: KaraokeVocalFaderProps) {
  const { i18n } = useLingui()
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const percent = Math.min(100, Math.max(0, value))

  const emit = (clientY: number) => {
    const track = trackRef.current
    if (!track) return
    const rect = track.getBoundingClientRect()
    if (!rect.height) return
    const ratio = 1 - (clientY - rect.top) / rect.height
    onChange(Math.round(Math.min(1, Math.max(0, ratio)) * 100) / 100)
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(true)
    emit(event.clientY)
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (dragging) emit(event.clientY)
  }

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    setDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    let next = percent
    switch (event.key) {
      case 'ArrowUp':
      case 'ArrowRight':
        next += 2
        break
      case 'ArrowDown':
      case 'ArrowLeft':
        next -= 2
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
    onChange(Math.min(100, Math.max(0, next)) / 100)
  }

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={0}
      aria-label={i18n._(msg`随心唱人声音量`)}
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(percent)}
      aria-valuetext={`${Math.round(percent)}%`}
      title={`${i18n._(msg`随心唱人声音量`)} ${Math.round(percent)}%`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={handleKeyDown}
      className="relative h-12 w-2.5 cursor-pointer touch-none select-none overflow-hidden rounded-full bg-white/14 outline-none ring-white/30 transition-shadow focus-visible:ring-2"
    >
      <div
        className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-emerald-300/80 to-teal-200/70 transition-[height] duration-150"
        style={{ height: `${percent}%` }}
      />
    </div>
  )
}
