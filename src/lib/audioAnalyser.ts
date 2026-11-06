import { getAudio } from './audio'

type CapturableAudio = HTMLAudioElement & {
  captureStream?: () => MediaStream
}

let audioContext: AudioContext | null = null
let analyser: AnalyserNode | null = null
let frequencyData: Uint8Array<ArrayBuffer> | null = null
const attached = new Map<
  HTMLAudioElement,
  { stream: MediaStream; source: MediaStreamAudioSourceNode }
>()
const waiting = new WeakSet<HTMLAudioElement>()

function ensureAnalyser() {
  if (analyser && audioContext) return analyser
  const AudioContextClass =
    window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext
  if (!AudioContextClass) return null

  audioContext = new AudioContextClass()
  analyser = audioContext.createAnalyser()
  analyser.fftSize = 512
  analyser.smoothingTimeConstant = 0.72
  frequencyData = new Uint8Array(
    new ArrayBuffer(analyser.frequencyBinCount),
  )

  // The capture is only used for analysis; route it through a silent gain so
  // the media element's own output remains the audible one.
  const silent = audioContext.createGain()
  silent.gain.value = 0
  analyser.connect(silent)
  silent.connect(audioContext.destination)
  return analyser
}

/**
 * Captures an audio element once so its low frequencies can drive the fog.
 * captureStream is deliberately used instead of createMediaElementSource:
 * it does not reroute or replace the element's normal audio output, and if a
 * third-party stream refuses capture the player keeps working unchanged.
 */
export function attachAudioAnalyser(element: HTMLAudioElement | null) {
  if (!element) return
  const capturable = element as CapturableAudio
  if (!capturable.captureStream || attached.has(element)) {
    void audioContext?.resume().catch(() => undefined)
    return
  }

  try {
    const stream = capturable.captureStream()
    if (!stream.getAudioTracks().length) {
      // The element may not have loaded its source yet. Try once on either
      // of the media readiness / playback events.
      if (waiting.has(element)) return
      waiting.add(element)
      const events = ['loadeddata', 'canplay', 'playing']
      const retry = () => {
        for (const event of events) element.removeEventListener(event, retry)
        waiting.delete(element)
        if (!attached.has(element)) attachAudioAnalyser(element)
      }
      for (const event of events) {
        element.addEventListener(event, retry, { once: true })
      }
      return
    }
    const node = ensureAnalyser()
    if (!node || !audioContext) return
    const source = audioContext.createMediaStreamSource(stream)
    source.connect(node)
    attached.set(element, { stream, source })
    void audioContext.resume().catch(() => undefined)
  } catch {
    // Cross-origin media without CORS cannot expose a stream. The caller still
    // gets the element's normal playback and the fog falls back to its pulse.
  }
}

export function resumeAudioAnalyser() {
  if (audioContext?.state === 'suspended') {
    void audioContext.resume().catch(() => undefined)
  }
}

/** Returns a smoothed 0–1 low-frequency level, or null without an analyser. */
export function getAudioBassLevel() {
  // Fog frames call this continuously. If the initial attach ran before the
  // media had a source, retry here once playback is under way.
  const audio = getAudio()
  if (audio && !attached.has(audio) && !waiting.has(audio)) {
    attachAudioAnalyser(audio)
  }
  if (!analyser || !frequencyData) return null
  analyser.getByteFrequencyData(frequencyData)
  // fftSize 512: bins 1–8 cover roughly 90–750 Hz at 48 kHz.
  let sum = 0
  for (let index = 1; index <= 8; index += 1) {
    sum += frequencyData[index] ?? 0
  }
  const level = sum / 8 / 255
  // Byte frequency data already sits high on loud masters; gate and curve it
  // so the fog follows the bass instead of pinning at full thickness.
  const shaped = Math.max(0, level - 0.38) / 0.62
  return Math.min(1, Math.pow(shaped, 1.7))
}
