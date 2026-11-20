import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import {
  basename,
  dirname,
  extname,
  join,
  resolve,
} from 'node:path'

type SpleeterStatus = 'queued' | 'processing' | 'done' | 'error'
type SpleeterCodec = 'wav' | 'mp3' | 'ogg' | 'm4a' | 'flac'
type SpleeterBitrate = '128k' | '192k' | '256k' | '320k'

type SpleeterJob = {
  id: string
  status: SpleeterStatus
  progress: number
  error: string
  inputPath: string
  outputDir: string
  logDir: string
  songId?: number
  codec: SpleeterCodec
  bitrate: SpleeterBitrate
  createdAt: number
}

type SpleeterJobOptions = {
  songId?: number
  songName?: string
  codec?: string
  bitrate?: string
  libraryRoot?: string
}

const CODECS = new Set<SpleeterCodec>([
  'wav',
  'mp3',
  'ogg',
  'm4a',
  'flac',
])
const BITRATES = new Set<SpleeterBitrate>([
  '128k',
  '192k',
  '256k',
  '320k',
])

function normalizeCodec(value?: string): SpleeterCodec {
  return CODECS.has(value as SpleeterCodec)
    ? (value as SpleeterCodec)
    : 'm4a'
}

function normalizeBitrate(value?: string): SpleeterBitrate {
  return BITRATES.has(value as SpleeterBitrate)
    ? (value as SpleeterBitrate)
    : '192k'
}

function safeSongName(name?: string) {
  const cleaned = (name ?? '')
    .replace(/[<>:"/\\|?*]/g, ' ')
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
    .slice(0, 80)
  return cleaned || '未命名歌曲'
}

const jobs = new Map<string, SpleeterJob>()
const pending: string[] = []
let running = false
let appDataRoot = ''

type SpleeterConfig = {
  installRoot?: string
  libraryRoot?: string
}

let spleeterConfig: SpleeterConfig | null = null

function configPath() {
  return join(appDataRoot, 'spleeter-config.json')
}

function readConfig() {
  if (spleeterConfig) return spleeterConfig
  try {
    spleeterConfig = JSON.parse(
      readFileSync(configPath(), 'utf8'),
    ) as SpleeterConfig
  } catch {
    spleeterConfig = {}
  }
  return spleeterConfig
}

function persistConfig(config: SpleeterConfig) {
  spleeterConfig = config
  try {
    mkdirSync(appDataRoot, { recursive: true })
    writeFileSync(configPath(), JSON.stringify(config, null, 2), 'utf8')
  } catch {
    // The setting remains active for this process even if persistence fails.
  }
}

function applicationRoot() {
  const executableDir = dirname(process.execPath)
  if (basename(executableDir).toLowerCase() === 'bin') {
    return dirname(executableDir)
  }
  return resolve(import.meta.dir, '..', '..', '..')
}

export function defaultSpleeterInstallRoot() {
  return join(applicationRoot(), 'spleeter-runtime')
}

export function currentSpleeterInstallRoot() {
  const configured = readConfig().installRoot
  return configured ? resolve(configured) : defaultSpleeterInstallRoot()
}

export function setSpleeterInstallRoot(path: string) {
  const next = path.trim()
  if (!next) throw new Error('安装目录不能为空')
  persistConfig({ ...readConfig(), installRoot: resolve(next) })
  return spleeterStatus()
}

export function defaultSpleeterLibraryRoot() {
  return join(applicationRoot(), 'spleeter-library')
}

export function currentSpleeterLibraryRoot() {
  const configured = readConfig().libraryRoot
  return configured ? resolve(configured) : defaultSpleeterLibraryRoot()
}

export function setSpleeterLibraryRoot(path: string) {
  const next = path.trim()
  if (!next) throw new Error('伴奏保存目录不能为空')
  persistConfig({ ...readConfig(), libraryRoot: resolve(next) })
  return spleeterStatus()
}

let installState: {
  installing: boolean
  progress: number
  log: string
  error: string
} = { installing: false, progress: 0, log: '', error: '' }

export function configureSpleeter(appDataDir: string) {
  appDataRoot = appDataDir
}

function findFileUp(start: string, relative: string) {
  let current = resolve(start)
  for (let depth = 0; depth < 12; depth += 1) {
    const candidate = join(current, relative)
    if (existsSync(candidate)) return candidate
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return null
}

function installScriptPath() {
  return (
    findFileUp(process.cwd(), join('scripts', 'install-spleeter.ps1')) ??
    findFileUp(import.meta.dir, join('scripts', 'install-spleeter.ps1')) ??
    join(import.meta.dir, '..', 'install-spleeter.ps1')
  )
}

export function startSpleeterInstall() {
  if (installState.installing) return installState
  const existing = spleeterStatus()
  if (existing.available && existing.venvInInstallRoot) {
    installState = {
      installing: false,
      progress: 100,
      log: 'Spleeter 已安装',
      error: '',
    }
    return installState
  }
  const script = installScriptPath()
  if (!existsSync(script)) {
    installState = {
      installing: false,
      progress: 0,
      log: '',
      error: `找不到安装脚本：${script}`,
    }
    return installState
  }
  const target = currentSpleeterInstallRoot()
  installState = {
    installing: true,
    progress: 1,
    log: '正在启动 Spleeter 安装…',
    error: '',
  }
  void (async () => {
    try {
      const child = Bun.spawn(
        [
          'powershell.exe',
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          script,
          '-InstallRoot',
          target,
        ],
        {
          cwd: dirname(script),
          stdout: 'pipe',
          stderr: 'pipe',
          windowsHide: true,
        },
      )
      const read = async (stream: ReadableStream<Uint8Array>) => {
        const reader = stream.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          let newline = buffer.indexOf('\n')
          while (newline >= 0) {
            const line = buffer.slice(0, newline).trim()
            buffer = buffer.slice(newline + 1)
            if (line.startsWith('PROGRESS:')) {
              const value = Number(line.slice('PROGRESS:'.length))
              if (Number.isFinite(value)) {
                installState.progress = Math.min(99, Math.max(0, value))
              }
            } else if (line.startsWith('LOG:')) {
              installState.log = line.slice('LOG:'.length)
            } else if (line.startsWith('ERROR:')) {
              installState.error = line.slice('ERROR:'.length)
            }
            newline = buffer.indexOf('\n')
          }
        }
      }
      const [exitCode] = await Promise.all([
        child.exited,
        read(child.stdout),
        read(child.stderr),
      ])
      installState.installing = false
      installState.progress = 100
      if (exitCode !== 0) {
        installState.error =
          installState.error || `安装脚本退出码 ${exitCode}`
      } else {
        installState.log = 'Spleeter 安装完成'
      }
    } catch (error) {
      installState.installing = false
      installState.error = String(error)
    }
  })()
  return installState
}

const ALLOWED_EXTENSIONS = new Set([
  '.aac',
  '.flac',
  '.m4a',
  '.mp3',
  '.oga',
  '.ogg',
  '.opus',
  '.wav',
  '.webm',
])

function findVenv(start: string) {
  let current = resolve(start)
  for (let depth = 0; depth < 10; depth += 1) {
    const candidate = join(current, '.venv-spleeter39')
    if (existsSync(join(candidate, 'Scripts', 'spleeter.exe'))) {
      return candidate
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return null
}

function venvRoot() {
  if (process.env.SPLEETER_VENV) {
    const configured = resolve(process.env.SPLEETER_VENV)
    if (existsSync(join(configured, 'Scripts', 'spleeter.exe'))) {
      return configured
    }
  }
  const selected = findVenv(currentSpleeterInstallRoot())
  if (selected) return selected
  if (appDataRoot) {
    const legacy = findVenv(join(appDataRoot, 'spleeter-runtime'))
    if (legacy) return legacy
  }
  return findVenv(process.cwd()) ?? findVenv(import.meta.dir)
}

export function spleeterStatus() {
  const venv = venvRoot()
  const installRoot = currentSpleeterInstallRoot()
  const defaultInstallRoot = defaultSpleeterInstallRoot()
  const libraryRoot = currentSpleeterLibraryRoot()
  const defaultLibraryRoot = defaultSpleeterLibraryRoot()
  const complete = Boolean(
    venv &&
      existsSync(join(venv, 'Scripts', 'spleeter.exe')) &&
      existsSync(join(venv, 'Scripts', 'ffmpeg.exe')) &&
      existsSync(join(venv, 'Scripts', 'ffprobe.exe')),
  )
  const venvInInstallRoot = Boolean(
    venv &&
      resolve(venv)
        .toLowerCase()
        .startsWith(resolve(installRoot).toLowerCase()),
  )
  return {
    available: complete,
    venv,
    installRoot,
    defaultInstallRoot,
    customInstallRoot: installRoot !== defaultInstallRoot,
    venvInInstallRoot,
    libraryRoot,
    defaultLibraryRoot,
    customLibraryRoot: libraryRoot !== defaultLibraryRoot,
    model: 'spleeter:2stems',
    install: installState,
    note: complete
      ? 'Spleeter 运行在本地 Python 虚拟环境中，首次分离会下载 2stems 模型。'
      : installState.installing
        ? 'Spleeter 正在安装…'
        : '未找到完整 Spleeter 环境，可在设置中一键安装。',
  }
}

function publicJob(job: SpleeterJob) {
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    error: job.error,
    libraryPath: job.outputDir,
    codec: job.codec,
    bitrate: job.bitrate,
    stems:
      job.status === 'done'
        ? {
            vocals: `/spleeter/jobs/${job.id}/stems/vocals`,
            accompaniment: `/spleeter/jobs/${job.id}/stems/accompaniment`,
          }
        : null,
  }
}

export function getSpleeterJob(id: string) {
  return jobs.get(id) ?? null
}

export function getSpleeterStem(id: string, stem: string) {
  const job = jobs.get(id)
  if (!job || job.status !== 'done') return null
  if (stem !== 'vocals' && stem !== 'accompaniment') return null
  const path = join(job.outputDir, `${stem}.${job.codec}`)
  return existsSync(path) ? path : null
}

export function createSpleeterJob(
  audio: Uint8Array,
  filename: string,
  tempRoot: string,
  maxDuration = 900,
  options: SpleeterJobOptions = {},
) {
  const venv = venvRoot()
  if (!venv) throw new Error('Spleeter 虚拟环境不存在')
  if (!audio.byteLength) throw new Error('音频文件为空')
  if (audio.byteLength > 200 * 1024 * 1024) {
    throw new Error('音频文件不能超过 200 MB')
  }
  if (options.songId !== undefined) {
    const existing = [...jobs.values()].find(
      (job) =>
        job.songId === options.songId &&
        (job.status === 'queued' || job.status === 'processing'),
    )
    if (existing) return publicJob(existing)
  }
  const id = crypto.randomUUID()
  const originalExtension = extname(filename).toLowerCase()
  const extension = ALLOWED_EXTENSIONS.has(originalExtension)
    ? originalExtension
    : '.bin'
  const dir = join(tempRoot, 'spleeter-jobs', id)
  mkdirSync(dir, { recursive: true })
  const inputPath = join(dir, `input${extension}`)
  writeFileSync(inputPath, audio)
  const libraryKey =
    options.songId !== undefined
      ? `${safeSongName(options.songName)}_${options.songId}`
      : `${safeSongName(options.songName)}_${id}`
  const outputDir = join(
    options.libraryRoot
      ? resolve(options.libraryRoot)
      : currentSpleeterLibraryRoot(),
    libraryKey,
  )
  const job: SpleeterJob = {
    id,
    status: 'queued',
    progress: 0,
    error: '',
    inputPath,
    outputDir,
    logDir: dir,
    songId: options.songId,
    codec: normalizeCodec(options.codec),
    bitrate: normalizeBitrate(options.bitrate),
    createdAt: Date.now(),
  }
  jobs.set(id, job)
  pending.push(id)
  void drainQueue(venv, Math.min(900, Math.max(1, maxDuration)))
  return publicJob(job)
}

async function drainQueue(venv: string, maxDuration: number) {
  if (running) return
  running = true
  try {
    while (pending.length) {
      const id = pending.shift()
      if (!id) break
      const job = jobs.get(id)
      if (!job) continue
      await runJob(job, venv, maxDuration)
    }
  } finally {
    running = false
  }
}

async function runJob(job: SpleeterJob, venv: string, maxDuration: number) {
  job.status = 'processing'
  job.progress = 0.08
  const scripts = join(venv, 'Scripts')
  const executable = join(scripts, 'spleeter.exe')
  mkdirSync(job.outputDir, { recursive: true })
  try {
    let lastDetail = ''
    let lastExitCode = 0
    for (let attempt = 0; attempt < 2; attempt += 1) {
      // A killed first attempt can leave partial WAVs behind.
      rmSync(job.outputDir, { recursive: true, force: true })
      mkdirSync(job.outputDir, { recursive: true })
      const child = Bun.spawn(
        [
          executable,
          'separate',
          '-p',
          'spleeter:2stems',
          '-o',
          job.outputDir,
          '-f',
          '{instrument}.{codec}',
          '-c',
          job.codec,
          '-b',
          job.bitrate,
          '-d',
          String(maxDuration),
          job.inputPath,
        ],
        {
          cwd: scripts,
          stdout: 'pipe',
          stderr: 'pipe',
          windowsHide: true,
          env: {
            ...process.env,
            PATH: `${scripts};${process.env.PATH ?? ''}`,
            TF_CPP_MIN_LOG_LEVEL: '2',
            TF_NUM_INTRAOP_THREADS: '2',
            TF_NUM_INTEROP_THREADS: '1',
            OMP_NUM_THREADS: '2',
            PYTHONIOENCODING: 'utf-8',
          },
        },
      )
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ])
      const vocals = join(job.outputDir, `vocals.${job.codec}`)
      const accompaniment = join(
        job.outputDir,
        `accompaniment.${job.codec}`,
      )
      if (
        exitCode === 0 &&
        existsSync(vocals) &&
        existsSync(accompaniment)
      ) {
        rmSync(job.inputPath, { force: true })
        job.status = 'done'
        job.progress = 1
        return
      }
      lastDetail = (stderr || stdout).trim().slice(-2000)
      lastExitCode = exitCode
      writeFileSync(
        join(job.logDir, `spleeter-attempt-${attempt + 1}.log`),
        `exit=${exitCode}\n${stdout}\n${stderr}`,
        'utf8',
      )
      // Exit code 9 on Windows means the child was force-killed (usually
      // memory pressure or antivirus), not a normal Python failure.
      if (exitCode === 9 && attempt === 0) {
        job.progress = 0.1
        await new Promise((resolve) => setTimeout(resolve, 1500))
        continue
      }
      break
    }
    throw new Error(
      lastDetail ||
        `Spleeter exited with code ${lastExitCode} (可能被系统强制终止)`,
    )
  } catch (error) {
    job.status = 'error'
    job.error = error instanceof Error ? error.message : String(error)
    rmSync(job.inputPath, { force: true })
  }
}
