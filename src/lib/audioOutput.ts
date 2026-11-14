export interface AudioOutputDevice {
  deviceId: string
  label: string
}

type SinkCapableMedia = HTMLMediaElement & {
  setSinkId?: (sinkId: string) => Promise<void>
}

export function supportsAudioOutputSelection() {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.enumerateDevices === 'function' &&
    typeof (HTMLMediaElement.prototype as SinkCapableMedia).setSinkId ===
      'function'
  )
}

let accessGranted = false
let accessRequest: Promise<boolean> | null = null

/**
 * Chromium hides audio-output device names (and all but the default output)
 * until the origin has been granted media-device access. Opening the speaker
 * menu requests a short microphone stream once, then stops it immediately;
 * no audio is captured or transmitted.
 */
export async function requestAudioOutputAccess(): Promise<boolean> {
  if (accessGranted) return true
  if (
    typeof navigator === 'undefined' ||
    typeof navigator.mediaDevices?.getUserMedia !== 'function'
  ) {
    return false
  }
  if (!accessRequest) {
    accessRequest = navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        stream.getTracks().forEach((track) => track.stop())
        accessGranted = true
        return true
      })
      .catch(() => false)
      .finally(() => {
        accessRequest = null
      })
  }
  return accessRequest
}

export async function listAudioOutputDevices(): Promise<AudioOutputDevice[]> {
  if (
    typeof navigator === 'undefined' ||
    typeof navigator.mediaDevices?.enumerateDevices !== 'function'
  ) {
    return []
  }
  const devices = await navigator.mediaDevices.enumerateDevices()
  const rolePrefix = /^(Default|Communications|默认值|通信)\s*-\s*/i
  const outputs = devices
    .filter((device) => device.kind === 'audiooutput')
    .map((device, index) => {
      const rawLabel =
        device.label ||
        (device.deviceId === 'default'
          ? '默认输出设备'
          : `输出设备 ${index + 1}`)
      return {
        deviceId: device.deviceId || 'default',
        label: rawLabel,
        // Windows/Chromium expose the same physical endpoint three times:
        // "Default - …", "Communications - …", and the endpoint itself.
        baseLabel: rawLabel.replace(rolePrefix, '').trim(),
        isRoleAlias: rolePrefix.test(rawLabel),
      }
    })

  // Collapse role aliases into the physical endpoint. Prefer the non-prefixed
  // entry so the list matches Windows' three physical output devices.
  const byLabel = new Map<string, (typeof outputs)[number]>()
  for (const output of outputs) {
    const existing = byLabel.get(output.baseLabel)
    if (!existing || (existing.isRoleAlias && !output.isRoleAlias)) {
      byLabel.set(output.baseLabel, output)
    }
  }

  return Array.from(byLabel.values()).map(({ deviceId, label, baseLabel }) => ({
    deviceId,
    label: baseLabel || label,
  }))
}

/** Apply the chosen sink to every mounted media element (both audio decks and video). */
export async function applyAudioOutputDevice(deviceId: string): Promise<void> {
  if (typeof document === 'undefined') return
  const sinkId = deviceId || 'default'
  const elements = Array.from(
    document.querySelectorAll<HTMLMediaElement>('audio, video'),
  ) as SinkCapableMedia[]
  await Promise.allSettled(
    elements.map((element) =>
      typeof element.setSinkId === 'function'
        ? element.setSinkId(sinkId)
        : Promise.resolve(),
    ),
  )
}
