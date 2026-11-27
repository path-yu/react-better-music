import { getAudio } from '../../lib/audio'
import { selectOverlayTime, usePlayerStore } from '../../store/player'
import {
  clamp01,
  easeOutCubic,
  emphasisCurve,
  emphasisParams,
  resolveLyricFrame,
  wordLift,
  wordProgress,
  type LyricFrameState,
  type LyricTimeline,
  type TimedWord,
} from '../../lib/lyricTimeline'

/*
 * Frame engine for the Apple Music style lyric view.
 *
 * React renders the lyric DOM once per song; everything that moves (the
 * per-word wipe, word float, letter glow, interlude dots and the spring
 * scroll) is written here directly to the DOM from one rAF loop, so playback
 * never re-renders React at 60 fps.
 *
 * Constants follow Apple Music as reverse engineered by the AMLL project
 * (Apple Music-like Lyrics): line springs, staggered "wave" scrolling,
 * 0.97 inactive line scale, 0.05em word float.
 */

/** Line position spring (mass / stiffness / damping). */
const POSITION_SPRING = { mass: 0.9, stiffness: 90, damping: 15 }
const SCALE_SPRING = { mass: 2, stiffness: 100, damping: 25 }
/** Each following line starts moving this much later: the scroll "wave". */
const STAGGER_MS = 50
const MAX_STAGGER_STEPS = 16
const INACTIVE_SCALE = 0.97
/** How far a sung word floats up. */
const LIFT_EM = 0.05
/** Extra lift / scale / glow of an emphasised letter at full strength. */
const EMPHASIS_LIFT_EM = 0.04
const EMPHASIS_SCALE = 0.09
/** After the user scrolls the lyrics, wait this long before following again. */
const USER_SCROLL_IDLE_MS = 3000
/** Lines this close to the anchor get their own compositor layer. */
const LAYER_RADIUS = 8
const DRAG_THRESHOLD_PX = 6

class Spring {
  position: number
  target: number
  velocity = 0

  constructor(
    value: number,
    private readonly mass: number,
    private readonly stiffness: number,
    private readonly damping: number,
    private readonly epsilon: number,
  ) {
    this.position = value
    this.target = value
  }

  snap(value: number) {
    this.position = value
    this.target = value
    this.velocity = 0
  }

  get settled() {
    return (
      Math.abs(this.velocity) < this.epsilon &&
      Math.abs(this.position - this.target) < this.epsilon
    )
  }

  step(seconds: number) {
    if (this.settled) {
      this.position = this.target
      this.velocity = 0
      return
    }
    // Semi-implicit Euler in small sub-steps stays stable at any frame rate.
    let remaining = seconds
    while (remaining > 0) {
      const dt = Math.min(remaining, 1 / 240)
      const force =
        -this.stiffness * (this.position - this.target) - this.damping * this.velocity
      this.velocity += (force / this.mass) * dt
      this.position += this.velocity * dt
      remaining -= dt
    }
  }
}

interface WordNode {
  el: HTMLElement
  chars: HTMLElement[]
  progress: number
  lift: number
  emphasis: string
}

interface ItemNode {
  el: HTMLElement
  kind: 'line' | 'interlude'
  /** Line index, or interlude index. */
  index: number
  top: number
  height: number
  y: Spring
  scale: Spring
  pendingY: number | null
  pendingAt: number
  transform: string
  /** Cached word spans; null until the line is first lit. */
  words: WordNode[] | null
  lit: boolean
  dots: HTMLElement[] | null
  dotsGroup: HTMLElement | null
}

function playbackTimeMs() {
  const state = usePlayerStore.getState()
  const audio = getAudio()
  // The audio clock is sample accurate; the store only updates ~4×/s. While a
  // resume is pending the element still sits at 0, so trust the store then.
  if (audio && state.resumeAt == null && state.showNowPlaying) {
    return audio.currentTime * 1000
  }
  return selectOverlayTime(state) * 1000
}

function lineOpacity(away: number) {
  return away === 0 ? 1 : Math.max(0.3, 0.55 - away * 0.06)
}

function lineBlur(away: number) {
  return away === 0 ? 0 : Math.min(2.8, 0.9 + away * 0.42)
}

export interface LyricEngineOptions {
  /** Where the current line sits, as a fraction of the viewport height. */
  align: number
}

export class LyricScrollEngine {
  private items: ItemNode[] = []
  private lineItems: ItemNode[] = []
  private interludeItems: ItemNode[] = []
  private timeline: LyricTimeline = { lines: [], interludes: [] }
  private frameId = 0
  private lastNow = 0
  private viewportHeight = 0
  private layoutDirty = true
  private snapNext = true
  private anchorKey = ''
  private litKey = ''
  private lit = new Set<number>()
  private state: LyricFrameState = { anchorLine: -1, activeLines: [], interlude: -1 }
  private targetScroll = 0
  private userScroll: { offset: number; lastAt: number } | null = null
  private drag: { id: number; lastY: number; moved: number } | null = null
  private suppressClick = false
  private readonly resizeObserver: ResizeObserver
  private readonly reducedMotion: MediaQueryList

  constructor(
    private readonly viewport: HTMLElement,
    private readonly track: HTMLElement,
    private readonly options: LyricEngineOptions,
  ) {
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    this.resizeObserver = new ResizeObserver(() => {
      this.layoutDirty = true
    })
    this.resizeObserver.observe(viewport)
    this.resizeObserver.observe(track)
    viewport.addEventListener('wheel', this.onWheel, { passive: false })
    viewport.addEventListener('pointerdown', this.onPointerDown)
    viewport.addEventListener('pointermove', this.onPointerMove)
    viewport.addEventListener('pointerup', this.onPointerUp)
    viewport.addEventListener('pointercancel', this.onPointerUp)
    viewport.addEventListener('click', this.onClickCapture, true)
    // `overflow: clip` already ignores focus scrolling; this catches anything
    // that still manages to scroll the viewport (e.g. find-in-page).
    viewport.addEventListener('scroll', this.onNativeScroll)
    this.frameId = requestAnimationFrame(this.tick)
  }

  destroy() {
    cancelAnimationFrame(this.frameId)
    // The DOM can outlive this engine (a new one takes over the same nodes).
    for (const item of this.items) {
      this.resetWords(item)
      item.el.classList.remove('is-active')
    }
    this.viewport.classList.remove('is-user-scrolling')
    this.resizeObserver.disconnect()
    this.viewport.removeEventListener('wheel', this.onWheel)
    this.viewport.removeEventListener('pointerdown', this.onPointerDown)
    this.viewport.removeEventListener('pointermove', this.onPointerMove)
    this.viewport.removeEventListener('pointerup', this.onPointerUp)
    this.viewport.removeEventListener('pointercancel', this.onPointerUp)
    this.viewport.removeEventListener('click', this.onClickCapture, true)
    this.viewport.removeEventListener('scroll', this.onNativeScroll)
  }

  setTimeline(timeline: LyricTimeline) {
    this.timeline = timeline
    // Force classes / targets to be re-applied against the new timings.
    this.anchorKey = ''
    this.litKey = ''
  }

  /** Re-read the rendered items after React committed. */
  syncDom() {
    const previous = new Map(this.items.map((item) => [item.el, item]))
    const items: ItemNode[] = []
    const lineItems: ItemNode[] = []
    const interludeItems: ItemNode[] = []
    let changed = false
    for (const child of Array.from(this.track.children)) {
      if (!(child instanceof HTMLElement)) continue
      const line = child.dataset.lyricLine
      const interlude = child.dataset.lyricInterlude
      if (line === undefined && interlude === undefined) continue
      const kind = line !== undefined ? 'line' : 'interlude'
      const index = Number(line ?? interlude)
      const existing = previous.get(child)
      if (!existing || existing.kind !== kind || existing.index !== index) changed = true
      const item: ItemNode = existing ?? {
        el: child,
        kind,
        index,
        top: 0,
        height: 0,
        y: new Spring(-this.targetScroll, POSITION_SPRING.mass, POSITION_SPRING.stiffness, POSITION_SPRING.damping, 0.05),
        scale: new Spring(kind === 'line' ? INACTIVE_SCALE : 1, SCALE_SPRING.mass, SCALE_SPRING.stiffness, SCALE_SPRING.damping, 0.0002),
        pendingY: null,
        pendingAt: 0,
        transform: '',
        words: null,
        lit: false,
        dots: null,
        dotsGroup: null,
      }
      item.kind = kind
      item.index = index
      // The word spans may have been re-rendered (display mode, settings).
      item.words = null
      items.push(item)
      if (kind === 'line') lineItems[index] = item
      else interludeItems[index] = item
    }
    if (items.length !== this.items.length) changed = true
    this.items = items
    this.lineItems = lineItems
    this.interludeItems = interludeItems
    this.layoutDirty = true
    if (changed) {
      // New nodes: re-apply classes and targets. A plain re-render keeps the
      // current state, otherwise it would restart an in-flight scroll wave.
      this.anchorKey = ''
      this.litKey = ''
      this.lit = new Set()
      for (const item of items) item.lit = false
    }
    // Paint the correct state before the browser shows this commit.
    this.render(performance.now())
  }

  /** Called when the user seeks by clicking a line: follow playback again. */
  resumeFollow() {
    if (!this.userScroll) return
    this.endUserScroll(performance.now())
  }

  private get reduced() {
    return this.reducedMotion.matches
  }

  private tick = (now: number) => {
    this.frameId = requestAnimationFrame(this.tick)
    if (document.hidden) {
      this.lastNow = 0
      return
    }
    this.render(now)
  }

  private render(now: number) {
    const dt = this.lastNow ? Math.min(0.064, Math.max(0, (now - this.lastNow) / 1000)) : 0
    this.lastNow = now
    if (this.layoutDirty) this.measure(now)
    // Hidden (display: none or zero-height overlay): nothing to draw.
    if (this.viewportHeight <= 0 || !this.items.length) return

    const timeMs = playbackTimeMs()
    const state = resolveLyricFrame(this.timeline, timeMs)
    this.state = state
    this.applyLit(state)
    this.applyAnchor(state, now)
    if (this.userScroll && !this.drag && now - this.userScroll.lastAt > USER_SCROLL_IDLE_MS) {
      this.endUserScroll(now)
    }
    this.updateWords(timeMs)
    this.updateInterlude(timeMs, now)
    this.stepItems(dt, now)
  }

  private measure(now: number) {
    this.layoutDirty = false
    this.viewportHeight = this.viewport.clientHeight
    for (const item of this.items) {
      item.top = item.el.offsetTop
      item.height = item.el.offsetHeight
    }
    // Sizes changed (resize, font, interlude opening): re-aim without a wave.
    if (this.anchorKey) this.scrollToAnchor(now, false)
  }

  private anchorItem(state = this.state): ItemNode | undefined {
    if (state.interlude >= 0) return this.interludeItems[state.interlude]
    return this.lineItems[Math.max(0, state.anchorLine)]
  }

  /** Line index used to measure blur/opacity distance. */
  private focusLine(state: LyricFrameState) {
    if (state.interlude >= 0) {
      return this.timeline.interludes[state.interlude]?.beforeLine ?? -1
    }
    return state.anchorLine
  }

  private applyLit(state: LyricFrameState) {
    const key = `${state.activeLines.join(',')}|${state.interlude}|${state.anchorLine}`
    if (key === this.litKey) return
    this.litKey = key
    const lit = new Set(state.activeLines)
    const focus = this.focusLine(state)
    for (const item of this.lineItems) {
      if (!item) continue
      const isLit = lit.has(item.index)
      if (isLit !== item.lit) {
        item.lit = isLit
        if (!isLit) this.resetWords(item)
      }
      item.el.classList.toggle('is-active', isLit)
      // Before the first line nothing is defocused yet.
      const away = isLit ? 0 : focus < 0 ? 1 : Math.max(1, Math.abs(item.index - focus))
      const blur = focus < 0 ? 0 : lineBlur(away)
      item.el.style.setProperty('--lyric-opacity', String(lineOpacity(away)))
      item.el.style.setProperty('--lyric-blur', `${blur.toFixed(2)}px`)
      item.el.classList.toggle('is-blurred', blur > 0)
    }
    for (const item of this.interludeItems) {
      if (!item) continue
      const isActive = item.index === state.interlude
      item.el.classList.toggle('is-active', isActive)
      if (!isActive && item.dotsGroup) {
        item.dotsGroup.style.transform = ''
        for (const dot of item.dots ?? []) dot.style.opacity = ''
      }
    }
    this.lit = lit
  }

  private applyAnchor(state: LyricFrameState, now: number) {
    const key =
      state.interlude >= 0 ? `i${state.interlude}` : `l${Math.max(0, state.anchorLine)}`
    if (key === this.anchorKey) return
    this.anchorKey = key
    this.scrollToAnchor(now, true)
  }

  private scrollToAnchor(now: number, stagger: boolean) {
    const anchor = this.anchorItem()
    if (!anchor) return
    const target = anchor.top + anchor.height / 2 - this.viewportHeight * this.options.align
    const jump = Math.abs(target - this.targetScroll) > this.viewportHeight * 1.5
    this.targetScroll = target
    const anchorPosition = this.items.indexOf(anchor)
    this.items.forEach((item, position) => {
      item.el.style.willChange =
        Math.abs(position - anchorPosition) <= LAYER_RADIUS ? 'transform' : ''
    })
    if (this.userScroll) return
    const y = -target
    const snap = this.snapNext || this.reduced
    this.snapNext = false
    this.items.forEach((item, position) => {
      if (snap) {
        item.y.snap(y)
        item.pendingY = null
        return
      }
      if (!stagger) {
        // Keep an in-flight wave: only correct where it is heading.
        if (item.pendingY !== null) item.pendingY = y
        else item.y.target = y
        return
      }
      // The line above the new anchor leaves first, then the anchor, then each
      // following line a beat later.
      const steps = jump
        ? 0
        : Math.min(MAX_STAGGER_STEPS, Math.max(0, position - (anchorPosition - 1)))
      if (steps === 0) {
        item.y.target = y
        item.pendingY = null
      } else {
        item.pendingY = y
        item.pendingAt = now + steps * STAGGER_MS
      }
    })
  }

  private wordsOf(item: ItemNode): WordNode[] {
    if (item.words) return item.words
    const timed = this.timeline.lines[item.index]?.words ?? []
    const spans = Array.from(item.el.querySelectorAll<HTMLElement>('[data-lyric-word]'))
    item.words =
      spans.length === timed.length
        ? spans.map((el) => ({
            el,
            chars: Array.from(el.querySelectorAll<HTMLElement>('[data-lyric-char]')),
            progress: -1,
            lift: -1,
            emphasis: '',
          }))
        : []
    return item.words
  }

  private resetWords(item: ItemNode) {
    for (const word of item.words ?? []) {
      word.el.style.removeProperty('--p')
      // Cleared while the line is no longer `.is-active`, so the CSS
      // transition floats the word back down instead of snapping.
      word.el.style.transform = ''
      for (const char of word.chars) {
        char.style.transform = ''
        char.style.textShadow = ''
      }
      word.progress = -1
      word.lift = -1
      word.emphasis = ''
    }
  }

  private updateWords(timeMs: number) {
    const reduced = this.reduced
    for (const lineIndex of this.lit) {
      const item = this.lineItems[lineIndex]
      const timed = this.timeline.lines[lineIndex]?.words
      if (!item || !timed?.length) continue
      const nodes = this.wordsOf(item)
      nodes.forEach((node, index) => {
        const word = timed[index]
        if (!word) return
        const progress = Math.round(wordProgress(word, timeMs) * 1000) / 1000
        if (progress !== node.progress) {
          node.progress = progress
          node.el.style.setProperty('--p', String(progress))
        }
        const lift = reduced ? 0 : Math.round(wordLift(word, timeMs) * 1000) / 1000
        if (lift !== node.lift) {
          node.lift = lift
          node.el.style.transform = lift ? `translate3d(0, ${(-lift * LIFT_EM).toFixed(4)}em, 0)` : ''
        }
        if (word.emphasize && node.chars.length && !reduced) {
          this.updateEmphasis(node, word, timeMs)
        }
      })
    }
  }

  private updateEmphasis(
    node: WordNode,
    word: TimedWord,
    timeMs: number,
  ) {
    const { strength } = emphasisParams(word.end - word.start, word.last)
    const count = node.chars.length
    let signature = ''
    const curves = node.chars.map((_, index) => {
      const curve = Math.round(emphasisCurve(word, timeMs, index, count) * 500) / 500
      signature += `${curve},`
      return curve
    })
    if (signature === node.emphasis) return
    node.emphasis = signature
    node.chars.forEach((char, index) => {
      const curve = curves[index] * strength
      if (curve <= 0) {
        char.style.transform = ''
        char.style.textShadow = ''
        return
      }
      char.style.transform = `translate3d(0, ${(-EMPHASIS_LIFT_EM * curve).toFixed(4)}em, 0) scale(${(1 + EMPHASIS_SCALE * curve).toFixed(4)})`
      // White bloom around the held letters; keeps the readability shadow.
      char.style.textShadow = `0 0 ${(0.12 + 0.3 * curve).toFixed(3)}em rgba(255, 255, 255, ${(0.5 * Math.min(1, curve)).toFixed(3)})`
    })
  }

  private updateInterlude(timeMs: number, now: number) {
    const index = this.state.interlude
    if (index < 0) return
    const interlude = this.timeline.interludes[index]
    const item = this.interludeItems[index]
    if (!interlude || !item) return
    if (!item.dots) {
      item.dotsGroup = item.el.querySelector<HTMLElement>('.lyric-interlude__dots')
      item.dots = Array.from(item.el.querySelectorAll<HTMLElement>('.lyric-interlude__dot'))
    }
    const total = Math.max(1, interlude.end - interlude.start)
    const elapsed = timeMs - interlude.start
    const remaining = interlude.end - timeMs
    // The three dots fill one after another over the break…
    const fill = clamp01(elapsed / Math.max(1, total - 600))
    item.dots.forEach((dot, dotIndex) => {
      const alpha = 0.22 + 0.78 * clamp01(fill * item.dots!.length - dotIndex)
      dot.style.opacity = alpha.toFixed(3)
    })
    if (!item.dotsGroup) return
    // …while the group breathes, then swells and collapses as the line comes in.
    const breath = this.reduced ? 1 : 1 + 0.06 * Math.sin((now / 1000) * Math.PI)
    const exit =
      remaining < 600
        ? remaining > 300
          ? 1 + 0.12 * easeOutCubic((600 - remaining) / 300)
          : 1.12 * easeOutCubic(remaining / 300)
        : 1
    item.dotsGroup.style.transform = `scale(${(breath * exit).toFixed(4)})`
  }

  private stepItems(seconds: number, now: number) {
    for (const item of this.items) {
      if (item.pendingY !== null && now >= item.pendingAt) {
        item.y.target = item.pendingY
        item.pendingY = null
      }
      const targetScale = item.kind === 'line' && !item.lit ? INACTIVE_SCALE : 1
      if (this.reduced) {
        item.y.snap(item.y.target)
        item.scale.snap(targetScale)
      } else {
        item.scale.target = targetScale
        item.y.step(seconds)
        item.scale.step(seconds)
      }
      const transform = `translate3d(0, ${item.y.position.toFixed(2)}px, 0) scale(${item.scale.position.toFixed(4)})`
      if (transform !== item.transform) {
        item.transform = transform
        item.el.style.transform = transform
      }
    }
  }

  /* ------------------------------ user scroll ----------------------------- */

  private scrollBounds() {
    const first = this.items[0]
    const last = this.items[this.items.length - 1]
    const offset = this.viewportHeight * this.options.align
    return {
      min: first ? first.top + first.height / 2 - offset : 0,
      max: last ? last.top + last.height / 2 - offset : 0,
    }
  }

  private scrollBy(delta: number, immediate: boolean) {
    if (!this.items.length) return
    const now = performance.now()
    if (!this.userScroll) {
      // Start from where the lyrics are drawn now, not where they are heading.
      this.userScroll = { offset: -(this.items[0]?.y.position ?? 0), lastAt: now }
      this.viewport.classList.add('is-user-scrolling')
    }
    const { min, max } = this.scrollBounds()
    this.userScroll.offset = Math.min(max, Math.max(min, this.userScroll.offset + delta))
    this.userScroll.lastAt = now
    const y = -this.userScroll.offset
    for (const item of this.items) {
      item.pendingY = null
      if (immediate) item.y.snap(y)
      else item.y.target = y
    }
  }

  private endUserScroll(now: number) {
    this.userScroll = null
    this.viewport.classList.remove('is-user-scrolling')
    this.scrollToAnchor(now, false)
  }

  private onWheel = (event: WheelEvent) => {
    if (event.ctrlKey) return // pinch-zoom
    event.preventDefault()
    const scale = event.deltaMode === 1 ? 32 : event.deltaMode === 2 ? this.viewportHeight : 1
    this.scrollBy(event.deltaY * scale, false)
  }

  private onPointerDown = (event: PointerEvent) => {
    if (event.pointerType !== 'touch') return
    this.drag = { id: event.pointerId, lastY: event.clientY, moved: 0 }
  }

  private onPointerMove = (event: PointerEvent) => {
    const drag = this.drag
    if (!drag || drag.id !== event.pointerId) return
    const delta = drag.lastY - event.clientY
    drag.lastY = event.clientY
    drag.moved += Math.abs(delta)
    if (drag.moved < DRAG_THRESHOLD_PX) return
    this.suppressClick = true
    this.scrollBy(delta, true)
  }

  private onPointerUp = (event: PointerEvent) => {
    if (this.drag?.id !== event.pointerId) return
    this.drag = null
    if (this.userScroll) this.userScroll.lastAt = performance.now()
    // The click that ends a drag fires after pointerup.
    window.setTimeout(() => {
      this.suppressClick = false
    }, 0)
  }

  private onClickCapture = (event: MouseEvent) => {
    if (!this.suppressClick) return
    event.preventDefault()
    event.stopPropagation()
    this.suppressClick = false
  }

  private onNativeScroll = () => {
    if (this.viewport.scrollTop !== 0) this.viewport.scrollTop = 0
  }
}
