import { describe, expect, it } from 'vitest'
import {
  START_LIVES,
  createGame,
  fitBoard,
  keyDirection,
  placeFood,
  respawn,
  stepGame,
  swipeDirection,
  tickInterval,
  turn,
  type SnakeGame,
} from './snakeGame'

const first = () => 0

function gameWith(partial: Partial<SnakeGame>): SnakeGame {
  return { ...createGame(10, 10, first), status: 'playing', ...partial }
}

describe('createGame', () => {
  it('starts with a bare head in the middle and a cover away from it', () => {
    const game = createGame(10, 8, first)
    expect(game.snake).toEqual([{ x: 5, y: 4 }])
    expect(game.lives).toBe(START_LIVES)
    expect(game.status).toBe('ready')
    const head = game.snake[0]
    expect(Math.abs(head.x - game.food!.x) + Math.abs(head.y - game.food!.y)).toBeGreaterThanOrEqual(3)
  })
})

describe('stepGame', () => {
  it('moves the head and drops the tail', () => {
    const game = gameWith({
      snake: [{ x: 3, y: 3 }, { x: 2, y: 3 }],
      food: { x: 9, y: 9 },
    })
    expect(stepGame(game, first)).toEqual({ type: 'move' })
    expect(game.snake).toEqual([{ x: 4, y: 3 }, { x: 3, y: 3 }])
  })

  it('grows and scores when it eats a cover', () => {
    const game = gameWith({ snake: [{ x: 3, y: 3 }], food: { x: 4, y: 3 } })
    expect(stepGame(game, first)).toEqual({ type: 'eat', at: { x: 4, y: 3 } })
    expect(game.snake).toHaveLength(2)
    expect(game.eaten).toBe(1)
    expect(game.food).not.toEqual({ x: 4, y: 3 })
  })

  it('loses a life on the wall and ends after the last one', () => {
    const game = gameWith({ snake: [{ x: 9, y: 0 }], food: { x: 0, y: 9 }, lives: 2 })
    expect(stepGame(game, first)).toMatchObject({ type: 'crash', reason: 'wall' })
    expect(game.status).toBe('crashed')
    respawn(game, first)
    expect(game.status).toBe('ready')
    game.snake = [{ x: 9, y: 0 }]
    stepGame(game, first)
    expect(game.lives).toBe(0)
    expect(game.status).toBe('over')
  })

  it('crashes into its own body but may follow its tail', () => {
    // Head at (2,2) moving down into (2,3), which the tail is leaving.
    const loop = gameWith({
      snake: [{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 3, y: 3 }, { x: 2, y: 3 }],
      direction: 'down',
      food: { x: 9, y: 9 },
    })
    expect(stepGame(loop, first).type).toBe('move')

    const tight = gameWith({
      snake: [
        { x: 2, y: 2 },
        { x: 3, y: 2 },
        { x: 3, y: 3 },
        { x: 2, y: 3 },
        { x: 1, y: 3 },
      ],
      direction: 'down',
      food: { x: 9, y: 9 },
    })
    expect(stepGame(tight, first)).toMatchObject({ type: 'crash', reason: 'self' })
  })

  it('wins when no free cell is left for a cover', () => {
    const game = gameWith({ cols: 2, rows: 1, snake: [{ x: 0, y: 0 }], food: { x: 1, y: 0 } })
    expect(stepGame(game, first)).toEqual({ type: 'won' })
    expect(game.status).toBe('won')
  })
})

describe('turn', () => {
  it('applies one queued turn per tick', () => {
    const game = gameWith({ snake: [{ x: 5, y: 5 }, { x: 4, y: 5 }], food: { x: 0, y: 0 } })
    turn(game, 'up')
    turn(game, 'left')
    stepGame(game, first)
    expect(game.snake[0]).toEqual({ x: 5, y: 4 })
    stepGame(game, first)
    expect(game.snake[0]).toEqual({ x: 4, y: 4 })
  })

  it('ignores reversing onto the body, but a bare head may turn around', () => {
    const long = gameWith({ snake: [{ x: 5, y: 5 }, { x: 4, y: 5 }] })
    turn(long, 'left')
    expect(long.queued).toEqual([])
    const bare = gameWith({ snake: [{ x: 5, y: 5 }] })
    turn(bare, 'left')
    expect(bare.queued).toEqual(['left'])
  })
})

describe('respawn', () => {
  it('keeps the score and at most three covers', () => {
    const game = gameWith({
      snake: Array.from({ length: 8 }, (_, x) => ({ x: 7 - x, y: 0 })),
      eaten: 7,
      lives: 2,
      status: 'crashed',
    })
    respawn(game, first)
    expect(game.snake).toHaveLength(4)
    expect(game.eaten).toBe(7)
    expect(game.food && game.snake.some((cell) => cell.x === game.food!.x && cell.y === game.food!.y)).toBeFalsy()
  })
})

describe('helpers', () => {
  it('speeds up as tracks are eaten, with a floor', () => {
    expect(tickInterval(0)).toBeGreaterThan(tickInterval(10))
    expect(tickInterval(1000)).toBe(88)
  })

  it('fits a board to the available space', () => {
    expect(fitBoard(880, 616, 44)).toEqual({ cols: 20, rows: 14 })
    expect(fitBoard(100, 100, 44)).toEqual({ cols: 8, rows: 8 })
  })

  it('maps swipes and keys to directions', () => {
    expect(swipeDirection(40, 5)).toBe('right')
    expect(swipeDirection(-3, -60)).toBe('up')
    expect(swipeDirection(10, 10)).toBeNull()
    expect(keyDirection('KeyA')).toBe('left')
    expect(keyDirection('Space')).toBeNull()
  })

  it('returns no food on a full board', () => {
    const game = gameWith({ cols: 1, rows: 1, snake: [{ x: 0, y: 0 }] })
    expect(placeFood(game, first)).toBeNull()
  })
})
