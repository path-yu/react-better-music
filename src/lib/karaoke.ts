import { getAudio } from './audio'

let mainAudio: HTMLAudioElement | null = null
let vocalAudio: HTMLAudioElement | null = null
let vocalUrl = ''
let vocalLevel = 0.08
let syncTimer = 0

/** Seek the vocal track only on a real jump (seek, stall); smaller drift is
 *  absorbed by nudging its playback rate, so it no longer stutters. */
const HARD_SYNC_DRIFT = 0.25
const SOFT_SYNC_DRIFT = 0.03
const MAX_RATE_CORRECTION = 0.05

const clamp = (value: number) => Math.min(1, Math.max(0, value))

function syncVocals(force = false) {
  if (!mainAudio || !vocalAudio) return
  const target = mainAudio.currentTime
  // Positive: the vocals are behind the instrumental.
  const drift = target - vocalAudio.currentTime
  const hardSync = force || Math.abs(drift) > HARD_SYNC_DRIFT
  if (hardSync) {
    try {
      vocalAudio.currentTime = target
    } catch {
      // Metadata can still be loading.
    }
  }
  vocalAudio.volume = clamp(mainAudio.volume * vocalLevel)
  const correction =
    hardSync || Math.abs(drift) < SOFT_SYNC_DRIFT
      ? 0
      : Math.max(-MAX_RATE_CORRECTION, Math.min(MAX_RATE_CORRECTION, drift * 0.5))
  vocalAudio.playbackRate = mainAudio.playbackRate * (1 + correction)
  if (mainAudio.paused || mainAudio.ended) {
    if (!vocalAudio.paused) vocalAudio.pause()
  } else if (vocalAudio.paused) {
    void vocalAudio.play().catch(() => undefined)
  }
}

function handlePlay() {
  syncVocals(true)
}

function handlePause() {
  vocalAudio?.pause()
}

function handleSeek() {
  syncVocals(true)
}

/** Loudness leveling changes the volume every 750ms; that must not seek. */
function handleVolume() {
  syncVocals()
}

export function startKaraokeVocals(blob: Blob, level: number) {
  detachKaraokeVocals()
  const main = getAudio()
  if (!main) return false
  mainAudio = main
  vocalLevel = clamp(level)
  vocalUrl = URL.createObjectURL(blob)
  const vocals = new Audio()
  vocals.preload = 'auto'
  vocals.autoplay = true
  vocals.src = vocalUrl
  vocals.loop = false
  vocals.volume = clamp(main.volume * vocalLevel)
  vocalAudio = vocals
  vocals.load()

  main.addEventListener('play', handlePlay)
  main.addEventListener('playing', handlePlay)
  main.addEventListener('pause', handlePause)
  main.addEventListener('ended', handlePause)
  main.addEventListener('seeked', handleSeek)
  main.addEventListener('volumechange', handleVolume)
  main.addEventListener('ratechange', handlePlay)
  syncTimer = window.setInterval(() => syncVocals(), 250)
  syncVocals()
  return true
}

export function setKaraokeVocalVolume(level: number) {
  vocalLevel = clamp(level)
  if (vocalAudio && mainAudio) {
    vocalAudio.volume = clamp(mainAudio.volume * vocalLevel)
  }
}

export function detachKaraokeVocals() {
  if (syncTimer) {
    window.clearInterval(syncTimer)
    syncTimer = 0
  }
  if (mainAudio) {
    mainAudio.removeEventListener('play', handlePlay)
    mainAudio.removeEventListener('playing', handlePlay)
    mainAudio.removeEventListener('pause', handlePause)
    mainAudio.removeEventListener('ended', handlePause)
    mainAudio.removeEventListener('seeked', handleSeek)
    mainAudio.removeEventListener('volumechange', handleVolume)
    mainAudio.removeEventListener('ratechange', handlePlay)
  }
  mainAudio = null
  if (vocalAudio) {
    vocalAudio.pause()
    vocalAudio.removeAttribute('src')
    vocalAudio.load()
    vocalAudio = null
  }
  if (vocalUrl) {
    URL.revokeObjectURL(vocalUrl)
    vocalUrl = ''
  }
}
