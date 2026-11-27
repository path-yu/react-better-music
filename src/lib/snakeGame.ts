/**
 * Pure rules of 吃吃乐 (Spotify's "Eat This Playlist"): a grid snake that
 * eats album covers. No DOM, no timers: the component owns the clock and
 * calls `stepGame` once per tick, so this file is fully unit-testable.
 */

export type Direction = 'up' | 'down' | 'left' | 'right'

export interface Cell {
  x: number
  y: number
}

export interface SnakeGame {
  cols: number
  rows: number
  /** Head first. Segment k ≥ 1 wears the k-th most recently eaten cover. */
  snake: Cell[]
  direction: Direction
  /** Turns typed between ticks, applied one per tick. */
  queued: Direction[]
  food: Cell | null
  /** Tracks eaten this round (also the score). */
  eaten: number
  lives: number
  status: 'ready' | 'playing' | 'crashed' | 'over' | 'won'
}

export type StepEvent =
  | { type: 'move' }
  | { type: 'eat'; at: Cell }
  | { type: 'crash'; at: Cell; reason: 'wall' | 'self' }
  | { type: 'won' }

export const START_LIVES = 3
/** Covers kept behind the head after a crash (the snake gets shorter). */
const RESPAWN_BODY = 3
const MAX_QUEUED_TURNS = 2

const VECTORS: Record<Direction, Cell> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
}

const OPPOSITE: Record<Direction, Direction> = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
}

export type RandomSource = () => number

function sameCell(a: Cell, b: Cell) {
  return a.x === b.x && a.y === b.y
}

/** Lay a snake of `length` cells out horizontally, head in the middle. */
function spawnSnake(cols: number, rows: number, length: number): Cell[] {
  const y = Math.floor(rows / 2)
  const head = Math.floor(cols / 2)
  const body = Math.max(0, Math.min(length - 1, head))
  return Array.from({ length: body + 1 }, (_, index) => ({ x: head - index, y }))
}

/**
 * Pick a free cell for the next cover, a few steps away from the head when
 * the board allows, so a new track never lands right in the snake's mouth.
 */
export function placeFood(game: SnakeGame, random: RandomSource = Math.random): Cell | null {
  const taken = new Set(game.snake.map((cell) => cell.y * game.cols + cell.x))
  const head = game.snake[0]
  const free: Cell[] = []
  const comfortable: Cell[] = []
  for (let y = 0; y < game.rows; y += 1) {
    for (let x = 0; x < game.cols; x += 1) {
      if (taken.has(y * game.cols + x)) continue
      const cell = { x, y }
      free.push(cell)
      if (!head || Math.abs(head.x - x) + Math.abs(head.y - y) >= 3) comfortable.push(cell)
    }
  }
  const pool = comfortable.length ? comfortable : free
  if (!pool.length) return null
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))]
}

export function createGame(
  cols: number,
  rows: number,
  random: RandomSource = Math.random,
): SnakeGame {
  const game: SnakeGame = {
    cols,
    rows,
    snake: spawnSnake(cols, rows, 1),
    direction: 'right',
    queued: [],
    food: null,
    eaten: 0,
    lives: START_LIVES,
    status: 'ready',
  }
  game.food = placeFood(game, random)
  return game
}

/**
 * Queue a turn. A turn back onto the body is ignored (a bare head may turn
 * around freely, like Spotify's single-triangle start).
 */
export function turn(game: SnakeGame, direction: Direction) {
  if (game.status !== 'playing' && game.status !== 'ready') return
  const last = game.queued[game.queued.length - 1] ?? game.direction
  if (direction === last) return
  if (game.snake.length > 1 && direction === OPPOSITE[last]) return
  if (game.queued.length >= MAX_QUEUED_TURNS) return
  game.queued.push(direction)
}

/** Advance one cell. Mutates `game` and reports what happened. */
export function stepGame(game: SnakeGame, random: RandomSource = Math.random): StepEvent {
  if (game.status === 'ready') game.status = 'playing'
  if (game.status !== 'playing') return { type: 'move' }
  const next = game.queued.shift()
  if (next) game.direction = next
  const vector = VECTORS[game.direction]
  const head = game.snake[0]
  const target = { x: head.x + vector.x, y: head.y + vector.y }

  if (target.x < 0 || target.y < 0 || target.x >= game.cols || target.y >= game.rows) {
    return crash(game, head, 'wall')
  }
  const eating = Boolean(game.food && sameCell(game.food, target))
  // The tail moves out of its cell this tick unless the snake grows.
  const body = eating ? game.snake : game.snake.slice(0, -1)
  if (body.some((cell) => sameCell(cell, target))) return crash(game, target, 'self')

  game.snake = [target, ...body]
  if (!eating) return { type: 'move' }

  game.eaten += 1
  game.food = placeFood(game, random)
  if (!game.food) {
    game.status = 'won'
    return { type: 'won' }
  }
  return { type: 'eat', at: target }
}

function crash(game: SnakeGame, at: Cell, reason: 'wall' | 'self'): StepEvent {
  game.lives -= 1
  game.queued = []
  game.status = game.lives > 0 ? 'crashed' : 'over'
  return { type: 'crash', at, reason }
}

/** After a crash with lives left: a shorter snake back in the middle. */
export function respawn(game: SnakeGame, random: RandomSource = Math.random) {
  if (game.status !== 'crashed') return
  const length = Math.min(game.snake.length, RESPAWN_BODY + 1)
  game.snake = spawnSnake(game.cols, game.rows, length)
  game.direction = 'right'
  game.queued = []
  if (!game.food || game.snake.some((cell) => sameCell(cell, game.food!))) {
    game.food = placeFood(game, random)
  }
  game.status = 'ready'
}

/** Milliseconds per cell: speeds up as the queue gets eaten. */
export function tickInterval(eaten: number) {
  return Math.max(88, 175 - eaten * 4)
}

/** Board size that fits `width × height` px with cells near `target` px. */
export function fitBoard(width: number, height: number, target: number) {
  const cols = Math.max(8, Math.min(26, Math.floor(width / target)))
  const rows = Math.max(8, Math.min(18, Math.floor(height / target)))
  return { cols, rows }
}

/** Map a swipe to a direction; null when it is too short to mean anything. */
export function swipeDirection(dx: number, dy: number, threshold = 24): Direction | null {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < threshold) return null
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left'
  return dy > 0 ? 'down' : 'up'
}

const KEY_DIRECTIONS: Record<string, Direction> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  KeyW: 'up',
  KeyS: 'down',
  KeyA: 'left',
  KeyD: 'right',
}

export function keyDirection(code: string): Direction | null {
  return KEY_DIRECTIONS[code] ?? null
}
