#!/usr/bin/env node
/**
 * Measure first-screen timings of the built app in a real Chromium.
 *
 *   pnpm build
 *   pnpm preview --port 4173        # plus `pnpm dev:api` in another terminal
 *   node scripts/measure-fpp.mjs --url http://localhost:4173/ --runs 5
 *
 * Reports FCP, LCP, the React shell commit (`main`), and the first piece of
 * real content (`main img`, i.e. data arrived and a cover rendered).
 * Uses the system Chrome through playwright-core, so no browser download.
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const args = process.argv.slice(2)

// `--desktop` only prints the timings written by the packaged app; no browser.
if (args.includes('--desktop')) {
  const logPath = join(
    process.env.LOCALAPPDATA ?? homedir(),
    'com.qimiao.music',
    'startup.log',
  )
  if (!existsSync(logPath)) {
    console.error(`startup.log not found: ${logPath}`)
    process.exit(1)
  }
  const lines = readFileSync(logPath, 'utf8').trim().split(/\r?\n/).slice(-8)
  console.log(`\nDesktop startup marks (${logPath})\n`)
  for (const line of lines) console.log(line)
  process.exit(0)
}
const readArg = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}

const url = readArg('url', 'http://localhost:4173/')
const runs = Number(readArg('runs', '5'))
const chromePath = readArg('chrome', process.env.CHROME_PATH || '')

const candidates = [
  chromePath,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean)
const executablePath = candidates.find((candidate) => existsSync(candidate))

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--disable-gpu', '--autoplay-policy=no-user-gesture-required'],
})

const results = []
for (let run = 1; run <= runs; run += 1) {
  // A fresh context keeps storage/cache cold enough to compare runs.
  const context = await browser.newContext()
  const page = await context.newPage()

  await page.addInitScript(() => {
    const perf = { shellAt: null, contentAt: null, lcp: 0, longTasks: [], paints: [] }
    window.__fpp = perf

    const check = () => {
      if (perf.shellAt === null && document.querySelector('main')) {
        perf.shellAt = performance.now()
      }
      if (perf.contentAt === null && document.querySelector('main img')) {
        perf.contentAt = performance.now()
      }
    }

    new MutationObserver(check).observe(document, { childList: true, subtree: true })
    document.addEventListener('DOMContentLoaded', check)

    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          perf.paints.push({ name: entry.name, startTime: entry.startTime })
        }
      }).observe({ type: 'paint', buffered: true })
    } catch {
      // paint timing unsupported
    }

    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) perf.lcp = entry.startTime
      }).observe({ type: 'largest-contentful-paint', buffered: true })
    } catch {
      // LCP unsupported
    }

    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) perf.longTasks.push(entry.duration)
      }).observe({ type: 'longtask', buffered: true })
    } catch {
      // long tasks unsupported
    }
  })

  const startedAt = Date.now()
  await page.goto(url, { waitUntil: 'load', timeout: 30_000 })
  try {
    await page.waitForFunction(() => window.__fpp?.contentAt !== null, null, { timeout: 15_000 })
  } catch {
    // Content never appeared (API offline or slow); still report shell/FCP.
  }

  const metrics = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0]
    const paint = (name) =>
      performance.getEntriesByName(name)[0]?.startTime ??
      window.__fpp?.paints.find((entry) => entry.name === name)?.startTime ??
      null
    return {
      fcp: paint('first-contentful-paint'),
      fp: paint('first-paint'),
      lcp: window.__fpp?.lcp || null,
      shellAt: window.__fpp?.shellAt ?? null,
      contentAt: window.__fpp?.contentAt ?? null,
      contentSrc: document.querySelector('main img')?.getAttribute('src')?.slice(0, 100) ?? '',
      domContentLoaded: nav?.domContentLoadedEventEnd ?? null,
      load: nav?.loadEventEnd ?? null,
      longTasks: window.__fpp?.longTasks ?? [],
      scripts: performance
        .getEntriesByType('resource')
        .filter((entry) => entry.name.endsWith('.js'))
        .reduce((sum, entry) => sum + (entry.encodedBodySize || 0), 0),
    }
  })

  results.push({ run, wall: Date.now() - startedAt, ...metrics })
  await context.close()
}

await browser.close()

const median = (values) => {
  const sorted = values.filter((value) => typeof value === 'number').sort((a, b) => a - b)
  if (!sorted.length) return null
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
}

const columns = [
  ['run', (row) => row.run],
  ['FCP', (row) => (row.fcp == null ? '—' : Math.round(row.fcp))],
  ['LCP', (row) => (row.lcp == null ? '—' : Math.round(row.lcp))],
  ['shell', (row) => (row.shellAt == null ? '—' : Math.round(row.shellAt))],
  ['content', (row) => (row.contentAt == null ? '—' : Math.round(row.contentAt))],
  ['DCL', (row) => (row.domContentLoaded == null ? '—' : Math.round(row.domContentLoaded))],
  ['load', (row) => (row.load == null ? '—' : Math.round(row.load))],
  ['js KB', (row) => Math.round(row.scripts / 1024)],
  ['max task', (row) => (row.longTasks.length ? Math.round(Math.max(...row.longTasks)) : '—')],
]

console.log(`\n${url}  (${runs} runs, ms, headless Chrome)\n`)
console.log(columns.map(([name]) => name.padEnd(9)).join(''))
for (const row of results) {
  console.log(columns.map(([, get]) => String(get(row)).padEnd(9)).join(''))
}

const summary = {}
for (const key of ['fcp', 'lcp', 'shellAt', 'contentAt', 'domContentLoaded', 'load']) {
  summary[key] = median(results.map((row) => row[key]))
}
console.log('\nmedian:', JSON.stringify(summary))
