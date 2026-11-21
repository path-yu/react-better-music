import { bridgeFetch, requestJson } from './desktopBridge'

export type SpleeterJob = {
  id: string
  status: 'queued' | 'processing' | 'done' | 'error'
  progress: number
  error: string
  libraryPath?: string
  stems: { vocals: string; accompaniment: string } | null
}

type SpleeterJobMeta = {
  songId?: number
  songName?: string
  codec?: string
  bitrate?: string
}

export type SpleeterInstallState = {
  installing: boolean
  progress: number
  log: string
  error: string
}

export type SpleeterStatus = {
  available: boolean
  venv: string | null
  installRoot: string
  defaultInstallRoot: string
  customInstallRoot: boolean
  venvInInstallRoot: boolean
  libraryRoot: string
  defaultLibraryRoot: string
  customLibraryRoot: boolean
  model: string
  note: string
  install?: SpleeterInstallState
}

export function getSpleeterStatus() {
  return requestJson<SpleeterStatus>('/spleeter/status')
}

export function startSpleeterInstall(proxy = '') {
  return requestJson<SpleeterInstallState>('/spleeter/install', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ proxy }),
  })
}

export function setSpleeterInstallRoot(path: string) {
  return requestJson<SpleeterStatus>('/spleeter/install-root', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  })
}

export async function pickSpleeterInstallDir() {
  return pickSpleeterDir('/spleeter/pick-dir')
}

export function setSpleeterLibraryRoot(path: string) {
  return requestJson<SpleeterStatus>('/spleeter/library-root', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  })
}

export function pickSpleeterLibraryDir() {
  return pickSpleeterDir('/spleeter/pick-library-dir')
}

async function pickSpleeterDir(path: string) {
  const response = await bridgeFetch(path, {
    method: 'POST',
  })
  if (!response.ok) throw new Error(`选择目录失败 (${response.status})`)
  return (await response.json()) as {
    cancelled?: boolean
    status?: SpleeterStatus
    error?: string
  }
}

export async function createSpleeterJob(
  audio: Blob,
  filename: string,
  maxDuration = 900,
  meta: SpleeterJobMeta = {},
) {
  const params = new URLSearchParams({
    filename,
    duration: String(maxDuration),
  })
  if (meta.songId !== undefined) params.set('songId', String(meta.songId))
  if (meta.songName) params.set('songName', meta.songName)
  if (meta.codec) params.set('codec', meta.codec)
  if (meta.bitrate) params.set('bitrate', meta.bitrate)
  const response = await bridgeFetch(
    `/spleeter/jobs?${params.toString()}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: await audio.arrayBuffer(),
    },
    5 * 60_000,
  )
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(detail || `Spleeter 任务创建失败 (${response.status})`)
  }
  return (await response.json()) as SpleeterJob
}

/** Lets Bun download remote audio directly, avoiding WebView CORS limits. */
export async function createSpleeterJobFromUrl(
  audioUrl: string,
  filename: string,
  maxDuration = 900,
  meta: SpleeterJobMeta = {},
) {
  const response = await bridgeFetch(
    '/spleeter/jobs/from-url',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: audioUrl,
        filename,
        duration: maxDuration,
        songId: meta.songId,
        songName: meta.songName,
        codec: meta.codec,
        bitrate: meta.bitrate,
      }),
    },
    5 * 60_000,
  )
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(detail || `Spleeter 任务创建失败 (${response.status})`)
  }
  return (await response.json()) as SpleeterJob
}

export function getSpleeterJob(id: string) {
  return requestJson<SpleeterJob>(
    `/spleeter/jobs/${encodeURIComponent(id)}`,
  )
}

export async function waitForSpleeterJob(
  id: string,
  onProgress?: (job: SpleeterJob) => void,
) {
  while (true) {
    const job = await getSpleeterJob(id)
    onProgress?.(job)
    if (job.status === 'error') {
      throw new Error(job.error || 'Spleeter 分离失败')
    }
    if (job.status === 'done') return job
    await new Promise((resolve) => window.setTimeout(resolve, 800))
  }
}

export async function fetchSpleeterStem(
  path: string,
  timeoutMs = 5 * 60_000,
) {
  const response = await bridgeFetch(path, undefined, timeoutMs)
  if (!response.ok) {
    throw new Error(`音轨下载失败 (${response.status})`)
  }
  return response.blob()
}
