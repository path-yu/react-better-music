import { useEffect, useRef } from 'react'

interface ArtworkGradientProps {
  colors: string[]
  className?: string
}

type RGB = [number, number, number]

function parseColor(color: string): RGB {
  const rgb = color.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i)
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
  const hex = color.trim().match(/^#([\da-f]{6})$/i)
  if (hex) {
    const value = hex[1]
    return [
      parseInt(value.slice(0, 2), 16),
      parseInt(value.slice(2, 4), 16),
      parseInt(value.slice(4, 6), 16),
    ]
  }
  return [28, 28, 32]
}

function lighten(color: RGB, amount: number): RGB {
  return [
    Math.round(color[0] + (255 - color[0]) * amount),
    Math.round(color[1] + (255 - color[1]) * amount),
    Math.round(color[2] + (255 - color[2]) * amount),
  ]
}

function mixRgb(a: RGB, b: RGB, amount: number): RGB {
  return [
    Math.round(a[0] + (b[0] - a[0]) * amount),
    Math.round(a[1] + (b[1] - a[1]) * amount),
    Math.round(a[2] + (b[2] - a[2]) * amount),
  ]
}

function hueOf([r, g, b]: RGB): number {
  const red = r / 255
  const green = g / 255
  const blue = b / 255
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const delta = max - min
  if (delta === 0) return 0
  let hue: number
  if (max === red) hue = ((green - blue) / delta) % 6
  else if (max === green) hue = (blue - red) / delta + 2
  else hue = (red - green) / delta + 4
  hue *= 60
  return hue < 0 ? hue + 360 : hue
}

/**
 * The raw artwork palette often contains a near-black and a beige bucket.
 * Mixing those with the red/blue accents produces muddy brown. Keep only
 * saturated, mid-light colours for the mesh and derive lighter stops from them,
 * which is much closer to Apple's vivid blue/red/purple wash.
 */
function preparePalette(colors: string[]): RGB[] {
  const parsed = colors.length ? colors.map(parseColor) : [[24, 24, 28] as RGB]
  const scored = parsed.map((color) => {
    const r = color[0] / 255
    const g = color[1] / 255
    const b = color[2] / 255
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const lightness = (max + min) / 2
    const denominator = 1 - Math.abs(2 * lightness - 1)
    const saturation = denominator > 0 ? (max - min) / denominator : 0
    return {
      color,
      hue: hueOf(color),
      saturation,
      lightness,
      score: saturation * 0.8 + (1 - Math.abs(lightness - 0.5)) * 0.2,
    }
  })
  const vivid = scored.filter(
    (entry) => entry.saturation >= 0.18 && entry.lightness >= 0.12 && entry.lightness <= 0.9,
  )
  const pool = vivid.length >= 2 ? vivid : scored
  // A cool base + warm accent reproduces the blue/red split of Apple's wash,
  // instead of letting beige/skin tones dominate the mesh.
  const warmCandidates = pool.filter(
    (entry) => entry.hue < 35 || entry.hue > 320,
  )
  // Prefer a saturated true red over an orange/skin tone for the warm side.
  const warm = [...warmCandidates].sort((a, b) => {
    const redScore = (entry: (typeof warmCandidates)[number]) =>
      entry.saturation - (Math.min(entry.hue, 360 - entry.hue) / 90) * 0.5
    return redScore(b) - redScore(a)
  })[0]
  const cool = pool
    .filter((entry) => entry.hue >= 170 && entry.hue <= 280)
    .sort((a, b) => b.score - a.score)[0]
  const blue = cool?.color ?? ([32, 64, 128] as RGB)
  const sourceRed = warm?.color ?? ([184, 44, 38] as RGB)
  // Art-direct the warm side towards a true red; orange/beige samples make the
  // whole wash look like a sunset instead of Apple's blue/red/purple.
  const red =
    warm && Math.min(warm.hue, 360 - warm.hue) > 15
      ? mixRgb(sourceRed, [184, 44, 38], 0.5)
      : sourceRed
  const purple = mixRgb(mixRgb(red, blue, 0.5), [58, 30, 88], 0.35)
  const base: RGB[] = [red, blue, purple]
  const result = [...base]
  for (let index = 0; result.length < 6 && index < base.length; index += 1) {
    result.push(lighten(base[index], 0.3))
  }
  while (result.length < 6) {
    result.push(lighten(result[result.length - 1] ?? [28, 28, 32], 0.2))
  }
  return result
}

const VERTEX_SHADER = `
attribute vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`

/**
 * Domain-warped 2D simplex fBm: four octave fields push each other around, so
 * the surface churns like a slow cloud instead of moving like a few blobs.
 * Six sampled cover colours become the gradient stops.
 */
const FRAGMENT_SHADER = `
precision highp float;

uniform float u_time;
uniform vec2 u_resolution;
uniform vec3 u_colors[6];

vec3 mod289(vec3 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec2 mod289(vec2 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec3 permute(vec3 x) {
  return mod289(((x * 34.0) + 1.0) * x);
}

float snoise(vec2 v) {
  const vec4 C = vec4(
    0.211324865405187,
    0.366025403784439,
    -0.577350269189626,
    0.024390243902439
  );
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute(
    permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0)
  );
  vec3 m = max(
    0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)),
    0.0
  );
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 3; i++) {
    value += amplitude * snoise(p);
    p *= 2.03;
    amplitude *= 0.5;
  }
  return value;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;

  // Rotate the cloud field very slowly so even a long session keeps drifting.
  float angle = u_time * 0.025;
  vec2 p = (uv - 0.5) * 2.8;
  p = mat2(cos(angle), -sin(angle), sin(angle), cos(angle)) * p;
  float t = u_time * 0.06;

  // Inigo Quilez-style double domain warp: each fBm field feeds the next.
  vec2 q = vec2(
    fbm(p + vec2(t, t * 0.6)),
    fbm(p + vec2(5.2 + t, 1.3 - t))
  );
  vec2 r = vec2(
    fbm(p + 2.0 * q + vec2(1.7, 9.2) + vec2(0.15 * t, -0.1 * t)),
    fbm(p + 2.0 * q + vec2(8.3, 2.8) + vec2(-0.126 * t, 0.08 * t))
  );
  float f = fbm(p + 2.0 * r);
  float n = clamp(f * 0.5 + 0.5, 0.0, 1.0);

  // Apple's backdrop is not a simple left/right split: a dark navy field,
  // purple toward the top, and red accents at the left edge and bottom-right.
  // fBm warps these masks so the regions breathe instead of forming hard bands.
  vec2 warped = uv + q * 0.045 + r * 0.025;
  vec3 base = mix(u_colors[1], vec3(0.015, 0.02, 0.05), 0.45);
  vec3 color = base;

  // WebGL's fragment origin is bottom-left; screen y runs the other way.
  float screenY = 1.0 - warped.y;
  float topMask = smoothstep(0.7, 0.0, screenY + (n - 0.5) * 0.1);
  color = mix(color, u_colors[2], topMask * 0.55);

  float leftMask = smoothstep(0.65, 0.0, warped.x + (n - 0.5) * 0.08);
  color = mix(color, u_colors[0], leftMask * 0.85 * (1.0 - topMask * 0.65));

  vec2 redSpot = vec2(0.84, 0.12);
  float spot = 1.0 - smoothstep(
    0.0,
    0.7,
    length((warped - redSpot) * vec2(1.0, 1.2))
  );
  color = mix(color, u_colors[0], spot * 0.8);
  color = mix(color, u_colors[2], topMask * 0.22);

  // A little highlight from the brighter sampled stops keeps it from going flat.
  color = mix(color, u_colors[4], smoothstep(0.2, 0.65, warped.x) * 0.1);

  // Keep a dark floor for white type, then add a soft vignette for depth.
  color = mix(vec3(0.025, 0.025, 0.035), color, 0.97);
  float vignette = 1.0 - smoothstep(0.2, 0.85, length(uv - 0.5));
  color *= mix(0.85, 1.0, vignette);

  // Fine dither prevents visible bands in the large soft gradients.
  float grain = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  color += (grain - 0.5) / 255.0;

  gl_FragColor = vec4(color, 1.0);
}
`

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader
  console.error('[ArtworkGradient] shader compile failed:', gl.getShaderInfoLog(shader))
  gl.deleteShader(shader)
  return null
}

function createProgram(gl: WebGLRenderingContext): WebGLProgram | null {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
  if (!vertex || !fragment) return null
  const program = gl.createProgram()
  if (!program) return null
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (gl.getProgramParameter(program, gl.LINK_STATUS)) return program
  console.error('[ArtworkGradient] program link failed:', gl.getProgramInfoLog(program))
  gl.deleteProgram(program)
  return null
}

export function ArtworkGradient({ colors, className }: ArtworkGradientProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const palette = preparePalette(colors)

    const webgl = canvas.getContext('webgl', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'low-power',
    })

    if (webgl) {
      const program = createProgram(webgl)
      if (program) {
        const width = 512
        const height = 288
        canvas.width = width
        canvas.height = height
        webgl.viewport(0, 0, width, height)
        webgl.useProgram(program)

        const buffer = webgl.createBuffer()
        webgl.bindBuffer(webgl.ARRAY_BUFFER, buffer)
        webgl.bufferData(
          webgl.ARRAY_BUFFER,
          new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
          webgl.STATIC_DRAW,
        )
        const position = webgl.getAttribLocation(program, 'a_position')
        webgl.enableVertexAttribArray(position)
        webgl.vertexAttribPointer(position, 2, webgl.FLOAT, false, 0, 0)

        const timeLocation = webgl.getUniformLocation(program, 'u_time')
        const resolutionLocation = webgl.getUniformLocation(program, 'u_resolution')
        const colorsLocation = webgl.getUniformLocation(program, 'u_colors')
        const colorValues = new Float32Array(18)
        palette.slice(0, 6).forEach(([r, g, b], index) => {
          colorValues[index * 3] = r / 255
          colorValues[index * 3 + 1] = g / 255
          colorValues[index * 3 + 2] = b / 255
        })
        webgl.uniform2f(resolutionLocation, width, height)
        webgl.uniform3fv(colorsLocation, colorValues)

        const reducedMotion = window.matchMedia(
          '(prefers-reduced-motion: reduce)',
        ).matches
        const startedAt = performance.now()
        let frame = 0
        let last = 0

        const render = (timestamp: number) => {
          frame = window.requestAnimationFrame(render)
          if (timestamp - last < 33) return
          last = timestamp
          if (timeLocation) {
            webgl.uniform1f(timeLocation, (timestamp - startedAt) / 1000)
          }
          webgl.drawArrays(webgl.TRIANGLE_STRIP, 0, 4)
        }

        const drawStatic = () => {
          if (timeLocation) webgl.uniform1f(timeLocation, 0)
          webgl.drawArrays(webgl.TRIANGLE_STRIP, 0, 4)
        }

        drawStatic()
        if (!reducedMotion) frame = window.requestAnimationFrame(render)

        return () => {
          window.cancelAnimationFrame(frame)
          webgl.deleteBuffer(buffer)
          webgl.deleteProgram(program)
        }
      }
    }

    // WebGL unavailable: fall back to a small Canvas 2D mesh. It is less fluid
    // than the shader but still animates instead of showing a static gradient.
    const context = canvas.getContext('2d')
    if (!context) return
    const width = 256
    const height = 144
    canvas.width = width
    canvas.height = height
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let frame = 0
    let last = 0

    const draw = (seconds: number) => {
      context.globalCompositeOperation = 'source-over'
      context.fillStyle = '#101014'
      context.fillRect(0, 0, width, height)
      context.globalCompositeOperation = 'lighter'
      for (let index = 0; index < palette.length; index += 1) {
        const [r, g, b] = palette[index]
        const phase = (index / Math.max(1, palette.length)) * Math.PI * 2
        const x = width * (0.5 + Math.sin(seconds * 0.18 + phase) * 0.38)
        const y = height * (0.5 + Math.cos(seconds * 0.14 + phase * 1.3) * 0.34)
        const radius = Math.hypot(width, height) * (0.5 + Math.sin(seconds * 0.11 + index) * 0.08)
        const gradient = context.createRadialGradient(x, y, 0, x, y, radius)
        gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.62)`)
        gradient.addColorStop(0.55, `rgba(${r}, ${g}, ${b}, 0.32)`)
        gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`)
        context.fillStyle = gradient
        context.fillRect(0, 0, width, height)
      }
    }

    const animate = (timestamp: number) => {
      frame = window.requestAnimationFrame(animate)
      if (timestamp - last < 33) return
      last = timestamp
      draw(timestamp / 1000)
    }

    draw(0)
    if (!reducedMotion) frame = window.requestAnimationFrame(animate)

    return () => window.cancelAnimationFrame(frame)
  }, [colors])

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />
}
