#!/usr/bin/env node
/**
 * Publish the Hutch update artifacts to a GitHub Release.
 *
 * Usage:
 *   pnpm desktop:publish-update [--tag v1.1.1]
 *
 * The update manifest is uploaded last so clients never see a release whose
 * archive or checksum is still missing.
 */
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs'
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

// GitHub strips non-ASCII characters from uploaded asset names. Hutch derives
// the tar name from the Chinese app name, so normalize it and keep the manifest
// in sync before uploading. Otherwise update.json points at a 404.
function asciiArtifactName(name) {
  if (/^[\x20-\x7e]+$/.test(name)) return name
  if (name.endsWith('.tar.zst')) return 'stable-win-x64-app.tar.zst'
  if (name.endsWith('-Setup.zip')) return 'win-x64-Setup.zip'
  if (name.endsWith('.exe')) return 'Shengyu-Setup.exe'
  return name
    .replace(/[^\x20-\x7e]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

const manifestData = JSON.parse(readFileSync(manifest, 'utf8'))
const artifactName = manifestData?.artifact?.file
if (artifactName && !/^[\x20-\x7e]+$/.test(artifactName)) {
  const source = join(artifacts, artifactName)
  const target = join(artifacts, asciiArtifactName(artifactName))
  if (existsSync(source) && source !== target) {
    renameSync(source, target)
  }
  if (existsSync(target)) {
    manifestData.artifact.file = basename(target)
    writeFileSync(manifest, JSON.stringify(manifestData), 'utf8')
    console.log(`› 更新包已重命名为 ${basename(target)}`)
  }
}

for (const name of readdirSync(artifacts)) {
  const targetName = asciiArtifactName(name)
  if (targetName !== name) {
    const source = join(artifacts, name)
    const target = join(artifacts, targetName)
    renameSync(source, target)
    console.log(`› 资产已重命名为 ${targetName}`)
  }
}

// In-app updates download the Inno installer described by this manifest.
const installerManifest = join(artifacts, 'win-x64-Setup-Custom.json')
const installerExe = join(artifacts, 'win-x64-Setup-Custom.exe')
if (!existsSync(installerManifest) || !existsSync(installerExe)) {
  console.error('✗ 未找到 win-x64-Setup-Custom.exe / .json，请先运行 pnpm desktop:installer')
  process.exit(1)
}

const files = readdirSync(artifacts)
  .filter(
    (name) =>
      !name.endsWith('-update.json') && name !== basename(installerManifest),
  )
  .sort()
  .map((name) => join(artifacts, name))

const ghExe = findGh()
if (!ghExe) {
  console.error('✗ 未找到 GitHub CLI，请先安装并登录：')
  console.error('  winget install --id GitHub.cli')
  console.error('  gh auth login')
  process.exit(1)
}

const gh = (args) =>
  runGh(ghExe, args, {
    cwd: root,
  })

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
