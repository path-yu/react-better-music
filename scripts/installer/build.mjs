#!/usr/bin/env node
/**
 * 用 Inno Setup 生成「可自选安装目录」的 Windows 安装包。
 *
 * Electrobun 自带的 Setup.exe 是固定目录的每用户自解压器（没有目录页，也没有
 * 命令行参数可改路径），所以这里用 Inno Setup 把同一份内容再包一层。
 *
 * 同时生成 artifacts/win-x64-Setup-Custom.json（版本、大小、SHA-256），
 * 应用内更新据此判断新版本并校验下载的安装包。
 *
 * 关键点：要安装的是 **解压后的应用目录**（bin/ + Resources/），而不是
 * `build/stable-win-x64/声屿` 那个「安装源包」（Resources 里只有一个 tar.zst）。
 * 装错形态时 launcher 会报 "installer package is incomplete"。
 *
 * 依赖：Inno Setup 6（winget install --id JRSoftware.InnoSetup -e）
 * ISCC.exe 查找顺序：环境变量 ISCC → PATH → 用户目录 → Program Files。
 */
import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')
const configPath = join(root, 'electrobun.config.ts')
const appVersion =
  readFileSync(configPath, 'utf8').match(/version:\s*['"]([^'"]+)['"]/)?.[1] ??
  '0.1.0'
const script = join(here, 'app.iss')
const archive = join(root, 'build/stable-win-x64/声屿-Setup.tar.zst')
const stage = join(root, 'build/installer/payload')
const payload = join(stage, '声屿')

if (!existsSync(archive)) {
  console.error('✗ 未找到 build/stable-win-x64/声屿-Setup.tar.zst，请先运行：pnpm desktop:build')
  process.exit(1)
}

/** 1. 解压载荷：bsdtar（Windows 10+ 自带）支持 .tar.zst。 */
console.log('› 解压安装载荷…')
rmSync(stage, { recursive: true, force: true })
mkdirSync(stage, { recursive: true })
const untar = spawnSync('tar', ['-xf', archive, '-C', stage], { stdio: 'inherit' })
if (untar.error) {
  console.error(`✗ 无法运行 tar：${untar.error.message}`)
  process.exit(1)
}
if (untar.status !== 0) {
  console.error('✗ 解压失败，请确认系统自带 tar（Windows 10 1803+）可用。')
  process.exit(1)
}
if (!existsSync(join(payload, 'bin', 'launcher.exe'))) {
  console.error(`✗ 载荷结构异常：${payload} 下没有 bin/launcher.exe`)
  process.exit(1)
}

/** 2. 定位 ISCC.exe。 */
const candidates = [
  process.env.ISCC,
  'ISCC.exe',
  process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs/Inno Setup 6/ISCC.exe'),
  process.env['ProgramFiles(x86)'] &&
    join(process.env['ProgramFiles(x86)'], 'Inno Setup 6/ISCC.exe'),
  process.env.ProgramFiles && join(process.env.ProgramFiles, 'Inno Setup 6/ISCC.exe'),
].filter(Boolean)

let iscc = null
for (const candidate of candidates) {
  if (candidate === 'ISCC.exe') {
    // 通过 PATH 解析：能启动（即使返回用法提示的退出码）即视为找到。
    const probe = spawnSync(candidate, [], { stdio: 'ignore' })
    if (!probe.error) {
      iscc = candidate
      break
    }
    continue
  }
  if (existsSync(candidate)) {
    iscc = candidate
    break
  }
}

if (!iscc) {
  console.error('✗ 未找到 ISCC.exe，请先安装 Inno Setup 6：')
  console.error('  winget install --id JRSoftware.InnoSetup -e')
  process.exit(1)
}

/** 3. 编译。 */
console.log(`› ISCC: ${iscc}`)
console.log('› 正在编译安装包…')

const define = `/DPayloadDir=${payload.includes(' ') ? `"${payload}"` : payload}`
const versionDefine = `/DAppVersion=${appVersion}`
const fast = process.env.INSTALLER_FAST === '1'
const compression = `/DCompressionMode=${fast ? 'lzma2/fast' : 'lzma2/max'}`
console.log(`› 安装包版本：${appVersion}`)
if (fast) console.log('› 快速模式：使用 lzma2/fast 压缩安装包')
// ISCC writes the setup exe and then patches its icon/version resources.
// Windows Defender (or another scanner) often opens the fresh exe in between,
// which fails with "EndUpdateResource failed (110)". The lock is transient, so
// retry only that error instead of failing the whole release.
const RESOURCE_LOCK_PATTERN = /EndUpdateResource|Resource update error/i
const MAX_ATTEMPTS = 4
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

let result
for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
  result = spawnSync(iscc, [define, versionDefine, compression, script], {
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.error) {
    console.error(`✗ 启动 ISCC 失败：${result.error.message}`)
    process.exit(1)
  }
  // Pass ISCC's own output through unchanged (it uses the console code page).
  if (result.stdout?.length) process.stdout.write(result.stdout)
  if (result.stderr?.length) process.stderr.write(result.stderr)
  if (result.status === 0) break

  const output = Buffer.concat([
    result.stdout ?? Buffer.alloc(0),
    result.stderr ?? Buffer.alloc(0),
  ]).toString('latin1')
  if (!RESOURCE_LOCK_PATTERN.test(output) || attempt === MAX_ATTEMPTS) {
    if (RESOURCE_LOCK_PATTERN.test(output)) {
      console.error(
        '✗ 安装包资源写入被占用（通常是杀毒软件在扫描新生成的 exe）。' +
          '请把 build\\installer 加入 Windows 安全中心的排除项后重试：\n' +
          `  Add-MpPreference -ExclusionPath "${join(root, 'build', 'installer')}"`,
      )
    }
    process.exit(result.status ?? 1)
  }
  const waitMs = attempt * 3000
  console.warn(
    `› 安装包被其它程序占用（多半是杀毒软件扫描），${waitMs / 1000}s 后重试（${attempt}/${MAX_ATTEMPTS - 1}）…`,
  )
  sleep(waitMs)
}

// Also place the custom installer beside Hutch's update artifacts so the
// release publisher uploads the same installer users can download.
const output = join(root, 'build/installer/声屿-Setup-Custom.exe')
const artifactDir = join(root, 'artifacts')
if (existsSync(output)) {
  mkdirSync(artifactDir, { recursive: true })
  const target = join(artifactDir, 'win-x64-Setup-Custom.exe')
  copyFileSync(output, target)
  console.log(`› 安装包已复制到 ${target}`)

  // In-app updates read this to find the newest installer and verify it.
  // publish-update.mjs uploads it after the .exe so clients never see a
  // manifest whose installer is still missing.
  const configText = readFileSync(configPath, 'utf8')
  const identifier =
    configText.match(/identifier:\s*['"]([^'"]+)['"]/)?.[1] ?? ''
  const manifest = {
    schemaVersion: 1,
    identifier,
    version: appVersion,
    file: 'win-x64-Setup-Custom.exe',
    size: statSync(target).size,
    sha256: createHash('sha256').update(readFileSync(target)).digest('hex'),
  }
  writeFileSync(
    join(artifactDir, 'win-x64-Setup-Custom.json'),
    JSON.stringify(manifest),
    'utf8',
  )
  console.log(`› 安装包清单：${manifest.version} · ${manifest.sha256.slice(0, 12)}…`)
}

// Electrobun's stable build also writes its own fixed-directory installer
// (…-Setup.zip) and the full-app archive + checksum for its built-in Updater.
// Neither is used: users install with the Inno installer above and in-app
// updates download that installer (src/bun/index.ts). Drop them so artifacts/
// holds exactly what publish-update.mjs uploads (~77 MB less per release).
// stable-win-x64-update.json stays; the app reads its version as a fallback.
const UNUSED_ARTIFACT = /(?:-Setup\.zip|\.tar\.zst|-checksum\.json)$/
if (existsSync(artifactDir)) {
  for (const name of readdirSync(artifactDir)) {
    if (!UNUSED_ARTIFACT.test(name)) continue
    rmSync(join(artifactDir, name), { force: true })
    console.log(`› 已移除不发布的产物：${name}`)
  }
}
process.exit(0)
