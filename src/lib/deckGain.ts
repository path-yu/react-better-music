/**
 * Click-free volume automation for the two HTMLAudioElement "decks".
 *
 * The player cannot route every source through Web Audio: third-party
 * sources are loaded without CORS, and a tainted element routed through
 * `createMediaElementSource` outputs silence. So gain is applied through
 * `element.volume`, which takes effect immediately at the next audio buffer.
 * Large jumps there are audible as clicks, so every change goes through a
 * ramp with a smooth curve, sampled every few milliseconds:
 *
 * - Ramps are driven by a timer, not requestAnimationFrame. rAF stops while
 *   the window is hidden (tray, minimised), which used to leave a fade frozen
 *   and then cut it with a click when the safety timeout fired. Chromium does
 *   not throttle timers of a page that is playing audio.
 * - Values are computed from the wall clock, so a late tick never stretches
 *   a fade; it only samples it more coarsely.
 *
 * Final element volume = master × leveling × transport × deck.
 */

export type FadeCurve =
  /** sin / cos: constant perceived loudness when two decks cross. */
  | 'equal-power'
  /** Raised cosine: zero slope at both ends, for short de-click fades. */
  | 'smooth'
  | 'linear'

/** ~5 ms steps keep each volume jump small even on 60–150 ms fades. */
const TICK_MS = 5

function shape(curve: FadeCurve, x: number, rising: boolean) {
  if (x <= 0) return 0
  if (x >= 1) return 1
  switch (curve) {
    case 'equal-power':
      // Rising: sin(x·π/2); falling: 1 − cos(x·π/2), so a deck going 1 → 0
      // follows cos and the pair keeps sin² + cos² = 1.
      return rising ? Math.sin((x * Math.PI) / 2) : 1 - Math.cos((x * Math.PI) / 2)
    case 'smooth':
      return (1 - Math.cos(Math.PI * x)) / 2
    default:
      return x
  }
}

interface Ramp {
  from: number
  to: number
  start: number
  duration: number
  curve: FadeCurve
  onDone?: () => void
}

class GainParam {
  value: number
  private ramp: Ramp | null = null

  constructor(value: number) {
    this.value = value
  }

  get ramping() {
    return this.ramp !== null
  }

  get target() {
    return this.ramp ? this.ramp.to : this.value
  }

  /** Jump (cancels a running ramp without calling its callback). */
  set(value: number) {
    this.ramp = null
    this.value = value
  }

  /** Stop where the ramp currently is. */
  hold(now: number) {
    if (!this.ramp) return
    this.step(now, false)
    this.ramp = null
  }

  /** Returns true when the ramp must be sampled over time. */
  rampTo(
    to: number,
    duration: number,
    curve: FadeCurve,
    now: number,
    onDone?: () => void,
  ) {
    this.hold(now)
    if (duration <= 0 || Math.abs(to - this.value) < 0.0005) {
      this.value = to
      onDone?.()
      return false
    }
    this.ramp = { from: this.value, to, start: now, duration, curve, onDone }
    return true
  }

  /** Advance to `now`; returns the finished ramp's callback, if any. */
  step(now: number, complete = true): (() => void) | undefined {
    const ramp = this.ramp
    if (!ramp) return undefined
    const x = (now - ramp.start) / ramp.duration
    const rising = ramp.to > ramp.from
    this.value = ramp.from + (ramp.to - ramp.from) * shape(ramp.curve, x, rising)
    if (x < 1 || !complete) return undefined
    this.value = ramp.to
    this.ramp = null
    return ramp.onDone
  }
}

export class DeckGainMixer {
  private readonly master = new GainParam(1)
  private readonly leveling = new GainParam(1)
  private readonly transport = new GainParam(1)
  private readonly decks = new Map<HTMLAudioElement, GainParam>()
  private timer: ReturnType<typeof setInterval> | null = null
  private readonly written = new WeakMap<HTMLAudioElement, number>()

  constructor(private readonly elements: () => Array<HTMLAudioElement | null>) {}

  destroy() {
    this.stopTimer()
  }

  /* ------------------------------- reads -------------------------------- */

  get transportGain() {
    return this.transport.value
  }

  deckGain(element: HTMLAudioElement | null) {
    return element ? this.deck(element).value : 0
  }

  deckTarget(element: HTMLAudioElement | null) {
    return element ? this.deck(element).target : 0
  }

  isDeckRamping(element: HTMLAudioElement | null) {
    return element ? this.deck(element).ramping : false
  }

  /** A transport or deck fade is running (master / leveling glides excluded). */
  get busy() {
    if (this.transport.ramping) return true
    for (const param of this.decks.values()) {
      if (param.ramping) return true
    }
    return false
  }

  /* ------------------------------- writes ------------------------------- */

  setMaster(value: number, ms = 60) {
    this.ramp(this.master, clampGain(value), ms, 'smooth')
  }

  setLeveling(value: number, ms = 600) {
    this.ramp(this.leveling, value, ms, 'linear')
  }

  setTransport(value: number) {
    this.transport.set(value)
    this.apply()
  }

  rampTransport(to: number, ms: number, curve: FadeCurve = 'smooth', onDone?: () => void) {
    this.ramp(this.transport, to, ms, curve, onDone)
  }

  /** Freeze the transport ramp where it is; its callback is dropped. */
  holdTransport() {
    this.transport.hold(performance.now())
    this.apply()
  }

  setDeck(element: HTMLAudioElement | null, value: number) {
    if (!element) return
    this.deck(element).set(value)
    this.apply()
  }

  rampDeck(
    element: HTMLAudioElement | null,
    to: number,
    ms: number,
    curve: FadeCurve = 'smooth',
    onDone?: () => void,
  ) {
    if (!element) return
    this.ramp(this.deck(element), to, ms, curve, onDone)
  }

  holdDecks() {
    const now = performance.now()
    for (const param of this.decks.values()) param.hold(now)
    this.apply()
  }

  /** Write the current gain stack to both elements. */
  apply() {
    const base = this.master.value * this.leveling.value * this.transport.value
    for (const element of this.elements()) {
      if (!element) continue
      const volume = clampGain(base * this.deck(element).value)
      // Writing an unchanged value still dispatches `volumechange`.
      if (this.written.get(element) === volume && element.volume === volume) continue
      this.written.set(element, volume)
      element.volume = volume
    }
  }

  /* ------------------------------ internals ----------------------------- */

  private deck(element: HTMLAudioElement) {
    let param = this.decks.get(element)
    if (!param) {
      param = new GainParam(1)
      this.decks.set(element, param)
    }
    return param
  }

  private ramp(
    param: GainParam,
    to: number,
    ms: number,
    curve: FadeCurve,
    onDone?: () => void,
  ) {
    const running = param.rampTo(to, ms, curve, performance.now(), onDone)
    this.apply()
    if (running) this.startTimer()
  }

  private params() {
    return [this.master, this.leveling, this.transport, ...this.decks.values()]
  }

  private startTimer() {
    if (this.timer !== null) return
    this.timer = setInterval(this.tick, TICK_MS)
  }

  private stopTimer() {
    if (this.timer === null) return
    clearInterval(this.timer)
    this.timer = null
  }

  private tick = () => {
    const now = performance.now()
    const finished: Array<() => void> = []
    for (const param of this.params()) {
      const done = param.step(now)
      if (done) finished.push(done)
    }
    this.apply()
    // Callbacks may start new ramps; run them after this frame is written.
    for (const done of finished) done()
    if (!this.params().some((param) => param.ramping)) this.stopTimer()
  }
}

function clampGain(value: number) {
  return Math.min(1, Math.max(0, value))
}
