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
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

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

const files = readdirSync(artifacts)
  .filter((name) => !name.endsWith('-update.json'))
  .sort()
  .map((name) => join(artifacts, name))
const manifest = join(artifacts, 'stable-win-x64-update.json')

if (!existsSync(manifest)) {
  console.error('✗ 未找到 stable-win-x64-update.json')
  process.exit(1)
}

try {
  execFileSync('gh', ['--version'], { stdio: 'ignore' })
} catch {
  console.error('✗ 未找到 GitHub CLI，请先安装并登录：')
  console.error('  winget install --id GitHub.cli')
  console.error('  gh auth login')
  process.exit(1)
}

const gh = (args) =>
  execFileSync('gh', args, {
    cwd: root,
    stdio: 'inherit',
  })

let createdDraft = false
try {
  gh(['release', 'view', tag])
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
}

for (const file of files) {
  gh(['release', 'upload', tag, file, '--clobber'])
}
// Clients read the manifest first; publish it only after every payload file.
gh(['release', 'upload', tag, manifest, '--clobber'])

if (createdDraft) {
  gh(['release', 'edit', tag, '--draft=false'])
}

console.log(`✓ 已发布 ${tag}`)
