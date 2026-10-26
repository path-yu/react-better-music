#!/usr/bin/env node
/**
 * 用 Inno Setup 生成「可自选安装目录」的 Windows 安装包。
 *
 * Electrobun 自带的 Setup.exe 是固定目录的每用户自解压器（没有目录页，也没有
 * 命令行参数可改路径），所以这里用 Inno Setup 把同一份内容再包一层。
 *
 * 关键点：要安装的是 **解压后的应用目录**（bin/ + Resources/），而不是
 * `build/stable-win-x64/声屿` 那个「安装源包」（Resources 里只有一个 tar.zst）。
 * 装错形态时 launcher 会报 "installer package is incomplete"。
 *
 * 依赖：Inno Setup 6（winget install --id JRSoftware.InnoSetup -e）
 * ISCC.exe 查找顺序：环境变量 ISCC → PATH → 用户目录 → Program Files。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')
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
const result = spawnSync(iscc, [define, script], { stdio: 'inherit' })
if (result.error) {
  console.error(`✗ 启动 ISCC 失败：${result.error.message}`)
  process.exit(1)
}
process.exit(result.status ?? 1)
