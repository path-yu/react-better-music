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
})
