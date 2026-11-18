import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
} from 'react'
import { Disc3, Heart } from 'lucide-react'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { Trans } from '@lingui/react/macro'
import { ImageWithFallback } from '../common/ImageWithFallback'
import { cn, formatArtists } from '../../lib/format'
import { getAudio } from '../../lib/audio'
import { usePlayerStore } from '../../store/player'
import type { PlayerStyle } from '../../store/settings'
import type { Song } from '../../types'
import deckArt from '../../assets/retro/deck-base.png'
import recordArt from '../../assets/retro/record.png'
import armArt from '../../assets/retro/arm.png'
import armShadowArt from '../../assets/retro/arm-shadow.png'
import cassetteArt from '../../assets/retro/cassette.png'
import hubArt from '../../assets/retro/hub.png'

/** The artwork is a square; the cassette shell is 1 / 0.64 like the source. */
const DECK = {
  cx: 0.445,
  cy: 0.5,
  pivotX: 0.835,
  pivotY: 0.185,
  platter: 0.415,
  record: 0.385,
  label: 0.36,
  rest: Math.PI / 2 - 0.08,
  armTube: 0.49,
  stylusAt: 0.1,
  headshellTurn: (20 * Math.PI) / 180,
  armBack: 0.17,
  armFront: 0.66,
  armSide: 0.085,
}

const TAPE = {
  height: 0.64,
  reelY: 0.315,
  reelL: 0.2875,
  reelR: 0.7125,
  hub: 0.055,
  full: 0.19,
  labelY0: 0.045,
  labelY1: 0.445,
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value))
}

/**
 * The source draws the tonearm as a bitmap rotated around its gimbal. The
 * stylus starts at the record's edge and approaches the label as playback
 * advances.
 */
function tonearmPlayedAngle(progress: number) {
  const d = Math.hypot(DECK.cx - DECK.pivotX, DECK.cy - DECK.pivotY)
  const stylusX =
    DECK.armTube - 0.005 + DECK.stylusAt * Math.cos(DECK.headshellTurn)
  const stylusY = DECK.stylusAt * Math.sin(DECK.headshellTurn)
  const reach = Math.hypot(stylusX, stylusY)
  const offset = Math.atan2(stylusY, stylusX)
  const needle =
    DECK.record * 0.955 +
    (DECK.record * DECK.label * 1.2 - DECK.record * 0.955) *
      clamp01(progress)
  const cosine =
    (reach * reach + d * d - needle * needle) / (2 * reach * d)
  const toward = Math.atan2(
    DECK.cy - DECK.pivotY,
    DECK.cx - DECK.pivotX,
  )
  const played =
    toward - Math.acos(Math.min(1, Math.max(-1, cosine))) - offset
  return (played * 180) / Math.PI
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return reduced
}

/**
 * The renderer derives every rotation from the media's real playback position.
 * Poll the active audio element instead of extrapolating from wall time: this
 * stops the record while buffering, paused, or if the store's timeupdate lags.
 */
function useSmoothPlaybackPosition(position: number, playing: boolean) {
  const reduced = usePrefersReducedMotion()
  const [smooth, setSmooth] = useState(position)
  const positionRef = useRef(position)
  positionRef.current = position

  useEffect(() => {
    if (!playing || reduced) setSmooth(position)
  }, [position, playing, reduced])

  useEffect(() => {
    if (!playing || reduced) return
    let frame = 0
    let last = 0
    const tick = (now: number) => {
      if (now - last >= 1000 / 30) {
        last = now
        const audio = getAudio()
        // `playing` is the UI's intent; the element is the source of truth.
        // While a source is buffering, currentTime stays put and the record
        // waits instead of running ahead like a wall-clock animation.
        setSmooth(
          audio && !audio.paused ? audio.currentTime : positionRef.current,
        )
      }
      frame = window.requestAnimationFrame(tick)
    }
    frame = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(frame)
  }, [playing, reduced])

  return reduced ? position : smooth
}

const SPRING = (() => {
  // The source uses SpringOptions{900ms, Bounce:0.08}: SwiftUI's period and
  // damping ratio converted to mass/stiffness/damping.
  const duration = 0.9
  const omega = (2 * Math.PI) / duration
  const ratio = 1 - 0.08
  return {
    m: 1,
    k: omega * omega,
    c: 2 * ratio * omega,
    eps: 0.001,
  }
})()

function solveSpring(
  x: number,
  velocity: number,
  dt: number,
): [number, number] {
  const w = Math.sqrt(SPRING.k / SPRING.m)
  const a = SPRING.c / SPRING.m / 2
  const d = a * a - w * w
  if (Math.abs(d) < 1e-8 * w * w) {
    const b = velocity + a * x
    const decay = Math.exp(-a * dt)
    return [(x + b * dt) * decay, (velocity - a * b * dt) * decay]
  }
  if (d < 0) {
    const f = Math.sqrt(-d)
    const [sn, cs] = [Math.sin(f * dt), Math.cos(f * dt)]
    const b = (velocity + a * x) / f
    const decay = Math.exp(-a * dt)
    const y = x * cs + b * sn
    return [y * decay, (f * (-x * sn + b * cs) - a * y) * decay]
  }
  const f = Math.sqrt(d)
  const r1 = (-w * w) / (a + f)
  const r2 = -a - f
  const c1 = (velocity - r2 * x) / (r1 - r2)
  const c2 = x - c1
  const u = c1 * Math.exp(r1 * dt)
  const z = c2 * Math.exp(r2 * dt)
  return [u + z, r1 * u + r2 * z]
}

/** The tonearm's `on` value follows the same spring as the renderer. */
function useArmSpring(target: number, reduced: boolean) {
  const [value, setValue] = useState(target)
  const state = useRef({
    value: target,
    target,
    velocity: 0,
    last: performance.now(),
    frame: 0,
  })

  useEffect(() => {
    const spring = state.current
    spring.target = target
    if (reduced) {
      spring.value = target
      spring.velocity = 0
      setValue(target)
      return
    }
    if (
      Math.abs(spring.value - target) <= SPRING.eps &&
      Math.abs(spring.velocity) <=
        SPRING.eps * Math.sqrt(SPRING.k / SPRING.m)
    ) {
      spring.value = target
      spring.velocity = 0
      setValue(target)
      return
    }
    spring.last = performance.now()
    const tick = (now: number) => {
      const dt = Math.max(0, (now - spring.last) / 1000)
      spring.last = now
      const [x, velocity] = solveSpring(
        spring.value - spring.target,
        spring.velocity,
        dt,
      )
      spring.value = spring.target + x
      spring.velocity = velocity
      setValue(spring.value)
      if (
        Math.abs(x) <= SPRING.eps &&
        Math.abs(velocity) <=
          SPRING.eps * Math.sqrt(SPRING.k / SPRING.m)
      ) {
        spring.value = spring.target
        spring.velocity = 0
        setValue(spring.target)
        return
      }
      spring.frame = window.requestAnimationFrame(tick)
    }
    spring.frame = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(spring.frame)
  }, [target, reduced])

  return reduced ? target : value
}

function labelSize() {
  // The source label diameter is 0.36 of the record, which is 0.385 of the
  // deck. Everything here is a percentage of the square artwork.
  return DECK.record * DECK.label * 2
}

function cassetteReel(fraction: number) {
  const radius = Math.sqrt(
    TAPE.hub * TAPE.hub +
      (TAPE.full * TAPE.full - TAPE.hub * TAPE.hub) * clamp01(fraction),
  )
  // The window is 60% of the shell width.
  return {
    size: (radius * 2 * 100) / 0.6,
    hub: (TAPE.hub * 2 * 100) / 0.6,
  }
}

/**
 * The reference cover is a horizontal draggable/flingable tile. Hover only
 * changes the artwork hint; dragging supplies the only transform.
 */
function ArtworkFrame({
  children,
  reducedMotion,
}: {
  children: ReactNode
  reducedMotion: boolean
}) {
  const [offset, setOffset] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [flinging, setFlinging] = useState(false)
  const frameRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startOffset: number
    moved: boolean
  } | null>(null)
  const suppressClickRef = useRef(false)
  const swipeRef = useRef(0)
  const swipeTimerRef = useRef(0)
  const flingTimerRef = useRef(0)

  useEffect(
    () => () => {
      window.clearTimeout(swipeTimerRef.current)
      window.clearTimeout(flingTimerRef.current)
    },
    [],
  )

  const width = () => frameRef.current?.getBoundingClientRect().width ?? 1

  const fling = (direction: number) => {
    if (flinging) return
    setDragging(false)
    setFlinging(true)
    setOffset(-direction * width() * 1.5)
    suppressClickRef.current = true
    window.clearTimeout(flingTimerRef.current)
    flingTimerRef.current = window.setTimeout(() => {
      if (direction > 0) void usePlayerStore.getState().next()
      else void usePlayerStore.getState().prev()
      setOffset(0)
      setFlinging(false)
      suppressClickRef.current = false
    }, 480)
  }

  const resetDrag = () => {
    dragRef.current = null
    setDragging(false)
    setOffset(0)
    setFlinging(false)
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || flinging) return
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startOffset: offset,
      moved: false,
    }
    // Do not capture the pointer before it moves. Capturing on pointerdown
    // retargets the click to the frame, which silently swallows clicks on the
    // album button underneath.
    setDragging(true)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const dx = event.clientX - drag.startX
    if (Math.abs(dx) > 4) drag.moved = true
    if (
      drag.moved &&
      !event.currentTarget.hasPointerCapture(drag.pointerId)
    ) {
      event.currentTarget.setPointerCapture(drag.pointerId)
    }
    setOffset(drag.startOffset + dx)
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) return
    if (event.currentTarget.hasPointerCapture(drag.pointerId)) {
      event.currentTarget.releasePointerCapture(drag.pointerId)
    }
    suppressClickRef.current = drag.moved
    if (Math.abs(offset) > width() * 0.4) {
      fling(offset < 0 ? 1 : -1)
    } else {
      resetDrag()
      window.setTimeout(() => {
        suppressClickRef.current = false
      }, 80)
    }
    dragRef.current = null
  }

  const onWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (flinging || Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return
    event.preventDefault()
    swipeRef.current += event.deltaX
    setOffset(
      Math.min(
        width() * 0.5,
        Math.max(-width() * 0.5, swipeRef.current),
      ),
    )
    window.clearTimeout(swipeTimerRef.current)
    swipeTimerRef.current = window.setTimeout(() => {
      if (swipeRef.current < -width() * 0.3) fling(1)
      else if (swipeRef.current > width() * 0.3) fling(-1)
      else {
        swipeRef.current = 0
        resetDrag()
      }
    }, 140)
  }

  const swing = reducedMotion
    ? 0
    : Math.min(1, Math.max(-1, offset / Math.max(1, width()))) * 16
  const opacity = 1 - 0.85 * Math.min(1, Math.abs(offset) / (width() * 1.5))

  return (
    <div
      ref={frameRef}
      className="retro-art-frame"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
      onClickCapture={(event) => {
        if (suppressClickRef.current) {
          suppressClickRef.current = false
          event.preventDefault()
          event.stopPropagation()
        }
      }}
    >
      <div
        className="retro-art-transform"
        style={{
          transform: `translate3d(${offset}px, 0, 0) rotateZ(${swing}deg)`,
          opacity,
          transition: dragging ? 'none' : undefined,
        }}
      >
        {children}
      </div>
    </div>
  )
}

export function PlayerArtwork({
  song,
  style,
  playing,
  position,
  liked,
  albumAvailable,
  glowRgb,
  onOpenAlbum,
  onToggleLike,
}: {
  song: Song
  style: PlayerStyle
  playing: boolean
  position: number
  liked: boolean
  albumAvailable: boolean
  glowRgb?: string
  onOpenAlbum: () => void
  onToggleLike: () => void
}) {
  const { i18n } = useLingui()
  const reducedMotion = usePrefersReducedMotion()
  const smoothPosition = useSmoothPlaybackPosition(position, playing)
  const armOn = useArmSpring(playing ? 1 : 0, reducedMotion)
  const duration = song.dt > 0 ? song.dt / 1000 : 0
  const progress = duration > 0 ? clamp01(smoothPosition / duration) : 0
  const vinylSpin = reducedMotion
    ? 0
    : ((smoothPosition * 35) % 360 + 360) % 360
  const reelSpin = reducedMotion
    ? 0
    : ((smoothPosition * 150) % 360 + 360) % 360
  const playedAngle = tonearmPlayedAngle(progress)
  const restAngle = (DECK.rest * 180) / Math.PI
  const armAngle = restAngle + (playedAngle - restAngle) * armOn
  const lift = 0.01 + 0.016 * (1 - armOn)
  const labelDiameter = labelSize()
  const labelOffset = (0.5 - labelDiameter / 2) * 100
  const leftReel = cassetteReel(1 - progress)
  const rightReel = cassetteReel(progress)
  const cover = (
    <ImageWithFallback
      src={song.al.picUrl}
      alt={song.name}
      rounded="rounded-full"
      className="h-full w-full"
      resize="640y640"
    />
  )
  const tapeCover = (
    <ImageWithFallback
      src={song.al.picUrl}
      alt={song.name}
      rounded="rounded-[2px]"
      className="h-full w-full"
      resize="320y320"
    />
  )
  const albumLabel = albumAvailable
    ? i18n._(msg`打开专辑 ${song.al.name}`)
    : undefined

  return (
    <div
      className={cn(
        'now-disc group',
        `now-disc--${style}`,
        style === 'vinyl' && playing && 'is-playing',
      )}
      style={
        glowRgb
          ? ({ '--album-glow-rgb': glowRgb } as CSSProperties)
          : undefined
      }
    >
      <ArtworkFrame reducedMotion={reducedMotion}>
      {style === 'vinyl' ? (
        <div className="retro-turntable">
          <img
            className="retro-deck-image"
            src={deckArt}
            alt=""
            draggable={false}
          />
          <img
            className="retro-record"
            src={recordArt}
            alt=""
            draggable={false}
            style={{
              transform: `translate(-50%, -50%) rotate(${vinylSpin}deg)`,
            }}
          />
          <button
            type="button"
            onClick={onOpenAlbum}
            disabled={!albumAvailable}
            aria-label={albumLabel}
            className="retro-label album-cover"
            style={{
              left: `${DECK.cx * 100 - labelDiameter * 50}%`,
              top: `${labelOffset}%`,
              width: `${labelDiameter * 100}%`,
              height: `${labelDiameter * 100}%`,
            }}
          >
            <span
              className="retro-label-rotor"
              style={{ transform: `rotate(${vinylSpin}deg)` }}
              aria-hidden="true"
            >
              <span className="retro-label-tint" />
              {cover}
            </span>
            <span className="retro-label-shade" aria-hidden="true" />
          </button>
          <span className="retro-spindle" aria-hidden="true" />
          <span
            className="retro-lamp-glow"
            style={{ opacity: armOn }}
            aria-hidden="true"
          />
          <span
            className="retro-led"
            style={{ opacity: 0.45 + armOn * 0.55 }}
            aria-hidden="true"
          />
          <span className="retro-start-label" aria-hidden="true">
            START
          </span>
          <span className="retro-speed-label retro-speed-label--33" aria-hidden="true">
            33
          </span>
          <span className="retro-speed-label retro-speed-label--45" aria-hidden="true">
            45
          </span>
          <img
            className="retro-tonearm retro-tonearm-shadow"
            src={armShadowArt}
            alt=""
            draggable={false}
            style={{
              transform: `translate(calc(var(--art-size) * ${lift * 0.7}), calc(var(--art-size) * ${lift})) rotate(${armAngle}deg)`,
            }}
          />
          <img
            className="retro-tonearm"
            src={armArt}
            alt=""
            draggable={false}
            style={{ transform: `rotate(${armAngle}deg)` }}
          />
        </div>
      ) : style === 'cassette' ? (
        <div className="retro-cassette">
          <div className="retro-reel-window">
            <span
              className="retro-reel"
              style={{ width: `${leftReel.size}%` }}
            >
              <span className="retro-tape" />
              <img
                className="retro-hub"
                src={hubArt}
                alt=""
                draggable={false}
                style={{
                  width: `${(leftReel.hub / leftReel.size) * 100}%`,
                  transform: `translate(-50%, -50%) rotate(${reelSpin}deg)`,
                }}
              />
            </span>
            <span
              className="retro-reel"
              style={{ width: `${rightReel.size}%` }}
            >
              <span className="retro-tape" />
              <img
                className="retro-hub"
                src={hubArt}
                alt=""
                draggable={false}
                style={{
                  width: `${(rightReel.hub / rightReel.size) * 100}%`,
                  transform: `translate(-50%, -50%) rotate(${reelSpin}deg)`,
                }}
              />
            </span>
          </div>
          <img
            className="retro-cassette-shell"
            src={cassetteArt}
            alt=""
            draggable={false}
          />
          <span className="retro-label-band" aria-hidden="true" />
          <button
            type="button"
            onClick={onOpenAlbum}
            disabled={!albumAvailable}
            aria-label={albumLabel}
            className="retro-tape-cover album-cover"
          >
            {tapeCover}
          </button>
          <span className="retro-tape-title">{song.name}</span>
          <span className="retro-tape-artist">{formatArtists(song.ar)}</span>
          <span className="retro-tape-side" aria-hidden="true">
            A
          </span>
        </div>
      ) : (
        <button
          type="button"
          onClick={onOpenAlbum}
          disabled={!albumAvailable}
          aria-label={albumLabel}
          className="album-cover group relative block h-full w-full cursor-pointer disabled:cursor-default"
        >
          <ImageWithFallback
            src={song.al.picUrl}
            alt={song.name}
            rounded="rounded-[14px]"
            className="h-full w-full"
            resize="640y640"
          />
          <ArtworkHint />
        </button>
      )}
      </ArtworkFrame>

      <button
        type="button"
        aria-label={liked ? i18n._(msg`取消喜欢`) : i18n._(msg`喜欢`)}
        aria-pressed={liked}
        title={liked ? i18n._(msg`取消喜欢`) : i18n._(msg`喜欢`)}
        onClick={onToggleLike}
        className="pressable absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/35 text-white/80 shadow-[0_4px_14px_rgba(0,0,0,0.28)] backdrop-blur-md transition-colors hover:bg-black/50 hover:text-white max-md:hidden"
      >
        <Heart
          className={cn('h-4 w-4', liked && 'fill-[#ff2d55] text-[#ff2d55]')}
        />
      </button>
    </div>
  )
}

function ArtworkHint() {
  return (
    <span className="artwork-hint pointer-events-none absolute inset-0 z-[1] flex items-end justify-center rounded-[inherit] bg-black/25 p-3 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">
      <span className="flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1 text-[11px] font-medium text-black/80 shadow-sm">
        <Disc3 className="h-3.5 w-3.5" />
        <Trans>查看专辑</Trans>
      </span>
    </span>
  )
}
