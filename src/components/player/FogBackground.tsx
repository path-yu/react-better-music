import { useEffect, useRef, useState, type ReactNode } from 'react'
import { clamp, hexToRgb, hslToHex, rgbToHsl } from '../../lib/color'
import { cn } from '../../lib/format'

const VERTEX_SHADER = `
attribute vec2 a_position;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`

const FRAGMENT_SHADER = `
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_bass;
uniform vec3 u_deep;
uniform vec3 u_fog;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 5; i++) {
    value += amplitude * noise(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    amplitude *= 0.5;
  }
  return value;
}

void main() {
  vec2 pos = vec2(gl_FragCoord.x, u_resolution.y - gl_FragCoord.y);
  vec2 uv = pos / u_resolution;
  vec2 p = pos / u_resolution.y * 2.4;
  float t = u_time;
  vec2 rise = vec2(0.0, t * 0.1);

  float qx = fbm(p + rise + vec2(0.0, t * 0.04));
  float qy = fbm(p + rise + vec2(5.2, 1.3) - vec2(t * 0.05, 0.0));
  float f = fbm(p + rise + 0.9 * vec2(qx, qy));
  float bank = fbm(p * 0.45 + rise * 0.6 + vec2(3.7, 0.0));

  float cloud = smoothstep(0.3 - 0.06 * u_bass, 0.78, f)
    * (0.45 + 0.75 * smoothstep(0.3, 0.65, bank));
  float mask = smoothstep(-0.1, 0.4, uv.y)
    * (1.0 - 0.5 * smoothstep(0.65, 1.0, uv.y));
  vec3 color = mix(u_deep, u_fog, min(cloud * mask * (0.85 + 0.35 * u_bass), 1.0));

  float glow = length((uv - vec2(0.5, 0.42)) * vec2(1.0, 1.25));
  color *= 1.08 - 0.45 * smoothstep(0.2, 0.85, glow);

  float cell = u_resolution.y / 22.0;
  vec2 samplePos = (pos + vec2(0.0, t * cell * 0.9)) / cell;
  vec2 id = floor(samplePos);
  float h = hash(id + vec2(3.1, 7.7));
  if (h > 0.93) {
    vec2 at = vec2(hash(id + vec2(1.3, 2.9)), hash(id + vec2(8.1, 4.3))) * 0.8 + 0.1;
    float d = length((fract(samplePos) - at) * cell) / max(cell * 0.05, 0.7);
    float glint = 0.5 + 0.5 * sin(t * (1.5 + 2.0 * h) + h * 40.0);
    color += vec3(0.75, 0.82, 1.0) * exp(-d * d) * glint * (0.25 + 0.3 * mask);
  }

  gl_FragColor = vec4(color, 1.0);
}
`

interface FogBackgroundProps {
  /** Main cover colour used for the fog palette. */
  tint?: string
  playing: boolean
  fallback: ReactNode
  className?: string
}

function safeTint(value?: string) {
  return value && /^#[0-9a-f]{3,8}$/i.test(value) ? value : '#232325'
}

function fogColors(tint?: string) {
  const { r, g, b } = hexToRgb(safeTint(tint))
  const { h, s } = rgbToHsl(r, g, b)
  const saturation = s > 0.12 ? clamp(s * 1.3, 0.6, 0.85) : s
  return {
    deep: hslToHex(h, saturation, 0.16),
    fog: hslToHex(h, saturation * 0.6, 0.56),
  }
}

function vec3(hex: string) {
  const { r, g, b } = hexToRgb(hex)
  return [r / 255, g / 255, b / 255] as const
}

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
) {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn('Fog shader failed:', gl.getShaderInfoLog(shader))
    gl.deleteShader(shader)
    return null
  }
  return shader
}

/**
 * WebGL interpretation of the native player's fog backdrop: five octaves of
 * warped noise rising slowly over a deep cover-coloured wash, with sparse
 * glints. It paints at half resolution and 30fps while playing, then settles
 * to a still frame when paused. The caller supplies the CSS fallback for
 * devices without WebGL or with reduced motion preferences.
 */
export function FogBackground({
  tint,
  playing,
  fallback,
  className,
}: FogBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [failed, setFailed] = useState(false)
  const playingRef = useRef(playing)
  const tintRef = useRef(tint)
  const kickRef = useRef<() => void>(() => undefined)

  playingRef.current = playing
  tintRef.current = tint

  useEffect(() => {
    kickRef.current()
  }, [playing, tint])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const gl = canvas.getContext('webgl', {
      alpha: false,
      antialias: false,
      depth: false,
      powerPreference: 'high-performance',
    })
    if (!gl) {
      setFailed(true)
      return
    }

    const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
    const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
    const program = gl.createProgram()
    if (!vertexShader || !fragmentShader || !program) {
      setFailed(true)
      return
    }
    gl.attachShader(program, vertexShader)
    gl.attachShader(program, fragmentShader)
    gl.linkProgram(program)
    gl.deleteShader(vertexShader)
    gl.deleteShader(fragmentShader)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn('Fog program failed:', gl.getProgramInfoLog(program))
      setFailed(true)
      return
    }

    gl.useProgram(program)
    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    )
    const position = gl.getAttribLocation(program, 'a_position')
    gl.enableVertexAttribArray(position)
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)

    const resolution = gl.getUniformLocation(program, 'u_resolution')
    const time = gl.getUniformLocation(program, 'u_time')
    const bass = gl.getUniformLocation(program, 'u_bass')
    const deep = gl.getUniformLocation(program, 'u_deep')
    const fog = gl.getUniformLocation(program, 'u_fog')

    const reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    )
    let disposed = false
    let raf = 0
    let last = performance.now()
    let lastDraw = 0
    let drift = 0
    let speed = 0
    let width = 1
    let height = 1

    const setColors = () => {
      const colors = fogColors(tintRef.current)
      gl.uniform3fv(deep, vec3(colors.deep))
      gl.uniform3fv(fog, vec3(colors.fog))
    }

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      const scale = Math.min(window.devicePixelRatio || 1, 1.5) * 0.55
      width = Math.max(1, Math.floor(rect.width * scale))
      height = Math.max(1, Math.floor(rect.height * scale))
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
        gl.viewport(0, 0, width, height)
        gl.uniform2f(resolution, width, height)
        kick()
      }
    }

    const draw = (now: number) => {
      setColors()
      gl.uniform1f(time, drift)
      gl.uniform1f(
        bass,
        playingRef.current
          ? 0.35 + 0.25 * (0.5 + 0.5 * Math.sin(now * 0.0018))
          : 0,
      )
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }

    const frame = (now: number) => {
      raf = 0
      if (disposed) return
      const target = playingRef.current && !reducedMotion.matches ? 1 : 0
      const dt = Math.min((now - last) / 1000, 0.1)
      last = now
      speed += (target - speed) * Math.min(1, 2.5 * dt)
      if (Math.abs(target - speed) < 0.005) speed = target
      drift += speed * dt
      if (now - lastDraw >= 33) {
        draw(now)
        lastDraw = now
      }
      if (speed > 0.003) raf = window.requestAnimationFrame(frame)
    }

    const kick = () => {
      if (disposed) return
      last = performance.now()
      setColors()
      gl.uniform1f(time, drift)
      gl.uniform1f(bass, 0)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      if (
        (playingRef.current || speed > 0.003) &&
        !reducedMotion.matches &&
        !raf
      ) {
        raf = window.requestAnimationFrame(frame)
      }
    }

    kickRef.current = kick
    setColors()
    gl.uniform2f(resolution, 1, 1)
    gl.uniform1f(bass, 0)
    gl.clearColor(0.08, 0.07, 0.1, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    resize()

    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    const onReducedMotion = () => kick()
    reducedMotion.addEventListener('change', onReducedMotion)

    const onContextLost = (event: Event) => {
      event.preventDefault()
      setFailed(true)
    }
    canvas.addEventListener('webglcontextlost', onContextLost)

    return () => {
      disposed = true
      kickRef.current = () => undefined
      window.cancelAnimationFrame(raf)
      observer.disconnect()
      reducedMotion.removeEventListener('change', onReducedMotion)
      canvas.removeEventListener('webglcontextlost', onContextLost)
    }
  }, [])

  if (failed) return <>{fallback}</>

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={cn('absolute inset-0 h-full w-full', className)}
    />
  )
}
