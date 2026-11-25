#!/usr/bin/env node
/**
 * Guided desktop release: version + notes → build → GitHub Release.
 *
 * Usage:
 *   pnpm desktop:release:auto
 */
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { stdin as input, stdout as output } from 'node:process'
import { findGh, runGh } from './lib/gh.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const configPath = join(root, 'electrobun.config.ts')
const notesPath = join(root, '.release-notes.md')
const repo = 'path-yu/react-better-music'
let rl = createInterface({ input, output })

/**
 * readline rejects when stdin ends before an answer (pipes, CI, `echo | node`).
 * Surface that as a normal abort instead of an ERR_USE_AFTER_CLOSE stack.
 */
async function ask(prompt) {
  try {
    return await rl.question(prompt)
  } catch {
    console.error('\n✗ 输入已结束（stdin closed），发布流程中止')
    process.exit(1)
  }
}

const currentConfig = readFileSync(configPath, 'utf8')
const currentVersion =
  currentConfig.match(/version:\s*['"]([^'"]+)['"]/)?.[1] ?? '0.0.0'

function parseVersion(value) {
  // Older tags in this repository use two components (`1.5`). Normalise them
  // to semver instead of silently falling back to 1.0.0.
  const match = String(value)
    .trim()
    .match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/)
  if (!match) return null
  return [
    Number(match[1]),
    Number(match[2] ?? 0),
    Number(match[3] ?? 0),
  ]
}

function normalizeVersion(value) {
  const parts = parseVersion(value)
  return parts ? parts.join('.') : null
}

function compareVersion(a, b) {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (!left || !right) return 0
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index]
  }
  return 0
}

function suggestedVersion(latest) {
  const parts = parseVersion(latest)
  if (!parts) return '1.0.0'
  return `${parts[0]}.${parts[1] + 1}.0`
}

function pnpm(args) {
  const cli = process.env.npm_execpath
  if (cli && /\.(c|m)?js$/.test(cli)) {
    return spawnSync(process.execPath, [cli, ...args], {
      cwd: root,
      stdio: 'inherit',
      env: process.env,
    })
  }
  return spawnSync('pnpm', args, {
    cwd: root,
    stdio: 'inherit',
    shell: true,
    env: process.env,
  })
}

const ghExe = findGh()
function gh(args, options = {}) {
  return runGh(ghExe, args, {
    cwd: root,
    ...options,
  })
}

async function fetchLatestVersion() {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${repo}/releases/latest`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'qimiao-release-script',
        },
      },
    )
    if (!response.ok) return null
    const data = await response.json()
    return typeof data.tag_name === 'string' ? data.tag_name : null
  } catch {
    return null
  }
}

let ghReady = false
if (!ghExe) {
  console.error('✗ 未找到 GitHub CLI，请先安装：')
  console.error('  winget install --id GitHub.cli')
} else {
  try {
    runGh(ghExe, ['auth', 'status'], { stdio: 'ignore' })
    ghReady = true
  } catch {
    console.log('GitHub CLI 尚未登录。')
    const answer = await ask('现在运行 gh auth login 吗？(Y/n) ')
    if (!answer.trim() || /^y(es)?$/i.test(answer.trim())) {
      // gh auth login is interactive and needs the terminal's stdin. The active
      // readline interface would otherwise consume the "Press Enter" keypress,
      // leaving gh waiting forever after the browser says it is connected.
      rl.close()
      gh(['auth', 'login'])
      rl = createInterface({ input, output })
      try {
        runGh(ghExe, ['auth', 'status'], { stdio: 'ignore' })
        ghReady = true
      } catch {
        console.error('✗ GitHub CLI 仍未登录')
      }
    }
  }
}

if (!ghReady) {
  console.error('✗ 无法检查或发布 GitHub Release，已退出。')
  rl.close()
  process.exit(1)
}

const latestRemote = await fetchLatestVersion()
const baseVersion =
  latestRemote && compareVersion(latestRemote, currentVersion) > 0
    ? latestRemote.replace(/^v/, '')
    : currentVersion

console.log('')
console.log(`本地版本：${currentVersion}`)
console.log(`远端最新：${latestRemote ?? '未获取到'}`)
console.log(`建议版本：${suggestedVersion(baseVersion)}`)
console.log('')

const versionInput = (
  await ask(`新版本号 [${suggestedVersion(baseVersion)}]: `)
).trim()
const version =
  normalizeVersion(versionInput || suggestedVersion(baseVersion)) ?? ''

if (!version) {
  console.error('✗ 版本号必须是 semver，例如 1.6.0')
  rl.close()
  process.exit(1)
}
if (compareVersion(version, baseVersion) <= 0) {
  console.error(`✗ 新版本必须高于 ${baseVersion}`)
  rl.close()
  process.exit(1)
}

const tag = `v${version}`
try {
  gh(['release', 'view', tag], { stdio: 'ignore' })
  console.error(`✗ Release ${tag} 已存在，请换一个版本号`)
  rl.close()
  process.exit(1)
} catch {
  // Expected: a new tag has no release yet.
}

const notesArgIndex = process.argv.indexOf('--notes-file')
const notesArg =
  notesArgIndex >= 0 && process.argv[notesArgIndex + 1]
    ? resolve(root, process.argv[notesArgIndex + 1])
    : null

/**
 * Chinese Windows consoles default to code page 936: Chinese typed into
 * readline arrives as GBK bytes that Node decodes as UTF-8, so the notes turn
 * into mojibake like "鏂板". Publishing that is worse than failing, so bail out
 * and point at the two ways to fix the input.
 */
const looksGarbled = (text) => /[鏂鍒涓锛銆鍜璇鐨鏄]/.test(text)

let notes = []
if (notesArg) {
  if (!existsSync(notesArg)) {
    console.error(`✗ 未找到说明文件：${notesArg}`)
    rl.close()
    process.exit(1)
  }
  notes = readFileSync(notesArg, 'utf8')
    .split('\n')
    .map((line) => line.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean)
  if (!notes.length) {
    console.error('✗ 说明文件是空的')
    rl.close()
    process.exit(1)
  }
  if (notes.some(looksGarbled)) {
    console.error(`✗ 说明文件里出现中文乱码：${notesArg}`)
    console.error('  请用 UTF-8 编码重新保存该文件后再试')
    rl.close()
    process.exit(1)
  }
  console.log('')
  console.log(`› 使用说明文件：${notesArg}`)
} else {
  console.log('')
  console.log('请输入更新内容（每行一条，空行结束）：')
  console.log(
    '提示：中文请先在终端执行 chcp 65001，或改用 --notes-file 指定说明文件。',
  )
  while (true) {
    const line = await ask('> ')
    if (!line.trim()) {
      if (notes.length) break
      continue
    }
    if (looksGarbled(line)) {
      console.error('')
      console.error('✗ 更新内容出现中文乱码：当前控制台不是 UTF-8 编码。')
      console.error('  方式一：执行 chcp 65001 后重新运行')
      console.error(
        '  方式二：把说明写成 markdown 文件，再运行 pnpm desktop:release:auto --notes-file 说明.md',
      )
      rl.close()
      process.exit(1)
    }
    notes.push(line.trim())
  }
}

writeFileSync(
  notesPath,
  notes.map((line) => `- ${line}`).join('\n') + '\n',
  'utf8',
)

console.log('')
console.log(`版本：${version}`)
console.log(`标签：${tag}`)
console.log('更新内容：')
console.log(readFileSync(notesPath, 'utf8').trim())
const answer = await ask('确认构建并发布？(Y/n) ')
rl.close()
const confirmed = !answer.trim() || /^y(es)?$/i.test(answer.trim())

if (!confirmed) {
  rmSync(notesPath, { force: true })
  console.log('已取消')
  process.exit(0)
}

const nextConfig = currentConfig.replace(
  /(version:\s*['"])[^'"]+(['"])/,
  `$1${version}$2`,
)
writeFileSync(configPath, nextConfig, 'utf8')
console.log(`\n› 已更新 electrobun.config.ts → ${version}`)

const build = pnpm(['desktop:release'])
if (build.status !== 0) {
  writeFileSync(configPath, currentConfig, 'utf8')
  rmSync(notesPath, { force: true })
  console.error('\n✗ 构建失败，已恢复原版本号')
  process.exit(build.status ?? 1)
}

const publish = spawnSync(
  process.execPath,
  [
    join(root, 'scripts', 'publish-update.mjs'),
    '--tag',
    tag,
    '--notes-file',
    notesPath,
  ],
  {
    cwd: root,
    stdio: 'inherit',
  },
)

if (publish.status !== 0) {
  console.error('\n✗ 构建已完成，但 GitHub Release 发布失败')
  console.error(`  版本号已保留为 ${version}`)
  console.error(
    `  修复后重试：pnpm desktop:publish-update --tag ${tag} --notes-file .release-notes.md`,
  )
  process.exit(publish.status ?? 1)
}

rmSync(notesPath, { force: true })
console.log(`\n✓ 已发布 ${tag}`)
console.log('现在可以在设置 → 桌面 → 检查更新中测试。')
