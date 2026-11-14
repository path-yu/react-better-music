import { useEffect, useState } from 'react'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { Trans } from '@lingui/react/macro'
import { Check, Speaker } from 'lucide-react'
import { Popover, PopoverTrigger } from '@pikoloo/darwin-ui'
import { cn } from '../../lib/format'
import { usePlayerMenuTint } from '../../lib/menuSurface'
import { toast } from '../../lib/toast'
import {
  applyAudioOutputDevice,
  listAudioOutputDevices,
  requestAudioOutputAccess,
  supportsAudioOutputSelection,
  type AudioOutputDevice,
} from '../../lib/audioOutput'
import { usePlayerStore } from '../../store/player'
import { useSettingsStore } from '../../store/settings'
import { PlayerMenuContent } from './PlayerMenuContent'

/** Speaker/headphone selector shown beside the detail-page volume scrubber. */
export function OutputDevicePicker() {
  const { i18n } = useLingui()
  const [open, setOpen] = useState(false)
  const [devices, setDevices] = useState<AudioOutputDevice[]>([])
  const queue = usePlayerStore((state) => state.queue)
  const currentIndex = usePlayerStore((state) => state.currentIndex)
  const currentSong = queue[currentIndex]
  const audioOutputId = useSettingsStore((state) => state.audioOutputId)
  const setAudioOutputId = useSettingsStore((state) => state.setAudioOutputId)
  const tint = usePlayerMenuTint(true, currentSong?.al.picUrl)
  const supported = supportsAudioOutputSelection()

  useEffect(() => {
    if (!supported) return
    let active = true
    const load = () => {
      void listAudioOutputDevices()
        .then((items) => {
          if (active) setDevices(items)
        })
        .catch(() => {
          if (active) setDevices([])
        })
    }
    load()
    navigator.mediaDevices.addEventListener('devicechange', load)
    return () => {
      active = false
      navigator.mediaDevices.removeEventListener('devicechange', load)
    }
  }, [supported])

  // Chromium only reveals all audio outputs (and their labels) after media
  // device access has been granted. Ask once when the menu opens, stop the
  // temporary stream immediately, then enumerate again.
  useEffect(() => {
    if (!open || !supported) return
    let active = true
    void requestAudioOutputAccess()
      .then((granted) =>
        granted ? listAudioOutputDevices() : Promise.resolve(null),
      )
      .then((items) => {
        if (active && items) setDevices(items)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [open, supported])

  const options =
    devices.length > 0
      ? devices
      : [{ deviceId: 'default', label: i18n._(msg`默认输出设备`) }]

  const handleSelect = (deviceId: string) => {
    setAudioOutputId(deviceId)
    setOpen(false)
    void applyAudioOutputDevice(deviceId).catch(() => {
      toast.warning(i18n._(msg`无法切换到该输出设备`))
    })
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={i18n._(msg`输出设备`)}
          title={i18n._(msg`输出设备`)}
          disabled={!supported}
          className="pressable flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white/45 transition-colors hover:bg-white/10 hover:text-white/85 disabled:opacity-35"
        >
          <Speaker className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PlayerMenuContent
        immersive
        tint={tint}
        side="top"
        align="end"
        className="w-[min(270px,calc(100vw-24px))]"
      >
        <p className="px-2 py-1 text-[11px] text-white/45">
          <Trans>输出设备</Trans>
        </p>
        {devices.length <= 1 ||
        devices.some((device) => /^输出设备 \d+$/.test(device.label)) ? (
          <p className="px-2 pb-1 pt-1 text-[10px] leading-relaxed text-white/30">
            <Trans>允许应用访问音频设备后，可显示完整设备名称。</Trans>
          </p>
        ) : null}
        {options.map((device) => {
          const active = device.deviceId === audioOutputId
          return (
            <button
              key={device.deviceId}
              type="button"
              aria-pressed={active}
              onClick={() => handleSelect(device.deviceId)}
              className={cn(
                'flex w-full items-center gap-2 rounded-[7px] px-2 py-1.5 text-left text-[11.5px] transition-colors',
                active
                  ? 'bg-white/14 text-white'
                  : 'text-white/65 hover:bg-white/8 hover:text-white/90',
              )}
            >
              <Speaker
                className={cn(
                  'h-4 w-4 shrink-0',
                  active ? 'text-accent' : 'text-white/35',
                )}
              />
              <span className="min-w-0 flex-1 truncate">{device.label}</span>
              {active ? <Check className="h-3 w-3 shrink-0" /> : null}
            </button>
          )
        })}
      </PlayerMenuContent>
    </Popover>
  )
}
