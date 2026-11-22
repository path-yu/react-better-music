import {
  Application,
  CLEAR_MODES,
  Container,
  Filter,
  Graphics,
  Point,
  Sprite,
  Texture,
  type FilterSystem,
  type RenderTexture,
} from 'pixi.js'
import {
  APPLE_BACKDROP_FPS,
  FADE_PER_FRAME,
  FRAME_MS,
  layoutSprites,
  stepRotations,
  type Rotations,
} from './appleBackdropMotion'

/*
 * Apple Music–style animated backdrop for the song page.
 *
 * Same pipeline and numbers as Apple Music Web's `LyricsScene`
 * (music.apple.com, PixiJS 7.1): four copies of the cover drawn into one
 * container, then twist → five Kawase blur passes → saturation / contrast
 * boost, under a 50 % black + 5 % white veil, on white, at 15 fps.
 *
 * The three filters are the open-source pixi-filters v5 implementations
 * (MIT, © Matt Karl / pixi-filters contributors), inlined so the project
 * only depends on `pixi.js`. Shaders and parameters are unchanged.
 */

/* ------------------------------- filters ------------------------------- */

// pixi-filters' legacy filter vertex: pixel positions + explicit UVs.
const FILTER_VERTEX = `attribute vec2 aVertexPosition;
attribute vec2 aTextureCoord;

uniform mat3 projectionMatrix;

varying vec2 vTextureCoord;

void main(void)
{
    gl_Position = vec4((projectionMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
    vTextureCoord = aTextureCoord;
}`

const TWIST_FRAGMENT = `varying vec2 vTextureCoord;

uniform sampler2D uSampler;
uniform float radius;
uniform float angle;
uniform vec2 offset;
uniform vec4 filterArea;

vec2 mapCoord( vec2 coord )
{
    coord *= filterArea.xy;
    coord += filterArea.zw;

    return coord;
}

vec2 unmapCoord( vec2 coord )
{
    coord -= filterArea.zw;
    coord /= filterArea.xy;

    return coord;
}

vec2 twist(vec2 coord)
{
    coord -= offset;

    float dist = length(coord);

    if (dist < radius)
    {
        float ratioDist = (radius - dist) / radius;
        float angleMod = ratioDist * ratioDist * angle;
        float s = sin(angleMod);
        float c = cos(angleMod);
        coord = vec2(coord.x * c - coord.y * s, coord.x * s + coord.y * c);
    }

    coord += offset;

    return coord;
}

void main(void)
{

    vec2 coord = mapCoord(vTextureCoord);

    coord = twist(coord);

    coord = unmapCoord(coord);

    gl_FragColor = texture2D(uSampler, coord );

}
`

const KAWASE_FRAGMENT = `
varying vec2 vTextureCoord;
uniform sampler2D uSampler;

uniform vec2 uOffset;

void main(void)
{
    vec4 color = vec4(0.0);

    // Sample top left pixel
    color += texture2D(uSampler, vec2(vTextureCoord.x - uOffset.x, vTextureCoord.y + uOffset.y));

    // Sample top right pixel
    color += texture2D(uSampler, vec2(vTextureCoord.x + uOffset.x, vTextureCoord.y + uOffset.y));

    // Sample bottom right pixel
    color += texture2D(uSampler, vec2(vTextureCoord.x + uOffset.x, vTextureCoord.y - uOffset.y));

    // Sample bottom left pixel
    color += texture2D(uSampler, vec2(vTextureCoord.x - uOffset.x, vTextureCoord.y - uOffset.y));

    // Average
    color *= 0.25;

    gl_FragColor = color;
}`

const ADJUSTMENT_FRAGMENT = `varying vec2 vTextureCoord;
uniform sampler2D uSampler;

uniform float gamma;
uniform float contrast;
uniform float saturation;
uniform float brightness;
uniform float red;
uniform float green;
uniform float blue;
uniform float alpha;

void main(void)
{
    vec4 c = texture2D(uSampler, vTextureCoord);

    if (c.a > 0.0) {
        c.rgb /= c.a;

        vec3 rgb = pow(c.rgb, vec3(1. / gamma));
        rgb = mix(vec3(.5), mix(vec3(dot(vec3(.2125, .7154, .0721), rgb)), rgb, saturation), contrast);
        rgb.r *= red;
        rgb.g *= green;
        rgb.b *= blue;
        c.rgb = rgb * brightness;

        c.rgb *= c.a;
    }

    gl_FragColor = c * alpha;
}
`

class TwistFilter extends Filter {
  constructor(radius: number, angle: number) {
    super(FILTER_VERTEX, TWIST_FRAGMENT, { radius, angle, offset: new Point() })
    this.padding = 20
  }

  setCenter(x: number, y: number) {
    ;(this.uniforms.offset as Point).set(x, y)
  }
}

/** Kawase blur: `quality` passes whose offsets step down from `blur`. */
class KawaseBlurFilter extends Filter {
  private readonly kernels: number[]

  constructor(blur: number, quality: number) {
    super(FILTER_VERTEX, KAWASE_FRAGMENT)
    this.uniforms.uOffset = new Float32Array(2)
    const passes = Math.max(1, Math.round(quality))
    const kernels = [blur]
    if (blur > 0) {
      let value = blur
      const step = blur / passes
      for (let index = 1; index < passes; index++) {
        value -= step
        kernels.push(value)
      }
    }
    this.kernels = kernels
    this.padding = Math.ceil(kernels.reduce((sum, kernel) => sum + kernel + 0.5, 0))
  }

  override apply(
    filterManager: FilterSystem,
    input: RenderTexture,
    output: RenderTexture,
    clearMode?: CLEAR_MODES,
  ) {
    const uvX = 1 / input.frame.width
    const uvY = 1 / input.frame.height
    const offset = this.uniforms.uOffset as Float32Array
    const setOffset = (kernel: number) => {
      offset[0] = (kernel + 0.5) * uvX
      offset[1] = (kernel + 0.5) * uvY
    }
    const last = this.kernels.length - 1
    if (last === 0) {
      setOffset(this.kernels[0])
      filterManager.applyFilter(this, input, output, clearMode)
      return
    }
    const scratch = filterManager.getFilterTexture()
    let source = input
    let target = scratch
    for (let index = 0; index < last; index++) {
      setOffset(this.kernels[index])
      filterManager.applyFilter(this, source, target, CLEAR_MODES.CLEAR)
      ;[source, target] = [target, source]
    }
    setOffset(this.kernels[last])
    filterManager.applyFilter(this, source, output, clearMode)
    filterManager.returnFilterTexture(scratch)
  }
}

class AdjustmentFilter extends Filter {
  constructor(options: { saturation: number; brightness: number; contrast: number }) {
    super(FILTER_VERTEX, ADJUSTMENT_FRAGMENT, {
      gamma: 1,
      red: 1,
      green: 1,
      blue: 1,
      alpha: 1,
      ...options,
    })
  }
}

/* -------------------------------- scene -------------------------------- */

/** NetEase's image CDN does not always send CORS headers; WebGL needs them. */
function loadCover(url: string, signal: { cancelled: boolean }) {
  const attempt = (src: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image()
      image.crossOrigin = 'anonymous'
      image.decoding = 'async'
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error(`cover load failed: ${src}`))
      image.src = src
    })
  const proxied = /^https?:/i.test(url)
    ? `https://wsrv.nl/?url=${encodeURIComponent(url)}&w=320&h=320&output=jpg`
    : null
  return attempt(url).catch((error) => {
    if (!proxied || signal.cancelled) throw error
    return attempt(proxied)
  })
}

type CoverSet = { sprites: Sprite[]; texture: Texture; startAlpha: number[] }

export class AppleBackdropScene {
  private readonly app: Application
  private readonly canvas: HTMLCanvasElement
  private readonly covers = new Container()
  private readonly base = new Graphics()
  private readonly veil = new Graphics()
  private readonly twist = new TwistFilter(900, -3.25)
  private readonly reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
  private readonly resizeObserver: ResizeObserver
  private current: CoverSet | null = null
  private outgoing: CoverSet | null = null
  private fade = 1
  private rotations: Rotations = [0, 0, 0, 0]
  private playing = false
  /** 0 = still, 1 = Apple's speed; eased so pausing does not stop dead. */
  private speed = 0
  private artworkUrl = ''
  private loadToken = 0
  private loadSignal = { cancelled: false }
  private destroyed = false
  private readonly onContextLost: () => void

  constructor(canvas: HTMLCanvasElement, onContextLost: () => void) {
    this.canvas = canvas
    this.onContextLost = onContextLost
    const { width, height } = canvas.getBoundingClientRect()
    this.app = new Application({
      view: canvas,
      width: Math.max(1, Math.round(width)),
      height: Math.max(1, Math.round(height)),
      backgroundAlpha: 0,
      powerPreference: 'low-power',
      antialias: false,
    })
    this.app.ticker.maxFPS = APPLE_BACKDROP_FPS

    const blurs = [
      new KawaseBlurFilter(5, 1),
      new KawaseBlurFilter(10, 1),
      new KawaseBlurFilter(20, 2),
      new KawaseBlurFilter(40, 2),
      new KawaseBlurFilter(80, 2),
    ]
    const adjustment = new AdjustmentFilter({ saturation: 2.75, brightness: 0.7, contrast: 1.9 })
    this.covers.filters = [this.twist, ...blurs, adjustment]

    this.app.stage.addChild(this.base, this.covers, this.veil)
    this.drawPlates()

    this.app.ticker.add(this.tick)
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(canvas)
    canvas.addEventListener('webglcontextlost', this.handleContextLost)
    this.reduceMotion.addEventListener('change', this.wake)
  }

  get hasArtwork() {
    return Boolean(this.current)
  }

  setPlaying(playing: boolean) {
    this.playing = playing
    this.wake()
  }

  /** Resolves false when the cover could not be loaded (the previous one stays). */
  async setArtwork(url: string | null | undefined) {
    if (!url || url === this.artworkUrl || this.destroyed) return Boolean(this.current)
    this.artworkUrl = url
    const token = ++this.loadToken
    this.loadSignal.cancelled = true
    const signal = { cancelled: false }
    this.loadSignal = signal
    let image: HTMLImageElement
    try {
      image = await loadCover(url, signal)
    } catch {
      if (token === this.loadToken) this.artworkUrl = ''
      return false
    }
    if (this.destroyed || token !== this.loadToken) return Boolean(this.current)

    // A song change during a cross-fade drops the oldest set right away.
    if (this.outgoing) this.disposeSet(this.outgoing)
    if (this.current) {
      this.current.startAlpha = this.current.sprites.map((sprite) => sprite.alpha)
    }
    this.outgoing = this.current
    const texture = Texture.from(image)
    const sprites = Array.from({ length: 4 }, () => {
      const sprite = new Sprite(texture)
      sprite.anchor.set(0.5)
      sprite.alpha = 0
      return sprite
    })
    this.current = { sprites, texture, startAlpha: [] }
    this.covers.addChild(...sprites)
    this.fade = 0
    this.layout()
    this.wake()
    return true
  }

  destroy() {
    if (this.destroyed) return
    this.destroyed = true
    this.loadSignal.cancelled = true
    this.resizeObserver.disconnect()
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost)
    this.reduceMotion.removeEventListener('change', this.wake)
    this.app.ticker.remove(this.tick)
    // The canvas belongs to React; keep it in the DOM.
    this.app.destroy(false, { children: true, texture: true, baseTexture: true })
  }

  private readonly handleContextLost = (event: Event) => {
    event.preventDefault()
    this.onContextLost()
  }

  /** One ticker callback for the whole scene (Apple added one per song and
      never removed them). */
  private readonly tick = () => {
    const frames = this.app.ticker.deltaMS / FRAME_MS
    const target = this.playing ? 1 : 0
    this.speed += (target - this.speed) * Math.min(1, 0.12 * frames)
    if (Math.abs(target - this.speed) < 0.01) this.speed = target
    this.rotations = stepRotations(this.rotations, frames * this.speed, this.reduceMotion.matches)

    if (this.fade < 1) {
      this.fade = Math.min(1, this.fade + FADE_PER_FRAME * frames)
      for (const sprite of this.current?.sprites ?? []) sprite.alpha = this.fade
      const outgoing = this.outgoing
      if (outgoing) {
        outgoing.sprites.forEach((sprite, index) => {
          sprite.alpha = (outgoing.startAlpha[index] ?? 1) * (1 - this.fade)
        })
        if (this.fade >= 1) {
          this.disposeSet(outgoing)
          this.outgoing = null
        }
      }
    }

    this.layout()
    // Paused and settled: keep the last frame on screen and let the GPU rest.
    if (this.speed === 0 && this.fade >= 1) this.app.ticker.stop()
  }

  private readonly wake = () => {
    if (this.destroyed) return
    if (!this.app.ticker.started) this.app.ticker.start()
  }

  private resize() {
    if (this.destroyed) return
    const { width, height } = this.canvas.getBoundingClientRect()
    const w = Math.max(1, Math.round(width))
    const h = Math.max(1, Math.round(height))
    if (w === this.app.renderer.width && h === this.app.renderer.height) return
    this.app.renderer.resize(w, h)
    this.drawPlates()
    this.layout()
    this.app.render()
  }

  /** White base, then 50 % black and 5 % white over the blurred covers. */
  private drawPlates() {
    const { width, height } = this.app.renderer
    this.base.clear().beginFill(0xffffff).drawRect(0, 0, width, height).endFill()
    this.veil
      .clear()
      .beginFill(0x000000, 0.5)
      .drawRect(0, 0, width, height)
      .endFill()
      .beginFill(0xffffff, 0.05)
      .drawRect(0, 0, width, height)
      .endFill()
    this.twist.setCenter(width / 2, height / 2)
  }

  private layout() {
    const { width, height } = this.app.renderer
    const slots = layoutSprites(width, height, this.rotations)
    for (const set of [this.outgoing, this.current]) {
      set?.sprites.forEach((sprite, index) => {
        const slot = slots[index]
        sprite.position.set(slot.x, slot.y)
        sprite.width = slot.size
        sprite.height = slot.size
        sprite.rotation = slot.rotation
      })
    }
  }

  private disposeSet(set: CoverSet) {
    this.covers.removeChild(...set.sprites)
    for (const sprite of set.sprites) sprite.destroy()
    if (set.texture !== this.current?.texture) set.texture.destroy(true)
  }
}
