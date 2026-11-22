import { create } from 'zustand'
import { msg } from '@lingui/core/macro'
import { i18n } from '../i18n'
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
import { isInstrumentalSong } from '../lib/songs'
import { toast } from '../lib/toast'
import {
  detachKaraokeVocals,
  setKaraokeVocalVolume,
  startKaraokeVocals,
} from '../lib/karaoke'
import { usePlayerStore } from './player'
import { useSettingsStore, type SongStemKind } from './settings'

type SmartStemStatus =
  | 'idle'
  | 'checking'
  | 'generating'
  | 'ready'
  | 'instrumental'
  | 'unavailable'
  | 'error'

type ActiveStem = SongStemKind

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
  switchStem: (kind: SongStemKind) => Promise<void>
  setVocalLevel: (level: number) => void
  restoreOriginal: () => Promise<void>
  releaseInactiveSong: (currentSongId: number | null) => void
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

/** Without an id, clear unconditionally; with one, only if it is still that job. */
function clearPendingJob(jobId?: string) {
  try {
    if (jobId && readPendingJob()?.jobId !== jobId) return
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
  kind: SongStemKind,
  vocalsBlob?: Blob,
) {
  const playbackAudio = getAudio()
  const player = usePlayerStore.getState()
  const resumeAt = playbackAudio?.currentTime ?? player.currentTime
  const wasPlaying = playbackAudio ? !playbackAudio.paused : player.playing
  detachKaraokeVocals()
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
  useSettingsStore.getState().setSongStemKind(songId, kind)
  useSmartStemStore.setState({
    status: 'ready',
    progress: 1,
    etaMs: 0,
    activeSongId: songId,
    activeStem: kind,
    generatingSongId: null,
    error: '',
  })
  if (kind === 'karaoke' && vocalsBlob) {
    startKaraokeVocals(
      vocalsBlob,
      useSettingsStore.getState().karaokeVocalLevel,
    )
  }
}

async function pollSpleeterJob(
  jobId: string,
  startedAt: number,
  estimatedMs: number,
  token: number,
) {
  // A stuck job must not be polled forever.
  const deadline = startedAt + Math.max(estimatedMs * 4, 10 * 60_000)
  let finished = await getSpleeterJob(jobId)
  while (finished.status !== 'done' && finished.status !== 'error') {
    if (Date.now() > deadline) {
      throw new Error(i18n._(msg`伴奏生成超时，请稍后重试`))
    }
    await new Promise((resolve) => window.setTimeout(resolve, 900))
    finished = await getSpleeterJob(jobId)
    // Keep following a job the user has moved away from: Spleeter cannot be
    // cancelled, so its result is still cached for the next play. Only the
    // progress display belongs to the current generation.
    if (token !== generationToken) continue
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
  const current = token === generationToken
  if (finished.status === 'error') {
    clearPendingJob(finished.id)
    if (!current) return false
    throw new Error(finished.error || i18n._(msg`Spleeter 分离失败`))
  }
  if (!finished.stems?.accompaniment || !finished.stems.vocals) {
    clearPendingJob(finished.id)
    if (!current) return false
    throw new Error(i18n._(msg`Spleeter 没有返回完整音轨`))
  }
  const [accompaniment, vocals] = await Promise.all([
    fetchSpleeterStem(finished.stems.accompaniment),
    fetchSpleeterStem(finished.stems.vocals),
  ])
  // Cache even if the user switched tracks meanwhile: the slow part is done,
  // and playing the song again must not start the separation from scratch.
  await putCachedStems(songId, { accompaniment, vocals })
  clearPendingJob(finished.id)
  const settings = useSettingsStore.getState()
  const songSetting = settings.stemSongs?.[String(songId)]
  if (useSmartStemStore.getState().activeSongId === songId) return true
  if (currentSongId() !== songId || !songSetting?.enabled) {
    // A newer generation owns the status display.
    if (token === generationToken) {
      useSmartStemStore.setState({
        status: 'idle',
        progress: 0,
        etaMs: 0,
        generatingSongId: null,
      })
    }
    return true
  }
  // Applied even when stale: the user may have come back to this song while
  // its job was still running (a new prepare is skipped while one is pending).
  if (songSetting.kind === 'karaoke') {
    applyStemBlob(songId, accompaniment, 'karaoke', vocals)
  } else {
    applyStemBlob(
      songId,
      songSetting.kind === 'vocals' ? vocals : accompaniment,
      songSetting.kind,
    )
  }
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
    const before = get()
    const busy =
      before.activeSongId !== null ||
      before.generatingSongId !== null ||
      before.status === 'ready' ||
      before.status === 'generating' ||
      before.status === 'instrumental'
    set({
      checking: true,
      status: busy ? before.status : 'checking',
      error: busy ? before.error : '',
    })
    checkingPromise = getSpleeterStatus()
      .then((status) => {
        const current = get()
        const stillBusy =
          current.activeSongId !== null ||
          current.generatingSongId !== null ||
          current.status === 'ready' ||
          current.status === 'generating' ||
          current.status === 'instrumental'
        set({
          installed: status.available,
          checking: false,
          status: status.available
            ? stillBusy
              ? current.status
              : 'idle'
            : stillBusy
              ? current.status
              : 'unavailable',
          error: status.available
            ? stillBusy
              ? current.error
              : ''
            : status.note,
        })
        return status.available
      })
      .catch(() => {
        const current = get()
        const stillBusy =
          current.activeSongId !== null ||
          current.generatingSongId !== null ||
          current.status === 'ready' ||
          current.status === 'generating' ||
          current.status === 'instrumental'
        set({
          installed: false,
          checking: false,
          status: stillBusy ? current.status : 'unavailable',
          error: stillBusy ? current.error : i18n._(msg`无法检测 Spleeter 环境`),
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
    const playerState = usePlayerStore.getState()
    const queuedSong = playerState.queue[playerState.currentIndex]
    if (
      queuedSong?.id === songId &&
      isInstrumentalSong(queuedSong)
    ) {
      // Invalidate any poll started for the previous track.
      generationToken += 1
      const current = get()
      if (
        current.activeSongId !== null &&
        current.activeSongId !== songId
      ) {
        clearActiveUrl()
      }
      set({
        status: 'instrumental',
        progress: 0,
        etaMs: 0,
        activeSongId: null,
        activeStem: null,
        generatingSongId: null,
        error: '',
      })
      return
    }
    const state = get()
    if (state.generatingSongId === songId) return
    if (state.activeSongId === songId) return

    const songSetting =
      useSettingsStore.getState().stemSongs?.[String(songId)]
    if (!songSetting?.enabled) return

    // Cache is independent of the Spleeter runtime. Check it first so a
    // previously separated song switches instantly, without a checking flash.
    if (songSetting.kind === 'karaoke') {
      const [accompaniment, vocals] = await Promise.all([
        getCachedStem(songId, 'accompaniment'),
        getCachedStem(songId, 'vocals'),
      ])
      if (accompaniment && vocals) {
        if (
          useSettingsStore.getState().stemSongs?.[String(songId)]?.enabled &&
          currentSongId() === songId
        ) {
          applyStemBlob(songId, accompaniment, 'karaoke', vocals)
        } else {
          set({ status: 'idle', progress: 0, generatingSongId: null })
        }
        return
      }
    } else {
      const preferred: CachedStemKind =
        songSetting.kind === 'vocals' ? 'vocals' : 'accompaniment'
      let cachedKind: CachedStemKind = preferred
      let cached = await getCachedStem(songId, preferred)
      if (!cached && preferred === 'vocals') {
        cached = await getCachedStem(songId, 'accompaniment')
        cachedKind = 'accompaniment'
      }
      if (cached) {
        if (
          useSettingsStore.getState().stemSongs?.[String(songId)]?.enabled &&
          currentSongId() === songId
        ) {
          applyStemBlob(songId, cached, cachedKind)
        } else {
          set({ status: 'idle', progress: 0, generatingSongId: null })
        }
        return
      }
    }

    const installed = await get().checkEnvironment()
    if (currentSongId() !== songId) return
    if (!installed) {
      set({ status: 'unavailable', progress: 0 })
      return
    }
    if (
      !useSettingsStore.getState().stemSongs?.[String(songId)]?.enabled
    ) {
      return
    }
    set({
      status: 'generating',
      progress: 0.01,
      etaMs: 0,
      generatingSongId: songId,
      error: '',
    })

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
        if (token === generationToken) set({ progress: 0.94, etaMs: 0 })
        await finishSpleeterJob(songId, finished, token)
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
        error: i18n._(msg`没有可上传的音频源：当前歌曲尚未加载到播放器`),
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
      const seconds = Math.ceil(estimatedMs / 1000)
      toast.info(i18n._(msg`正在生成伴奏，预计约 ${seconds} 秒`))
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
        if (!audioResponse.ok) throw new Error(i18n._(msg`读取当前音频失败`))
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
          if (!audioResponse.ok) throw new Error(i18n._(msg`读取当前音频失败`))
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
      // Keep following a job created for a track the user has already left;
      // only the current generation is resumed after a reload.
      if (token === generationToken) {
        writePendingJob({
          songId,
          jobId: job.id,
          startedAt,
          estimatedMs,
        })
      }
      const finished = await pollSpleeterJob(
        job.id,
        startedAt,
        estimatedMs,
        token,
      )
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
      if (token === generationToken) set({ progress: 0.94, etaMs: 0 })
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
        toast.warning(i18n._(msg`Spleeter 伴奏生成失败：${message}`))
      }
    }
    } finally {
      preparingSongs.delete(songId)
    }
  },

  async switchStem(kind) {
    const songId = get().activeSongId
    if (!songId || get().activeStem === kind) return
    if (kind === 'karaoke') {
      const [accompaniment, vocals] = await Promise.all([
        getCachedStem(songId, 'accompaniment'),
        getCachedStem(songId, 'vocals'),
      ])
      if (!accompaniment || !vocals) {
        toast.info(i18n._(msg`当前歌曲缺少完整人声或伴奏缓存，无法开启随心唱`))
        return
      }
      if (currentSongId() !== songId) return
      useSettingsStore.getState().setSongStemKind(songId, 'karaoke')
      applyStemBlob(songId, accompaniment, 'karaoke', vocals)
      return
    }
    const cached = await getCachedStem(songId, kind)
    if (!cached) {
      toast.info(
        kind === 'vocals'
          ? i18n._(msg`当前歌曲没有缓存人声轨`)
          : i18n._(msg`当前歌曲没有缓存伴奏轨`),
      )
      return
    }
    if (currentSongId() !== songId) return
    useSettingsStore.getState().setSongStemKind(songId, kind)
    applyStemBlob(songId, cached, kind)
  },

  setVocalLevel(level) {
    useSettingsStore.getState().setKaraokeVocalLevel(level)
    setKaraokeVocalVolume(level)
  },

  releaseInactiveSong(currentSongId) {
    const state = get()
    if (
      state.activeSongId === null ||
      state.activeSongId === currentSongId
    ) {
      return
    }
    if (state.activeStem === 'karaoke') {
      detachKaraokeVocals()
    }
    set({
      activeSongId: null,
      activeStem: null,
      ...(state.status === 'ready'
        ? { status: 'idle' as const, progress: 0, etaMs: 0 }
        : {}),
    })
  },

  async restoreOriginal() {
    const hadActiveStem = get().activeSongId !== null
    const songId = get().activeSongId ?? currentSongId()
    generationToken += 1
    detachKaraokeVocals()
    clearActiveUrl()
    set({
      status: 'idle',
      progress: 0,
      activeSongId: null,
      activeStem: null,
      generatingSongId: null,
      error: '',
    })
    if (songId !== null) {
      useSettingsStore
        .getState()
        .setSongStemEnabled(songId, false)
    }
    if (!hadActiveStem) return
    try {
      usePlayerStore.setState({ sourceTransition: 'stem' })
      await usePlayerStore.getState().refreshCurrentUrl()
    } catch {
      toast.warning(i18n._(msg`恢复原声失败`))
    }
  },
}))
