#!/usr/bin/env node
/**
 * Publish the Hutch update artifacts to a GitHub Release.
 *
 * Usage:
 *   pnpm desktop:publish-update [--tag v1.1.1]
 *
 * Uploads win-x64-Setup-Custom.exe, then its manifest, then
 * stable-win-x64-update.json, so clients never see a manifest whose installer
 * is still missing.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findGh, runGh } from './lib/gh.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const artifacts = join(root, 'artifacts')
const configPath = join(root, 'electrobun.config.ts')

if (!existsSync(artifacts)) {
  console.error('✗ 未找到 artifacts/，请先运行 pnpm desktop:build')
  process.exit(1)
}

const config = readFileSync(configPath, 'utf8')
const version = config.match(/version:\s*['"]([^'"]+)['"]/)?.[1]
if (!version) {
  console.error('✗ 无法从 electrobun.config.ts 读取版本号')
  process.exit(1)
}

const tagIndex = process.argv.indexOf('--tag')
const tag =
  tagIndex >= 0 && process.argv[tagIndex + 1]
    ? process.argv[tagIndex + 1]
    : `v${version}`
const notesIndex = process.argv.indexOf('--notes-file')
const notesFile =
  notesIndex >= 0 && process.argv[notesIndex + 1]
    ? resolve(root, process.argv[notesIndex + 1])
    : null

const manifest = join(artifacts, 'stable-win-x64-update.json')

if (!existsSync(manifest)) {
  console.error('✗ 未找到 stable-win-x64-update.json')
  process.exit(1)
}

// Only the Inno installer and the two manifests are published. Electrobun's
// own Setup.zip and the app.tar.zst / checksum for its built-in Updater are
// not: the app updates by downloading and running the Inno installer
// (src/bun/index.ts). scripts/installer/build.mjs already deletes them; this
// allowlist also keeps stray files out of the release.
// stable-win-x64-update.json is kept: the app reads its version when a
// release has no installer manifest.
const installerManifest = join(artifacts, 'win-x64-Setup-Custom.json')
const installerExe = join(artifacts, 'win-x64-Setup-Custom.exe')
if (!existsSync(installerManifest) || !existsSync(installerExe)) {
  console.error('✗ 未找到 win-x64-Setup-Custom.exe / .json，请先运行 pnpm desktop:installer')
  process.exit(1)
}

const published = new Set([
  basename(installerExe),
  basename(installerManifest),
  basename(manifest),
])
const skipped = readdirSync(artifacts).filter((name) => !published.has(name))
if (skipped.length) {
  console.log(`› 不上传：${skipped.join('、')}`)
}
const files = [installerExe]

const ghExe = findGh()
if (!ghExe) {
  console.error('✗ 未找到 GitHub CLI，请先安装并登录：')
  console.error('  winget install --id GitHub.cli')
  console.error('  gh auth login')
  process.exit(1)
}

const gh = (args) => {
  try {
    return runGh(ghExe, args, { cwd: root })
  } catch (error) {
    // `runGh` inherits stdio, so gh's own message is already on screen; add the
    // retry path so a failed upload never looks like a silent no-op.
    console.error('')
    console.error(`✗ gh ${args.slice(0, 2).join(' ')} 失败（退出码 ${error?.status ?? '?'}）`)
    console.error('  构建产物仍在 artifacts/，无需重新打包，修好后重试：')
    console.error(`  pnpm desktop:publish-update --tag ${tag}`)
    process.exit(error?.status ?? 1)
  }
}

let createdDraft = false
let releaseIsDraft = false
try {
  const raw = execFileSync(
    ghExe,
    ['release', 'view', tag, '--json', 'isDraft'],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  )
  releaseIsDraft = Boolean(JSON.parse(raw).isDraft)
} catch {
  gh([
    'release',
    'create',
    tag,
    '--draft',
    '--title',
    `声屿 ${tag}`,
    ...(notesFile && existsSync(notesFile)
      ? ['--notes-file', notesFile]
      : ['--notes', `声屿 ${tag}`]),
  ])
  createdDraft = true
  releaseIsDraft = true
}

for (const file of files) {
  const size = statSync(file).size
  console.log(
    `↑ ${basename(file)} (${(size / 1024 / 1024).toFixed(1)} MB)`,
  )
  gh(['release', 'upload', tag, file, '--clobber'])
}
// Clients read the manifests first; publish them only after every payload file.
console.log(`↑ ${basename(installerManifest)}`)
gh(['release', 'upload', tag, installerManifest, '--clobber'])
console.log('↑ stable-win-x64-update.json')
gh(['release', 'upload', tag, manifest, '--clobber'])

if (createdDraft || releaseIsDraft) {
  gh(['release', 'edit', tag, '--draft=false'])
}

console.log(`✓ 已发布 ${tag}`)
