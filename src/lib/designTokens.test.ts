import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Design-token guard. DESIGN.md defines the scales; this keeps the code on
 * them. Every failure lists `file:line value` so the fix is obvious: snap to
 * the scale, use an ink / semantic token, or add a dark mapping.
 */
const SRC = fileURLToPath(new URL('..', import.meta.url))

const FONT_SIZES = new Set([11, 12, 13, 15, 19, 21, 24, 28, 32, 84, 210])
const RADII = new Set([6, 10, 14, 18, 22, 28])

const FONT = /text-\[(\d+(?:\.\d+)?)px\]/g
const RADIUS = /rounded(?:-[a-z]{1,2})?-\[(\d+(?:\.\d+)?)px\]/g
const NAMED_RADIUS =
  /(?<![A-Za-z0-9_\-[/:.])(?:[a-z-]+:)*rounded(?:-(?:xs|sm|lg|xl|2xl|3xl))?(?=[\s'"`])(?!\s*=)/g
const TEXT_BLACK =
  /(?<![A-Za-z0-9_\-[/:.])((?:[a-z-]+:)*)text-black(?:\/[A-Za-z0-9_.[\]]+)?(?![A-Za-z0-9_\-/])/g
const SEMANTIC_HEX = /-\[#(?:ff2d55|ff9500|b36b00|d70015|ff3b30|ff6961)\]/gi
const SURFACE =
  /(?<![A-Za-z0-9_\-[/:.])((?:[a-z-]+:)*)((?:bg|border|divide)-(?:black|white)\/(?:\d+|\[[\d.]+\])|bg-\[#[ef][0-9a-f]{5}\](?:\/\d+)?)(?![A-Za-z0-9_\-/\]])/gi

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      // Catalogs are data; bun/ holds standalone HTML for the desktop HUDs.
      if (name !== 'locales' && name !== 'bun') out.push(...sourceFiles(path))
    } else if (
      /\.tsx?$/.test(name) &&
      !/\.(test|d)\.ts$/.test(name) &&
      name !== 'routeTree.gen.ts'
    ) {
      out.push(path)
    }
  }
  return out
}

type Line = { where: string; text: string }

const LINES: Line[] = sourceFiles(SRC).flatMap((file) =>
  readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((text, index) => ({
      where: `${relative(SRC, file).replace(/\\/g, '/')}:${index + 1}`,
      text,
    }))
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line.text)),
)

function collect(pattern: RegExp, keep: (match: RegExpMatchArray) => boolean) {
  const found: string[] = []
  for (const line of LINES) {
    for (const match of line.text.matchAll(pattern)) {
      if (keep(match)) found.push(`${line.where} ${match[0]}`)
    }
  }
  return found
}

/** Classes that look the same in both themes need no dark mapping. */
function isLightOnlySurface(util: string) {
  const match = /^(bg|border|divide)-(black|white)\/(?:(\d+)|\[([\d.]+)\])$/i.exec(util)
  if (!match) return /^bg-\[#/i.test(util)
  const value = match[3] ? Number(match[3]) / 100 : Number(match[4])
  // Translucent white on the always-dark player, heavy black scrims on art.
  if (match[2] === 'white') return match[1] === 'bg' && value >= 0.5
  if (match[1] === 'bg') return value <= 0.12
  return true
}

describe('design tokens', () => {
  it('uses the type scale', () => {
    expect(collect(FONT, (m) => !FONT_SIZES.has(Number(m[1])))).toEqual([])
  })

  it('uses the radius scale', () => {
    expect([
      ...collect(RADIUS, (m) => !RADII.has(Number(m[1]))),
      ...collect(NAMED_RADIUS, () => true),
    ]).toEqual([])
  })

  it('uses ink and semantic colour tokens', () => {
    expect([
      ...collect(TEXT_BLACK, (m) => !m[1].includes('dark:')),
      ...collect(SEMANTIC_HEX, () => true),
    ]).toEqual([])
  })

  it('maps every light-only surface class for the dark theme', () => {
    const css = readFileSync(join(SRC, 'styles.css'), 'utf8')
    const mapped = new Set(
      [...css.matchAll(/\[class~=["']([^"']+)["']\]/g)].map((m) => m[1]),
    )
    const missing: string[] = []
    for (const line of LINES) {
      // A `dark:` variant on the element handles the dark theme itself.
      if (line.text.includes('dark:')) continue
      for (const match of line.text.matchAll(SURFACE)) {
        const key = match[1] + match[2]
        if (isLightOnlySurface(match[2]) && !mapped.has(key)) {
          missing.push(`${line.where} ${key}`)
        }
      }
    }
    expect(missing).toEqual([])
  })

  it('imports the prebuilt darwin-ui Tailwind before the app Tailwind', () => {
    // darwin-ui's bare utilities (`hidden`, `grid-cols-2`, `h-7` ...) must come
    // earlier in the utilities layer, or they beat the app's `lg:` / `xl:` /
    // `max-md:` variants.
    const css = readFileSync(join(SRC, 'styles.css'), 'utf8')
    const darwin = css.indexOf('@import "@pikoloo/darwin-ui/styles.css"')
    const tailwind = css.indexOf('@import "tailwindcss"')
    expect(darwin).toBeGreaterThan(-1)
    expect(tailwind).toBeGreaterThan(darwin)
  })

  it('keeps custom circles and pills round under the squircle corners', () => {
    // styles.css gives every element `corner-shape: squircle`, which turns a
    // `border-radius: 999px` pill into a near-square. Each rule that draws a
    // circle or pill must be listed in the `corner-shape: round` exemptions.
    // (Tailwind `rounded-full` is exempted by class and needs nothing.)
    const css = readFileSync(join(SRC, 'styles.css'), 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    )
    const start = css.indexOf('@supports (corner-shape: squircle)')
    expect(start).toBeGreaterThan(-1)
    const exemptions = css
      .slice(start, css.indexOf('@layer base', start))
      .replace(/\s+/g, ' ')
    // Whole-token match, so `.np-tab` is not satisfied by `.np-tabs`.
    const listed = (text: string) => {
      const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      return new RegExp(escaped + '(?![\\w-])').test(exemptions)
    }
    const missing: string[] = []
    for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const radius = /border-radius:\s*([^;]+);/.exec(match[2])?.[1].trim()
      if (!radius || !/^(9{2,}px|50%|100%)$/.test(radius)) continue
      for (const raw of match[1].split(',')) {
        const selector = raw
          .replace(/\s+/g, ' ')
          .trim()
          .replace(/::?(before|after)$/, '')
          .replace(/:(hover|focus-visible|focus|active)\b/g, '')
        if (!selector || selector.includes('scrollbar')) continue
        // `.player-glass .seek-slider__fill` is covered by `.seek-slider__fill`.
        const classes = selector.split(' ').pop()?.match(/\.[\w-]+/g) ?? []
        if (!listed(selector) && !classes.some((name) => listed(name))) {
          missing.push(selector)
        }
      }
    }
    expect([...new Set(missing)]).toEqual([])
  })
})
