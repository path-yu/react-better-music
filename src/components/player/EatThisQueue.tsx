import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { Trans } from '@lingui/react/macro'
import { Check, Gamepad2, Pause, Play, Plus, RotateCcw, Trophy, X } from 'lucide-react'
import { fetchSongChorusStart } from '../../api'
import { extractPalette, hexToRgb } from '../../lib/color'
import { cn } from '../../lib/format'
import { resizedImageUrl } from '../../lib/image'
import {
  createGame,
  fitBoard,
  keyDirection,
  respawn,
  stepGame,
  swipeDirection,
  tickInterval,
  turn,
  type Cell,
  type Direction,
  type SnakeGame,
} from '../../lib/snakeGame'
import { usePlayerStore } from '../../store/player'
import { useUserStore } from '../../store/user'
import { useLocalLibraryStore } from '../../store/localLibrary'
import type { Song } from '../../types'

/*
 * 吃吃乐: Spotify's "Eat This Playlist" for the play queue. A snake eats
 * album covers; the cover it is heading for is the track that plays (from
 * its chorus), and every eaten cover becomes part of its tail.
 */

const BEST_KEY = 'react-music:eat-queue-best'
/** Queues shorter than this are not much of a meal. */
export const EAT_QUEUE_MIN_SONGS = 3
const CRASH_RESPAWN_MS = 900
const BURST_MS = 520
const SHAKE_MS = 360
const LIKE_NOTICE_MS = 1800

type Phase = 'intro' | 'playing' | 'paused' | 'crashed' | 'over' | 'won'

interface Burst {
  x: number
  y: number
  start: number
}

interface CoverImage {
  image: HTMLImageElement
  ready: boolean
}

function readBest() {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0
  } catch {
    return 0
  }
}

function writeBest(value: number) {
  try {
    localStorage.setItem(BEST_KEY, String(value))
  } catch {
    // Private mode: the record simply is not kept.
  }
}

function coverUrl(song: Song | undefined) {
  return resizedImageUrl(song?.al?.picUrl, '120y120') ?? ''
}

/** Darken a palette colour so white covers and text stay readable on it. */
function backdropColor(hex: string | undefined) {
  if (!hex || !/^#?[0-9a-f]{3,8}$/i.test(hex)) return 'rgb(24, 24, 30)'
  const { r, g, b } = hexToRgb(hex)
  const mix = (value: number) => Math.round(value * 0.5 + 10)
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const r = Math.min(radius, width / 2, height / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + width, y, x + width, y + height, r)
  ctx.arcTo(x + width, y + height, x, y + height, r)
  ctx.arcTo(x, y + height, x, y, r)
  ctx.arcTo(x, y, x + width, y, r)
  ctx.closePath()
}

const HEAD_ANGLE: Record<Direction, number> = {
  right: 0,
  down: Math.PI / 2,
  left: Math.PI,
  up: -Math.PI / 2,
}

export function EatThisQueue({ onClose }: { onClose: () => void }) {
  const { i18n } = useLingui()
  const boardRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const gameRef = useRef<SnakeGame | null>(null)
  const prevSnakeRef = useRef<Cell[]>([])
  const lastTickRef = useRef(0)
  const phaseRef = useRef<Phase>('intro')
  const eatenRef = useRef<Song[]>([])
  // The first cover is the track that is already playing.
  const [initialIndex] = useState(() => usePlayerStore.getState().currentIndex)
  const foodIndexRef = useRef(initialIndex)
  /** Queue index we asked the player for; anything else is an outside change. */
  const expectedIndexRef = useRef(initialIndex)
  const playRequestRef = useRef(0)
  const burstsRef = useRef<Burst[]>([])
  const crashAtRef = useRef(0)
  const coversRef = useRef(new Map<string, CoverImage>())
  const reducedMotion = useMemo(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  )

  const [phase, setPhaseState] = useState<Phase>('intro')
  const [score, setScore] = useState(0)
  const [lives, setLives] = useState(3)
  const [best, setBest] = useState(readBest)
  const [newRecord, setNewRecord] = useState(false)
  const [foodSong, setFoodSong] = useState<Song | undefined>(
    () => usePlayerStore.getState().queue[initialIndex],
  )
  const [tint, setTint] = useState('rgb(24, 24, 30)')
  const [likeNotice, setLikeNotice] = useState<'added' | 'removed' | null>(null)
  const [summary, setSummary] = useState<Song[]>([])
  // The canvas reads the food song from a ref so drawing never re-binds.
  const foodSongRef = useRef(foodSong)
  useEffect(() => {
    foodSongRef.current = foodSong
  }, [foodSong])

  const isLogin = useUserStore((state) => state.isLogin)
  const likedIds = useUserStore((state) => state.likedIds)
  const likeSong = useUserStore((state) => state.likeSong)
  const localFavorites = useLocalLibraryStore((state) => state.favorites)
  const toggleLocalFavorite = useLocalLibraryStore((state) => state.toggleFavorite)
  const foodLiked = foodSong
    ? isLogin
      ? likedIds.includes(foodSong.id)
      : localFavorites.some((song) => song.id === foodSong.id)
    : false

  const setPhase = useCallback((next: Phase) => {
    phaseRef.current = next
    setPhaseState(next)
  }, [])

  /* ------------------------------- covers ------------------------------- */

  const cover = useCallback((song: Song | undefined) => {
    const url = coverUrl(song)
    if (!url) return null
    let entry = coversRef.current.get(url)
    if (!entry) {
      const image = new Image()
      image.decoding = 'async'
      const created: CoverImage = { image, ready: false }
      image.onload = () => {
        created.ready = true
      }
      image.src = url
      coversRef.current.set(url, created)
      entry = created
    }
    return entry
  }, [])

  // Backdrop follows the cover being chased, like Spotify's game.
  useEffect(() => {
    const url = coverUrl(foodSong)
    if (!url) return
    let active = true
    void extractPalette(url)
      .then((palette) => {
        if (active) setTint(backdropColor(palette.colors[0]))
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [foodSong])

  /* -------------------------------- music ------------------------------- */

  const showFood = useCallback(
    (index: number) => {
      const queue = usePlayerStore.getState().queue
      foodIndexRef.current = index
      setFoodSong(queue[index])
      // Warm the next few covers so they never pop in.
      for (let step = 1; step <= 3; step += 1) {
        cover(queue[(index + step) % Math.max(1, queue.length)])
      }
    },
    [cover],
  )

  /** Play the cover the snake is chasing, from its chorus when known. */
  const playFood = useCallback(
    async (index: number, attempts = 0): Promise<void> => {
      const store = usePlayerStore.getState()
      const song = store.queue[index]
      if (!song) return
      const request = ++playRequestRef.current
      expectedIndexRef.current = index
      showFood(index)
      if (store.currentIndex === index && store.audioUrl) {
        if (!store.playing) void store.togglePlay()
        return
      }
      const chorus = fetchSongChorusStart(song.id)
      const ok = await store.playAt(index)
      if (request !== playRequestRef.current) return
      if (!ok) {
        // Unplayable (no copyright, VIP only): serve the next cover instead.
        const length = usePlayerStore.getState().queue.length
        if (attempts + 1 < length) {
          await playFood((index + 1) % length, attempts + 1)
        }
        return
      }
      const chorusMs = await chorus
      if (request !== playRequestRef.current) return
      const state = usePlayerStore.getState()
      if (state.currentIndex !== index) return
      const current = state.queue[index]
      // Trial clips are short files; there is no chorus to jump to.
      if (!current || (current.trialEnd ?? 0) > 0) return
      const durationMs = state.mediaDuration || current.dt || 0
      // No chorus marker: a long track starts a third of the way in, which
      // is usually past the intro; short ones play from the top.
      const startMs = chorusMs ?? (durationMs > 90_000 ? durationMs * 0.3 : 0)
      if (startMs > 1000 && (!durationMs || startMs < durationMs - 15_000)) {
        state.seekTo(startMs / 1000)
      }
    },
    [showFood],
  )

  // A track that ends on its own (or any outside skip) moves the player on;
  // the cover on the board follows so music and food never disagree.
  useEffect(
    () =>
      usePlayerStore.subscribe((state, previous) => {
        if (state.currentIndex === previous.currentIndex) return
        if (state.currentIndex === expectedIndexRef.current) return
        expectedIndexRef.current = state.currentIndex
        playRequestRef.current += 1
        showFood(state.currentIndex)
      }),
    [showFood],
  )

  /* -------------------------------- game -------------------------------- */

  const newGame = useCallback(() => {
    const board = boardRef.current
    if (!board) return
    const mobile = board.clientWidth < 560
    const { cols, rows } = fitBoard(board.clientWidth, board.clientHeight, mobile ? 34 : 44)
    const game = createGame(cols, rows)
    gameRef.current = game
    prevSnakeRef.current = game.snake.map((cell) => ({ ...cell }))
    eatenRef.current = []
    burstsRef.current = []
    setScore(0)
    setLives(game.lives)
    setNewRecord(false)
    setSummary([])
  }, [])

  useEffect(() => {
    newGame()
    showFood(foodIndexRef.current)
  }, [newGame, showFood])

  const start = useCallback(() => {
    const game = gameRef.current
    if (!game) return
    if (phaseRef.current === 'over' || phaseRef.current === 'won') {
      // A new round continues with the cover that was being chased.
      newGame()
    }
    lastTickRef.current = performance.now()
    setPhase('playing')
    const store = usePlayerStore.getState()
    if (!store.playing) void store.togglePlay()
  }, [newGame, setPhase])

  const finish = useCallback(
    (won: boolean) => {
      const game = gameRef.current
      const total = game?.eaten ?? 0
      setSummary([...eatenRef.current].reverse())
      if (total > best) {
        writeBest(total)
        setBest(total)
        setNewRecord(true)
      }
      setPhase(won ? 'won' : 'over')
    },
    [best, setPhase],
  )

  const handleStep = useCallback(
    (now: number) => {
      const game = gameRef.current
      if (!game) return
      prevSnakeRef.current = game.snake.map((cell) => ({ ...cell }))
      const event = stepGame(game)
      if (event.type === 'eat' || event.type === 'won') {
        const queue = usePlayerStore.getState().queue
        const eatenSong = queue[foodIndexRef.current]
        if (eatenSong) eatenRef.current.push(eatenSong)
        setScore(game.eaten)
        if (event.type === 'eat') {
          burstsRef.current.push({ x: event.at.x, y: event.at.y, start: now })
          const next = (foodIndexRef.current + 1) % Math.max(1, queue.length)
          void playFood(next)
        } else {
          finish(true)
        }
        return
      }
      if (event.type === 'crash') {
        crashAtRef.current = now
        setLives(game.lives)
        prevSnakeRef.current = game.snake.map((cell) => ({ ...cell }))
        if (game.status === 'over') {
          finish(false)
          return
        }
        setPhase('crashed')
        window.setTimeout(() => {
          if (gameRef.current !== game || phaseRef.current !== 'crashed') return
          respawn(game)
          prevSnakeRef.current = game.snake.map((cell) => ({ ...cell }))
          // Wait for the next direction key before moving again.
          setPhase('intro')
        }, CRASH_RESPAWN_MS)
      }
    },
    [finish, playFood, setPhase],
  )

  const steer = useCallback(
    (direction: Direction) => {
      const game = gameRef.current
      if (!game) return
      const current = phaseRef.current
      if (current === 'over' || current === 'won' || current === 'crashed') return
      turn(game, direction)
      if (current !== 'playing') start()
    },
    [start],
  )

  const togglePause = useCallback(() => {
    const current = phaseRef.current
    if (current === 'playing') setPhase('paused')
    else if (current === 'paused' || current === 'intro') start()
  }, [setPhase, start])

  /* ------------------------------- drawing ------------------------------ */

  const draw = useCallback(
    (now: number) => {
      const canvas = canvasRef.current
      const board = boardRef.current
      const game = gameRef.current
      if (!canvas || !board || !game) return
      const dpr = window.devicePixelRatio || 1
      const width = board.clientWidth
      const height = board.clientHeight
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr)
        canvas.height = Math.round(height * dpr)
      }
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, width, height)

      const cell = Math.floor(Math.min(width / game.cols, height / game.rows))
      const boardWidth = cell * game.cols
      const boardHeight = cell * game.rows
      let originX = Math.round((width - boardWidth) / 2)
      let originY = Math.round((height - boardHeight) / 2)
      const shake = now - crashAtRef.current
      if (!reducedMotion && shake < SHAKE_MS) {
        const strength = (1 - shake / SHAKE_MS) * 7
        originX += Math.sin(shake / 18) * strength
        originY += Math.cos(shake / 23) * strength * 0.5
      }

      // Board and its dot grid.
      roundedRect(ctx, originX, originY, boardWidth, boardHeight, Math.min(22, cell * 0.5))
      ctx.fillStyle = 'rgba(0, 0, 0, 0.22)'
      ctx.fill()
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)'
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.fillStyle = 'rgba(255, 255, 255, 0.07)'
      for (let y = 0; y < game.rows; y += 1) {
        for (let x = 0; x < game.cols; x += 1) {
          ctx.beginPath()
          ctx.arc(originX + (x + 0.5) * cell, originY + (y + 0.5) * cell, Math.max(1, cell * 0.035), 0, Math.PI * 2)
          ctx.fill()
        }
      }

      const center = (point: Cell) => ({
        x: originX + (point.x + 0.5) * cell,
        y: originY + (point.y + 0.5) * cell,
      })

      const drawCover = (song: Song | undefined, cx: number, cy: number, size: number, alpha = 1) => {
        const entry = cover(song)
        const x = cx - size / 2
        const y = cy - size / 2
        ctx.save()
        ctx.globalAlpha = alpha
        ctx.shadowColor = 'rgba(0, 0, 0, 0.35)'
        ctx.shadowBlur = size * 0.18
        ctx.shadowOffsetY = size * 0.05
        roundedRect(ctx, x, y, size, size, size * 0.2)
        ctx.fillStyle = 'rgba(255, 255, 255, 0.22)'
        ctx.fill()
        ctx.shadowColor = 'transparent'
        if (entry?.ready) {
          ctx.clip()
          ctx.drawImage(entry.image, x, y, size, size)
        }
        ctx.restore()
      }

      // The cover being chased: gently pulsing, with a soft ring.
      if (game.food) {
        const point = center(game.food)
        const wave = reducedMotion ? 0 : (now % 1400) / 1400
        if (!reducedMotion) {
          ctx.beginPath()
          ctx.arc(point.x, point.y, cell * (0.5 + wave * 0.45), 0, Math.PI * 2)
          ctx.strokeStyle = `rgba(255, 255, 255, ${(0.4 * (1 - wave)).toFixed(3)})`
          ctx.lineWidth = Math.max(1.5, cell * 0.05)
          ctx.stroke()
        }
        const pulse = reducedMotion ? 1 : 1 + 0.05 * Math.sin(now / 240)
        drawCover(foodSongRef.current, point.x, point.y, cell * 0.86 * pulse)
      }

      // Bursts where a cover was eaten.
      burstsRef.current = burstsRef.current.filter((burst) => now - burst.start < BURST_MS)
      for (const burst of burstsRef.current) {
        const progress = (now - burst.start) / BURST_MS
        const point = center(burst)
        ctx.beginPath()
        ctx.arc(point.x, point.y, cell * (0.45 + progress * 0.9), 0, Math.PI * 2)
        ctx.strokeStyle = `rgba(255, 255, 255, ${(0.7 * (1 - progress)).toFixed(3)})`
        ctx.lineWidth = Math.max(2, cell * 0.08 * (1 - progress))
        ctx.stroke()
      }

      // Snake: tail first so the head is drawn on top. Segments glide from
      // their previous cell to the current one during the tick.
      const moving = phaseRef.current === 'playing'
      const interval = tickInterval(game.eaten)
      const t = moving ? Math.min(1, (now - lastTickRef.current) / interval) : 1
      const previous = prevSnakeRef.current
      const eaten = eatenRef.current
      for (let index = game.snake.length - 1; index >= 0; index -= 1) {
        const to = game.snake[index]
        const from = previous[index] ?? to
        const point = center({
          x: from.x + (to.x - from.x) * t,
          y: from.y + (to.y - from.y) * t,
        })
        if (index > 0) {
          drawCover(eaten[eaten.length - index], point.x, point.y, cell * 0.8)
          continue
        }
        // Head: a rounded white triangle pointing where it goes.
        const crashed = phaseRef.current === 'crashed'
        ctx.save()
        ctx.translate(point.x, point.y)
        ctx.rotate(HEAD_ANGLE[game.direction])
        const size = cell * 0.42
        ctx.beginPath()
        ctx.moveTo(size, 0)
        ctx.lineTo(-size * 0.75, -size * 0.85)
        ctx.lineTo(-size * 0.75, size * 0.85)
        ctx.closePath()
        ctx.lineJoin = 'round'
        ctx.lineWidth = cell * 0.14
        ctx.strokeStyle = crashed ? 'rgba(255, 255, 255, 0.45)' : '#fff'
        ctx.fillStyle = crashed ? 'rgba(255, 255, 255, 0.45)' : '#fff'
        ctx.shadowColor = 'rgba(0, 0, 0, 0.3)'
        ctx.shadowBlur = cell * 0.2
        ctx.stroke()
        ctx.fill()
        ctx.restore()
      }
    },
    [cover, reducedMotion],
  )

  useEffect(() => {
    let frame = 0
    const loop = (now: number) => {
      frame = requestAnimationFrame(loop)
      const game = gameRef.current
      if (game && phaseRef.current === 'playing') {
        const interval = tickInterval(game.eaten)
        if (now - lastTickRef.current >= interval) {
          // Catch up at most one tick: a long frame must not teleport the snake.
          lastTickRef.current = Math.max(lastTickRef.current + interval, now - interval)
          handleStep(now)
        }
      }
      draw(now)
    }
    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [draw, handleStep])

  /* -------------------------------- input ------------------------------- */

  useEffect(() => {
    // Capture phase on window: runs before the player's own shortcuts
    // (arrows seek, Space toggles playback, Esc closes the song page).
    const onKey = (event: KeyboardEvent) => {
      const direction = keyDirection(event.code)
      const handled =
        direction !== null ||
        event.code === 'Space' ||
        event.code === 'Escape' ||
        event.code === 'Enter'
      if (!handled) return
      // Buttons inside the overlay keep Enter / Space for themselves.
      const target = event.target as HTMLElement | null
      if ((event.code === 'Enter' || event.code === 'Space') && target?.closest('button')) {
        event.stopPropagation()
        return
      }
      event.preventDefault()
      event.stopPropagation()
      if (event.code === 'Escape') {
        onClose()
        return
      }
      if (direction) {
        steer(direction)
        return
      }
      if (event.repeat) return
      if (event.code === 'Space') togglePause()
      else if (phaseRef.current === 'over' || phaseRef.current === 'won' || phaseRef.current === 'intro') start()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose, start, steer, togglePause])

  // Leaving the window pauses the snake (the music keeps playing).
  useEffect(() => {
    const pause = () => {
      if (phaseRef.current === 'playing') setPhase('paused')
    }
    const onVisibility = () => {
      if (document.hidden) pause()
    }
    window.addEventListener('blur', pause)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('blur', pause)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [setPhase])

  const swipeRef = useRef<{ id: number; x: number; y: number } | null>(null)

  /* ------------------------------- actions ------------------------------ */

  const toggleLike = () => {
    const song = foodSong
    if (!song) return
    const next = !foodLiked
    if (isLogin) void likeSong(song.id, next)
    else void toggleLocalFavorite(song)
    setLikeNotice(next ? 'added' : 'removed')
  }

  useEffect(() => {
    if (!likeNotice) return
    const timer = window.setTimeout(() => setLikeNotice(null), LIKE_NOTICE_MS)
    return () => window.clearTimeout(timer)
  }, [likeNotice])

  const artists = foodSong?.ar?.map((artist) => artist.name).join(' / ') ?? ''
  const fresh = phase === 'intro' && score === 0 && lives === 3

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={i18n._(msg`吃吃乐`)}
      className="eatq"
      style={{ backgroundColor: tint }}
    >
      <div className="eatq__glow" aria-hidden="true" />

      <header className="eatq__header">
        <button
          type="button"
          onClick={toggleLike}
          disabled={!foodSong}
          aria-pressed={foodLiked}
          aria-label={foodLiked ? i18n._(msg`取消喜欢`) : i18n._(msg`添加到我喜欢的音乐`)}
          className={cn('eatq__icon-button', foodLiked && 'is-on')}
        >
          {foodLiked ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
        </button>

        <div className="eatq__score" aria-live="polite">
          <span className="eatq__score-value tabular-nums">{score}</span>
          <span className="eatq__score-label">
            <Trans>首</Trans>
          </span>
          <span className="eatq__lives" aria-label={i18n._(msg`剩余 ${lives} 条命`)}>
            {[0, 1, 2].map((index) => (
              <span key={index} className={cn('eatq__life', index < lives && 'is-on')} />
            ))}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {phase === 'playing' || phase === 'paused' ? (
            <button
              type="button"
              onClick={togglePause}
              aria-label={phase === 'paused' ? i18n._(msg`继续`) : i18n._(msg`暂停`)}
              className="eatq__icon-button"
            >
              {phase === 'paused' ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            aria-label={i18n._(msg`退出吃吃乐`)}
            className="eatq__icon-button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="eatq__now">
        {foodSong ? (
          <>
            <img src={coverUrl(foodSong)} alt="" className="eatq__now-cover" />
            <div className="min-w-0">
              <p className="eatq__now-title">{foodSong.name}</p>
              <p className="eatq__now-artist">{artists}</p>
            </div>
          </>
        ) : null}
        <span className={cn('eatq__notice', likeNotice && 'is-visible')} aria-live="polite">
          {likeNotice === 'removed' ? (
            <Trans>已从我喜欢的音乐中移除</Trans>
          ) : (
            <Trans>已添加到我喜欢的音乐</Trans>
          )}
        </span>
      </div>

      <div
        ref={boardRef}
        className="eatq__board"
        onPointerDown={(event) => {
          swipeRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
        }}
        onPointerUp={(event) => {
          const swipe = swipeRef.current
          swipeRef.current = null
          if (!swipe || swipe.id !== event.pointerId) return
          // Card buttons handle their own clicks.
          if ((event.target as HTMLElement).closest('button')) return
          const direction = swipeDirection(event.clientX - swipe.x, event.clientY - swipe.y)
          if (direction) steer(direction)
          else if (phaseRef.current !== 'playing') togglePause()
        }}
        onPointerCancel={() => {
          swipeRef.current = null
        }}
      >
        <canvas ref={canvasRef} className="eatq__canvas" aria-hidden="true" />

        {fresh ? (
          <div className="eatq__card">
            <span className="eatq__badge">
              <Gamepad2 className="h-4 w-4" />
            </span>
            <h2 className="eatq__title">
              <Trans>吃掉这个队列</Trans>
            </h2>
            <p className="eatq__text">
              <Trans>
                控制小蛇去吃封面：正在追的那张就是正在播放的歌（从副歌开始），吃掉后它会接到尾巴上。撞墙或撞到自己会失去一条命，一共 3 条。
              </Trans>
            </p>
            <button type="button" onClick={start} className="eatq__primary">
              <Play className="h-4 w-4" />
              <Trans>开始</Trans>
            </button>
            <p className="eatq__hint">
              <span className="max-md:hidden">
                <Trans>方向键 / WASD 控制 · 空格暂停 · Esc 退出</Trans>
              </span>
              <span className="md:hidden">
                <Trans>在棋盘上滑动控制方向</Trans>
              </span>
            </p>
            {best > 0 ? (
              <p className="eatq__best">
                <Trophy className="h-3.5 w-3.5" />
                <Trans>最高纪录 {best} 首</Trans>
              </p>
            ) : null}
          </div>
        ) : phase === 'intro' ? (
          <div className="eatq__toast">
            <Trans>还剩 {lives} 条命 · 按方向键继续</Trans>
          </div>
        ) : phase === 'paused' ? (
          <div className="eatq__card eatq__card--compact">
            <h2 className="eatq__title">
              <Trans>已暂停</Trans>
            </h2>
            <button type="button" onClick={start} className="eatq__primary">
              <Play className="h-4 w-4" />
              <Trans>继续</Trans>
            </button>
          </div>
        ) : phase === 'over' || phase === 'won' ? (
          <div className="eatq__card">
            <h2 className="eatq__title">
              {phase === 'won' ? (
                <Trans>整个棋盘都吃满了！</Trans>
              ) : (
                <Trans>这局吃掉了 {score} 首</Trans>
              )}
            </h2>
            <p className="eatq__best">
              <Trophy className="h-3.5 w-3.5" />
              {newRecord ? <Trans>新纪录！</Trans> : <Trans>最高纪录 {best} 首</Trans>}
            </p>
            {summary.length ? (
              <div className="eatq__summary" aria-label={i18n._(msg`本局吃掉的歌`)}>
                {summary.slice(0, 14).map((song, index) => (
                  <img
                    key={`${song.id}-${index}`}
                    src={coverUrl(song)}
                    alt={song.name}
                    title={song.name}
                    className="eatq__summary-cover"
                  />
                ))}
              </div>
            ) : null}
            <div className="flex items-center gap-2">
              <button type="button" onClick={start} className="eatq__primary">
                <RotateCcw className="h-4 w-4" />
                <Trans>再来一局</Trans>
              </button>
              <button type="button" onClick={onClose} className="eatq__secondary">
                <Trans>退出</Trans>
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}
