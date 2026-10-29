import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright-core'

const root = resolve(import.meta.dirname, '..')
const SIZE = 1024

/**
 * macOS Big Sur-style squircle. The app icon uses the 824px grid with a 100px
 * safe margin; the tray/favicon variant uses a near-full-bleed body so the
 * note stays legible at 16–32px.
 */
function squirclePath(canvas = SIZE, margin = 100, exponent = 4.8, steps = 240) {
  const center = canvas / 2
  const radius = (canvas - margin * 2) / 2
  const points = []
  for (let index = 0; index < steps; index += 1) {
    const angle = (index / steps) * Math.PI * 2
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const x =
      center + radius * Math.sign(cos) * Math.abs(cos) ** (2 / exponent)
    const y =
      center + radius * Math.sign(sin) * Math.abs(sin) ** (2 / exponent)
    points.push(`${index === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`)
  }
  return `${points.join(' ')} Z`
}

function makeSvg({ margin, shadow }) {
  const body = squirclePath(SIZE, margin)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#FF9276"/>
      <stop offset="0.45" stop-color="#FF5E8A"/>
      <stop offset="0.75" stop-color="#C64BE0"/>
      <stop offset="1" stop-color="#7C4DFF"/>
    </linearGradient>
    <radialGradient id="sheen" cx="0.3" cy="0.12" r="0.8">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.22"/>
      <stop offset="0.55" stop-color="#FFFFFF" stop-opacity="0.05"/>
      <stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="note" x1="0" y1="0" x2="0.25" y2="1">
      <stop offset="0" stop-color="#FFFFFF"/>
      <stop offset="1" stop-color="#FFF0F6"/>
    </linearGradient>
    <filter id="body-shadow" x="-20%" y="-18%" width="140%" height="150%">
      <feDropShadow dx="0" dy="18" stdDeviation="24" flood-color="#2A0E3F" flood-opacity="0.18"/>
    </filter>
    <filter id="note-shadow" x="-30%" y="-30%" width="160%" height="170%">
      <feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#3A0B2E" flood-opacity="0.18"/>
    </filter>
  </defs>

  <g${shadow ? ' filter="url(#body-shadow)"' : ''}>
    <path d="${body}" fill="url(#bg)"/>
    <path d="${body}" fill="url(#sheen)"/>
    <path d="${body}" fill="none" stroke="#FFFFFF" stroke-opacity="0.16" stroke-width="2"/>
  </g>

  <g fill="url(#note)" transform="translate(-60 20)"${shadow ? ' filter="url(#note-shadow)"' : ''}>
    <ellipse cx="330" cy="735" rx="112" ry="88" transform="rotate(-24 330 735)"/>
    <ellipse cx="705" cy="640" rx="112" ry="88" transform="rotate(-24 705 640)"/>
    <rect x="412" y="352" width="38" height="382" rx="19"/>
    <rect x="787" y="257" width="38" height="382" rx="19"/>
    <path d="M412 352 L825 257 L825 352 L412 447 Z"/>
  </g>
</svg>
`
}

const appSvg = makeSvg({ margin: 100, shadow: true })
const traySvg = makeSvg({ margin: 8, shadow: false })

/**
 * macOS menu-bar template image: black glyph + alpha only. AppKit tints it
 * automatically for light/dark menu bars, so no background or colour is baked
 * into the asset. The mark is simplified because it renders at 16–18pt.
 */
const templateSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <g fill="#000">
    <ellipse cx="10" cy="24" rx="4.2" ry="3.3" transform="rotate(-20 10 24)"/>
    <ellipse cx="23" cy="21" rx="4.2" ry="3.3" transform="rotate(-20 23 21)"/>
    <rect x="13" y="9" width="1.6" height="14" rx="0.8"/>
    <rect x="26" y="6" width="1.6" height="14" rx="0.8"/>
    <path d="M13 9 L27.6 6 L27.6 10 L13 13 Z"/>
  </g>
</svg>`

writeFileSync(join(root, 'public/icon.svg'), appSvg, 'utf8')
writeFileSync(join(root, 'assets/icon.svg'), appSvg, 'utf8')

// Icon Composer-compatible source layers for macOS 26: the squircle background
// and the note are kept separate so each can be extruded/glass-tinted in the
// macOS-only Icon Composer tool.
const noteGroup = appSvg.match(/  <g fill="url\(#note\)"[\s\S]*?  <\/g>/)?.[0]
if (noteGroup) {
  const layersDir = join(root, 'assets/app-icon-layers')
  mkdirSync(layersDir, { recursive: true })
  writeFileSync(
    join(layersDir, 'background.svg'),
    appSvg.replace(noteGroup, ''),
    'utf8',
  )
  writeFileSync(
    join(layersDir, 'note.svg'),
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <defs>
    <linearGradient id="note" x1="0" y1="0" x2="0.25" y2="1">
      <stop offset="0" stop-color="#FFFFFF"/>
      <stop offset="1" stop-color="#FFF0F6"/>
    </linearGradient>
    <filter id="note-shadow" x="-30%" y="-30%" width="160%" height="170%">
      <feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#3A0B2E" flood-opacity="0.18"/>
    </filter>
  </defs>
${noteGroup}
</svg>
`,
    'utf8',
  )
}

const executablePath =
  process.env.CHROME_PATH ||
  (process.platform === 'win32'
    ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
    : undefined)

const browser = await chromium.launch({ executablePath, headless: true })
const page = await browser.newPage({ deviceScaleFactor: 1 })

const pngAt = async (svg, size) => {
  const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}img{display:block}</style><img src="${dataUrl}" width="${size}" height="${size}">`,
  )
  return page.screenshot({
    omitBackground: true,
    clip: { x: 0, y: 0, width: size, height: size },
  })
}

const appPng = {}
for (const size of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) {
  appPng[size] = await pngAt(appSvg, size)
}
const trayPng = {}
for (const size of [16, 24, 32, 48, 256]) {
  trayPng[size] = await pngAt(traySvg, size)
}
const templatePng16 = await pngAt(templateSvg, 16)
const templatePng32 = await pngAt(templateSvg, 32)
await browser.close()

writeFileSync(join(root, 'assets/app-icon.png'), appPng[1024])
writeFileSync(join(root, 'assets/tray-icon.png'), trayPng[32])
writeFileSync(join(root, 'assets/tray-icon-template.png'), templatePng16)
writeFileSync(join(root, 'assets/tray-icon-template@2x.png'), templatePng32)

/** PNG-compressed ICO: supported by Windows Vista and later. */
function buildIco(png, sizes) {
  const images = sizes.map((size) => ({ size, data: png[size] }))
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  const directory = Buffer.alloc(16 * images.length)
  let offset = header.length + directory.length
  images.forEach(({ size, data }, index) => {
    const entry = index * 16
    directory.writeUInt8(size >= 256 ? 0 : size, entry)
    directory.writeUInt8(size >= 256 ? 0 : size, entry + 1)
    directory.writeUInt8(0, entry + 2)
    directory.writeUInt8(0, entry + 3)
    directory.writeUInt16LE(1, entry + 4)
    directory.writeUInt16LE(32, entry + 6)
    directory.writeUInt32LE(data.length, entry + 8)
    directory.writeUInt32LE(offset, entry + 12)
    offset += data.length
  })
  return Buffer.concat([header, directory, ...images.map(({ data }) => data)])
}

/** macOS ICNS with PNG payloads (10.7+). */
function buildIcns(png) {
  const chunks = [
    ['icp4', 16],
    ['icp5', 32],
    ['icp6', 64],
    ['ic07', 128],
    ['ic08', 256],
    ['ic09', 512],
    ['ic10', 1024],
  ].map(([type, size]) => {
    const data = png[size]
    const chunk = Buffer.alloc(8)
    chunk.write(type, 0, 4, 'ascii')
    chunk.writeUInt32BE(data.length + 8, 4)
    return Buffer.concat([chunk, data])
  })
  const total = 8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const header = Buffer.alloc(8)
  header.write('icns', 0, 4, 'ascii')
  header.writeUInt32BE(total, 4)
  return Buffer.concat([header, ...chunks])
}

writeFileSync(
  join(root, 'assets/app-icon.ico'),
  buildIco(appPng, [16, 24, 32, 48, 64, 128, 256]),
)
writeFileSync(join(root, 'assets/app-icon.icns'), buildIcns(appPng))
writeFileSync(
  join(root, 'public/favicon.ico'),
  buildIco(trayPng, [16, 32, 48, 256]),
)

console.log(
  'generated app-icon.png / app-icon.ico / app-icon.icns / tray icons / template tray / favicon',
)
