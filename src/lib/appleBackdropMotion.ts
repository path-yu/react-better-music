/**
 * Motion and layout of the Apple Music–style song page backdrop, kept free of
 * PixiJS so it can be unit-tested. The numbers are the ones Apple Music Web
 * uses in its `LyricsScene` (music.apple.com, PixiJS 7): four copies of the
 * cover, each spinning at its own rate, two of them orbiting the centre.
 */

export type Rotations = [number, number, number, number]

/** Apple caps the scene at 15 fps: the picture is blurred far past the point
    where a higher rate would be visible, and it keeps the GPU mostly idle. */
export const APPLE_BACKDROP_FPS = 15

/** Rotation steps are written per 30 fps frame; ticks pass their length in
    those frames (`deltaMS / 33.33`). */
export const FRAME_MS = 1000 / 30

/** Cross-fade between two covers: alpha moves 0.02 per 30 fps frame (~1.7 s). */
export const FADE_PER_FRAME = 0.02

export function stepRotations(
  rotations: Rotations,
  frames: number,
  reducedMotion: boolean,
): Rotations {
  const [a, b, c, d] = rotations
  if (reducedMotion) {
    const step = 0.001 * frames
    return [a + step, b + step, c + step, d + step]
  }
  return [a + 0.003 * frames, b - 0.008 * frames, c - 0.006 * frames, d + 0.004 * frames]
}

export interface SpriteLayout {
  x: number
  y: number
  /** Square sprites: width and height. */
  size: number
  rotation: number
}

/**
 * Where the four covers sit for a `width` × `height` canvas.
 *
 * Apple sizes everything from the canvas width, which only covers landscape
 * windows. `base` is the longer side instead: identical to Apple in landscape,
 * and a portrait (mobile) window no longer shows bare bands above and below.
 */
export function layoutSprites(width: number, height: number, rotations: Rotations): SpriteLayout[] {
  const base = Math.max(width, height)
  const cx = width / 2
  const cy = height / 2
  const orbit = base / 4
  const [a, b, c, d] = rotations
  return [
    { x: cx, y: cy, size: base * 1.25, rotation: a },
    { x: width / 2.5, y: height / 2.5, size: base * 0.8, rotation: b },
    {
      x: cx + orbit * Math.cos(c * 0.75),
      y: cy + orbit * Math.sin(c * 0.75),
      size: base * 0.5,
      rotation: -c,
    },
    {
      x: cx + base * 0.05 + orbit * Math.cos(d * 0.75),
      y: cy + base * 0.05 + orbit * Math.sin(d * 0.75),
      size: base * 0.25,
      rotation: -d,
    },
  ]
}
