#!/usr/bin/env node
/**
 * Fast local packaging loop.
 *
 * Skips the full typecheck and asks Inno Setup to use lzma2/fast instead of
 * lzma2/max. i18n extraction still runs: without it, new strings ship as raw
 * Lingui ids (e.g. "-FvrqO"). Use `pnpm desktop:release` for a publishable
 * build.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const node = process.execPath

function run(label, command, args, env = {}) {
  const started = Date.now()
  console.log(`\n› ${label}`)
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  })
  if (result.status !== 0) {
    console.error(`✗ ${label} 失败 (${result.status ?? 'signal'})`)
    process.exit(result.status ?? 1)
  }
  console.log(`✓ ${label} ${((Date.now() - started) / 1000).toFixed(1)}s`)
}

const hutch =
  process.env.HUTCH ??
  (process.platform === 'win32'
    ? join(homedir(), '.hutch', 'bin', 'hutch.exe')
    : 'hutch')
if (!existsSync(hutch) && hutch !== 'hutch') {
  console.error(`✗ 未找到 Hutch：${hutch}`)
  process.exit(1)
}

run('提取 i18n 文案', node, [
  join(root, 'node_modules', '@lingui', 'cli', 'dist', 'lingui.js'),
  'extract',
])
run('准备桌面 API', node, [
  join(root, 'scripts', 'prepare-electrobun-api.mjs'),
])
run('Vite 前端构建', node, [
  join(root, 'node_modules', 'vite', 'bin', 'vite.js'),
  'build',
  '--mode',
  'electrobun',
])
run('Electrobun 打包', hutch, [
  'electrobun',
  'build',
  '--env=stable',
])
run(
  'Inno Setup（fast）',
  node,
  [join(root, 'scripts', 'installer', 'build.mjs')],
  { INSTALLER_FAST: '1' },
)

console.log('\n✓ 快速构建完成：build/installer/声屿-Setup-Custom.exe')
console.log('  可发布版本请使用 pnpm desktop:release')
