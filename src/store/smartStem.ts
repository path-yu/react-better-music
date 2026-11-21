import { create } from 'zustand'
import { getAudio } from '../lib/audio'
import {
  createSpleeterJob,
  createSpleeterJobFromUrl,
  fetchSpleeterStem,
  getSpleeterJob,
  getSpleeterStatus,
  type SpleeterJob,
} from '../lib/spleeter'
import {
  getCachedStem,
  putCachedStems,
  type CachedStemKind,
} from '../lib/smartStemCache'
import { toast } from '../lib/toast'
import { usePlayerStore } from './player'
import { useSettingsStore } from './settings'

type SmartStemStatus =
  | 'idle'
  | 'checking'
  | 'generating'
  | 'ready'
  | 'unavailable'
  | 'error'

type ActiveStem = CachedStemKind | 'original'

type SmartStemState = {
  installed: boolean | null
  checking: boolean
  status: SmartStemStatus
  progress: number
  /** Rough remaining time for the current Spleeter job. */
  etaMs: number
  /** Song whose Spleeter accompaniment is currently feeding the player. */
  activeSongId: number | null
  /** Which Spleeter stem, or the original mix, is currently playing. */
  activeStem: ActiveStem | null
  /** Song currently being generated. */
  generatingSongId: number | null
  error: string
  checkEnvironment: (force?: boolean) => Promise<boolean>
  prepareForSong: (songId: number) => Promise<void>
  switchStem: (kind: CachedStemKind) => Promise<void>
  selectOriginal: () => Promise<void>
  restoreOriginal: () => Promise<void>
}

let activeUrl = ''
let generationToken = 0
let checkingPromise: Promise<boolean> | null = null
const preparingSongs = new Set<number>()

const PENDING_KEY = 'qimiao-spleeter-pending'

type PendingSpleeterJob = {
  songId: number
  jobId: string
  startedAt: number
  estimatedMs: number
}

function readPendingJob(): PendingSpleeterJob | null {
  try {
    const raw = window.localStorage.getItem(PENDING_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<PendingSpleeterJob>
    if (
      typeof value.songId !== 'number' ||
      typeof value.jobId !== 'string' ||
      typeof value.startedAt !== 'number' ||
      typeof value.estimatedMs !== 'number'
    ) {
      return null
    }
    return value as PendingSpleeterJob
  } catch {
    return null
  }
}

function writePendingJob(job: PendingSpleeterJob) {
  try {
    window.localStorage.setItem(PENDING_KEY, JSON.stringify(job))
  } catch {
    // Progress can still continue in this tab without persistence.
  }
}

function clearPendingJob() {
  try {
    window.localStorage.removeItem(PENDING_KEY)
  } catch {
    // Ignore storage failures.
  }
}

function clearActiveUrl() {
  if (!activeUrl) return
  URL.revokeObjectURL(activeUrl)
  activeUrl = ''
}

function currentSongId() {
  const player = usePlayerStore.getState()
  return player.queue[player.currentIndex]?.id ?? null
}

function applyStemBlob(
  songId: number,
  blob: Blob,
  kind: CachedStemKind,
) {
  const playbackAudio = getAudio()
  const player = usePlayerStore.getState()
  const resumeAt = playbackAudio?.currentTime ?? player.currentTime
  const wasPlaying = playbackAudio ? !playbackAudio.paused : player.playing
  clearActiveUrl()
  activeUrl = URL.createObjectURL(blob)
  usePlayerStore.setState({
    audioUrl: activeUrl,
    sourceReady: true,
    sourceTransition: 'stem',
    audioFromCache: false,
    audioBlob: null,
    sourceReloadToken: player.sourceReloadToken + 1,
    resumeAt,
    playing: wasPlaying,
  })
  useSmartStemStore.setState({
    status: 'ready',
    progress: 1,
    etaMs: 0,
    activeSongId: songId,
    activeStem: kind,
    generatingSongId: null,
    error: '',
  })
}

async function pollSpleeterJob(
  jobId: string,
  startedAt: number,
  estimatedMs: number,
  token: number,
) {
  let finished = await getSpleeterJob(jobId)
  while (finished.status !== 'done' && finished.status !== 'error') {
    await new Promise((resolve) => window.setTimeout(resolve, 900))
    finished = await getSpleeterJob(jobId)
    if (token !== generationToken) return finished
    const elapsed = Date.now() - startedAt
    const estimatedProgress = Math.min(0.92, elapsed / estimatedMs)
    useSmartStemStore.setState((state) => ({
      progress: Math.max(state.progress, Math.max(0.02, estimatedProgress)),
      etaMs: Math.max(0, estimatedMs - elapsed),
    }))
  }
  return finished
}

async function finishSpleeterJob(
  songId: number,
  finished: SpleeterJob,
  token: number,
) {
  if (token !== generationToken) return false
  if (finished.status === 'error') {
    throw new Error(finished.error || 'Spleeter 分离失败')
  }
  if (!finished.stems?.accompaniment || !finished.stems.vocals) {
    throw new Error('Spleeter 没有返回完整音轨')
  }
  const [accompaniment, vocals] = await Promise.all([
    fetchSpleeterStem(finished.stems.accompaniment),
    fetchSpleeterStem(finished.stems.vocals),
  ])
  if (token !== generationToken) return false
  await putCachedStems(songId, { accompaniment, vocals })
  clearPendingJob()
  if (token !== generationToken) return false
  if (
    currentSongId() !== songId ||
    useSettingsStore.getState().stemMode !== 'smart'
  ) {
    useSmartStemStore.setState({
      status: 'idle',
      progress: 0,
      etaMs: 0,
      generatingSongId: null,
    })
    return true
  }
  const kind = useSettingsStore.getState().stemKind
  applyStemBlob(
    songId,
    kind === 'vocals' ? vocals : accompaniment,
    kind,
  )
  return true
}

export const useSmartStemStore = create<SmartStemState>((set, get) => ({
  installed: null,
  checking: false,
  status: 'idle',
  progress: 0,
  etaMs: 0,
  activeSongId: null,
  activeStem: null,
  generatingSongId: null,
  error: '',

  async checkEnvironment(force = false) {
    if (!force && get().installed !== null) return Boolean(get().installed)
    if (checkingPromise) return checkingPromise
    set({ checking: true, status: 'checking', error: '' })
    checkingPromise = getSpleeterStatus()
      .then((status) => {
        set({
          installed: status.available,
          checking: false,
          status: status.available ? 'idle' : 'unavailable',
          error: status.available ? '' : status.note,
        })
        return status.available
      })
      .catch(() => {
        set({
          installed: false,
          checking: false,
          status: 'unavailable',
          error: '无法检测 Spleeter 环境',
        })
        return false
      })
      .finally(() => {
        checkingPromise = null
      })
    return checkingPromise
  },

  async prepareForSong(songId) {
    // The detail button and the PlayerBar effect can fire in the same tick.
    // Claim synchronously so only one job (and one start toast) is created.
    if (preparingSongs.has(songId)) return
    preparingSongs.add(songId)
    try {
    const state = get()
    if (state.generatingSongId === songId) return
    if (state.activeSongId === songId) return
    const installed = await get().checkEnvironment()
    if (currentSongId() !== songId) return
    if (!installed) {
      set({ status: 'unavailable', progress: 0 })
      return
    }
    if (useSettingsStore.getState().stemMode !== 'smart') return

    // Claim the job before the cache lookup so the UI can immediately show
    // "generating" instead of appearing unresponsive while IndexedDB opens.
    set({
      status: 'generating',
      progress: 0.01,
      etaMs: 0,
      generatingSongId: songId,
      error: '',
    })

    const preferred = useSettingsStore.getState().stemKind
    let cachedKind: CachedStemKind = preferred
    let cached = await getCachedStem(songId, preferred)
    if (!cached && preferred === 'vocals') {
      cached = await getCachedStem(songId, 'accompaniment')
      cachedKind = 'accompaniment'
    }
    if (cached) {
      if (
        useSettingsStore.getState().stemMode === 'smart' &&
        currentSongId() === songId
      ) {
        applyStemBlob(songId, cached, cachedKind)
      } else {
        set({ status: 'idle', progress: 0, generatingSongId: null })
      }
      return
    }

    // A previous page may have reloaded while the Bun job kept running.
    const pending = readPendingJob()
    if (pending && pending.songId === songId) {
      const token = ++generationToken
      const startedAt = pending.startedAt
      const estimatedMs = pending.estimatedMs
      set({
        status: 'generating',
        progress: 0.05,
        etaMs: Math.max(0, estimatedMs - (Date.now() - startedAt)),
        generatingSongId: songId,
        error: '',
      })
      try {
        const finished = await pollSpleeterJob(
          pending.jobId,
          startedAt,
          estimatedMs,
          token,
        )
        if (token !== generationToken) return
        set({ progress: 0.94, etaMs: 0 })
        const applied = await finishSpleeterJob(songId, finished, token)
        if (!applied) return
        return
      } catch {
        // The Bun process was restarted (or the job expired); start fresh.
        clearPendingJob()
      }
    }

    const player = usePlayerStore.getState()
    const song = player.queue[player.currentIndex]
    const audio = getAudio()
    // During A/B source hand-off getAudio() can point at an element whose src is
    // not committed yet. The store still has the authoritative URL/blob.
    const sourceUrl =
      audio?.currentSrc || audio?.src || player.audioUrl
    const sourceBlob = player.audioBlob
    if (!sourceUrl && !sourceBlob) {
      set({
        status: 'error',
        error: '没有可上传的音频源：当前歌曲尚未加载到播放器',
      })
      return
    }
    const durationMs = player.mediaDuration || song?.dt || 0
    const outputSettings = useSettingsStore.getState()
    const jobMeta = {
      songId,
      songName: song?.name,
      codec: outputSettings.spleeterCodec,
      bitrate: outputSettings.spleeterBitrate,
    }
    const learnedSpeed = Number(
      window.localStorage.getItem('qimiao-spleeter-speed'),
    )
    const speed =
      Number.isFinite(learnedSpeed) && learnedSpeed > 0
        ? Math.min(0.4, Math.max(0.03, learnedSpeed))
        : 0.105
    const estimatedMs = Math.max(
      15_000,
      5_000 + (durationMs > 0 ? durationMs * speed : 30_000),
    )
    const startedAt = Date.now()

    const token = ++generationToken
    set({
      status: 'generating',
      progress: 0.02,
      etaMs: estimatedMs,
      generatingSongId: songId,
      error: '',
    })
    if (currentSongId() === songId) {
      toast.info(
        `正在生成伴奏，预计约 ${Math.ceil(estimatedMs / 1000)} 秒`,
      )
    }
    try {
      let job
      if (sourceBlob) {
        job = await createSpleeterJob(
          sourceBlob,
          `song-${songId}.bin`,
          900,
          jobMeta,
        )
      } else if (/^(blob|data):/i.test(sourceUrl)) {
        const audioResponse = await fetch(sourceUrl)
        if (!audioResponse.ok) throw new Error('读取当前音频失败')
        const audioBlob = await audioResponse.blob()
        if (token !== generationToken) return
        job = await createSpleeterJob(
          audioBlob,
          `song-${songId}.bin`,
          900,
          jobMeta,
        )
      } else {
        try {
          // Bun has no WebView CORS restriction and can fetch the media proxy
          // URL directly. Fall back to an upload if the host rejects it.
          job = await createSpleeterJobFromUrl(
            sourceUrl,
            `song-${songId}.bin`,
            900,
            jobMeta,
          )
        } catch {
          const audioResponse = await fetch(sourceUrl)
          if (!audioResponse.ok) throw new Error('读取当前音频失败')
          const audioBlob = await audioResponse.blob()
          if (token !== generationToken) return
          job = await createSpleeterJob(
            audioBlob,
            `song-${songId}.bin`,
            900,
            jobMeta,
          )
        }
      }
      if (token !== generationToken) return
      writePendingJob({
        songId,
        jobId: job.id,
        startedAt,
        estimatedMs,
      })
      const finished = await pollSpleeterJob(
        job.id,
        startedAt,
        estimatedMs,
        token,
      )
      if (token !== generationToken) return
      const elapsed = Date.now() - startedAt
      if (durationMs > 0) {
        const measured = Math.min(
          0.4,
          Math.max(0.03, (elapsed - 3000) / durationMs),
        )
        window.localStorage.setItem(
          'qimiao-spleeter-speed',
          String(measured),
        )
      }
      set({ progress: 0.94, etaMs: 0 })
      await finishSpleeterJob(songId, finished, token)
    } catch (error) {
      if (token !== generationToken) return
      clearPendingJob()
      const message = error instanceof Error ? error.message : String(error)
      set({
        status: 'error',
        error: message,
        etaMs: 0,
        generatingSongId: null,
      })
      console.error('[smart-stem] generation failed:', error)
      if (currentSongId() === songId) {
        toast.warning(`Spleeter 伴奏生成失败：${message}`)
      }
    }
    } finally {
      preparingSongs.delete(songId)
    }
  },

  async switchStem(kind) {
    const songId = get().activeSongId
    if (!songId || get().activeStem === kind) return
    const cached = await getCachedStem(songId, kind)
    if (!cached) {
      toast.info(
        kind === 'vocals'
          ? '当前歌曲没有缓存人声轨'
          : '当前歌曲没有缓存伴奏轨',
      )
      return
    }
    if (currentSongId() !== songId) return
    useSettingsStore.getState().setStemKind(kind)
    applyStemBlob(songId, cached, kind)
  },

  async selectOriginal() {
    const songId = get().activeSongId
    if (!songId) return
    set({
      status: 'ready',
      progress: 1,
      activeStem: 'original',
      error: '',
    })
    try {
      usePlayerStore.setState({ sourceTransition: 'stem' })
      await usePlayerStore.getState().refreshCurrentUrl()
    } catch {
      toast.warning('恢复原曲失败')
    }
  },

  async restoreOriginal() {
    const hadActiveStem = get().activeSongId !== null
    generationToken += 1
    clearActiveUrl()
    set({
      status: 'idle',
      progress: 0,
      activeSongId: null,
      activeStem: null,
      generatingSongId: null,
      error: '',
    })
    if (!hadActiveStem) return
    try {
      usePlayerStore.setState({ sourceTransition: 'stem' })
      await usePlayerStore.getState().refreshCurrentUrl()
    } catch {
      toast.warning('恢复原声失败')
    }
  },
}))
