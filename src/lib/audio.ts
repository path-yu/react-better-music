let audioElement: HTMLAudioElement | null = null

export function registerAudio(element: HTMLAudioElement | null) {
  audioElement = element
}

export function getAudio() {
  return audioElement
}

/**
 * Jumping the playhead of an audible element cuts the waveform and clicks.
 * The player installs an interceptor that dips the volume for a few ms,
 * moves the playhead while silent and fades back in once the new position
 * plays. Every seek in the app goes through `seekElement` so none of them
 * bypass it.
 */
export interface SeekInterceptor {
  /** Return true when the interceptor takes over the seek. */
  seek(element: HTMLAudioElement, seconds: number): boolean
  /** Target of a seek that has not been applied to the element yet. */
  pendingTarget(element: HTMLAudioElement): number | null
}

let seekInterceptor: SeekInterceptor | null = null

export function setSeekInterceptor(interceptor: SeekInterceptor | null) {
  seekInterceptor = interceptor
}

/**
 * Where playback is heading: a seek still waiting for its fade-out reports
 * its target, so relative seeks (← / →, media keys) chain correctly.
 */
export function playheadTime(element: HTMLAudioElement) {
  return seekInterceptor?.pendingTarget(element) ?? element.currentTime
}

export function seekElement(element: HTMLAudioElement, seconds: number) {
  if (!Number.isFinite(seconds)) return
  const target = Math.max(0, seconds)
  if (seekInterceptor?.seek(element, target)) return
  element.currentTime = target
}

export function seekAudio(seconds: number) {
  if (!audioElement) return
  seekElement(audioElement, seconds)
}

export function setAudioVolume(percent: number) {
  if (!audioElement) return
  audioElement.volume = Math.min(1, Math.max(0, percent / 100))
}
