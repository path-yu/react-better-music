let audioElement: HTMLAudioElement | null = null

export function registerAudio(element: HTMLAudioElement | null) {
  audioElement = element
}

export function getAudio() {
  return audioElement
}

export function seekAudio(seconds: number) {
  if (!audioElement) return
  if (!Number.isFinite(seconds)) return
  audioElement.currentTime = Math.max(0, seconds)
}

export function setAudioVolume(percent: number) {
  if (!audioElement) return
  audioElement.volume = Math.min(1, Math.max(0, percent / 100))
}

export function restartAudio() {
  if (!audioElement) return
  audioElement.currentTime = 0
  void audioElement.play().catch(() => undefined)
}
