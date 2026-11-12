import { useRef, useState } from 'react'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { cn, formatDuration } from '../../lib/format'

interface ImmersiveProgressBarProps {
  value: number
  durationMs: number
  onChange: (value: number) => void
  className?: string
}

const clamp = (value: number, min = 0, max = 100) =>
  Math.min(max, Math.max(min, value))

const THUMB_SIZE = 10

/**
 * Full-width scrubber that sits on the top edge of the player bar while an MV
 * is playing. It replaces the normal centre progress block and expands on
 * hover, showing the timestamp under the pointer.
 */
export function ImmersiveProgressBar({
  value,
  durationMs,
  onChange,
  className,
}: ImmersiveProgressBarProps) {
  const { i18n } = useLingui()
  const [hovering, setHovering] = useState(false)
  const [hoverPercent, setHoverPercent] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [preview, setPreview] = useState<number | null>(null)
  const draggingRef = useRef(false)
  const pendingRef = useRef<number | null>(null)
  const percent = clamp(preview ?? value)
  const duration = Math.max(0, durationMs)
  const hoverTime = (clamp(hoverPercent) / 100) * duration

  const updateHover = (clientX: number, element: HTMLElement) => {
    const rect = element.getBoundingClientRect()
    if (!rect.width) return
    setHoverPercent(clamp(((clientX - rect.left) / rect.width) * 100))
  }

  const finishDrag = (commit: boolean) => {
    draggingRef.current = false
    setDragging(false)
    const pending = pendingRef.current
    pendingRef.current = null
    setPreview(null)
    if (commit && pending !== null) onChange(pending)
  }

  return (
    <div
      data-testid="immersive-progress"
      className={cn(
        'group absolute inset-x-0 top-0 z-40 h-3',
        className,
      )}
      onPointerEnter={(event) => {
        setHovering(true)
        updateHover(event.clientX, event.currentTarget)
      }}
      onPointerLeave={() => {
        if (!draggingRef.current) setHovering(false)
      }}
      onPointerMove={(event) => {
        updateHover(event.clientX, event.currentTarget)
      }}
    >
      <div className="immersive-progress__track absolute inset-x-0 top-0 h-[2px] overflow-visible transition-[height] duration-150 group-hover:h-[4px]">
        <div
          className="immersive-progress__fill absolute inset-y-0 left-0"
          style={{ width: `${percent}%` }}
        />
        {hovering || dragging ? (
          <div
            className="absolute top-1/2 h-[10px] w-[10px] -translate-y-1/2 rounded-full"
            style={{
              // Inline colours: immersive player themes set a dark descendant
              // background that overrides the `bg-white` utility on this dot.
              backgroundColor: '#fff',
              boxShadow:
                '0 0 0 1px rgba(0,0,0,0.18), 0 1px 2px rgba(0,0,0,0.32)',
              // Keep the whole knob inside the bar at 0% and 100% instead of
              // letting its centre touch the window edge and clip in half.
              left: `calc(${percent}% - ${(percent / 100) * THUMB_SIZE}px)`,
            }}
          />
        ) : null}
      </div>

      {hovering && duration > 0 ? (
        <div
          className="pointer-events-none absolute bottom-3 -translate-x-1/2 whitespace-nowrap rounded-[5px] bg-black/75 px-1.5 py-0.5 text-[10px] tabular-nums text-white shadow-[0_2px_8px_rgba(0,0,0,0.35)] backdrop-blur-sm"
          style={{ left: `${clamp(hoverPercent, 4, 96)}%` }}
        >
          {formatDuration(hoverTime)}
        </div>
      ) : null}

      <input
        type="range"
        min={0}
        max={100}
        step={0.1}
        value={percent}
        aria-label={i18n._(msg`播放进度`)}
        aria-valuetext={`${formatDuration((percent / 100) * duration)} / ${formatDuration(duration)}`}
        className="absolute inset-0 h-3 w-full cursor-pointer appearance-none bg-transparent opacity-0"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          draggingRef.current = true
          setDragging(true)
          setPreview(percent)
          updateHover(event.clientX, event.currentTarget)
        }}
        onPointerMove={(event) => {
          updateHover(event.clientX, event.currentTarget)
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
            pendingRef.current = next
            setPreview(next)
          } else {
            setPreview(null)
            onChange(next)
          }
        }}
      />
    </div>
  )
}
