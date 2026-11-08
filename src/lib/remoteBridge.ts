import { useEffect } from 'react'
import { API_BASE } from './apiBase'
import { seekAudio } from './audio'
import { usePlayerStore } from '../store/player'

const REMOTE_BASE = `${API_BASE}/remote/api`
const STATE_PUBLISH_INTERVAL = 1_000
const REQUEST_TIMEOUT = 2_500

async function remoteFetch(input: string, init?: RequestInit) {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    window.clearTimeout(timer)
  }
}

interface RemoteCommand {
  id: number
  action: string
  value?: number
}

interface RemoteState {
  connected: true
  songId: number
  title: string
  artists: string
  album: string
  cover: string
  duration: number
  position: number
  playing: boolean
  volume: number
  queueLength: number
  currentIndex: number
}

function getRemoteState(): RemoteState {
  const state = usePlayerStore.getState()
  const song = state.queue[state.currentIndex]
  return {
    connected: true,
    songId: song?.id ?? 0,
    title: song?.name ?? '',
    artists: (song?.ar ?? []).map((artist) => artist.name).join(' / '),
    album: song?.al.name ?? '',
    cover: song?.al.picUrl ?? '',
    duration: song?.dt ?? 0,
    position: Math.max(0, Math.round(state.currentTime * 1000)),
    playing: state.playing,
    volume: state.volume,
    queueLength: state.queue.length,
    currentIndex: state.currentIndex,
  }
}

async function publishState() {
  await remoteFetch(`${REMOTE_BASE}/state`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(getRemoteState()),
    cache: 'no-store',
  })
}

async function fetchCommands(after: number) {
  const response = await remoteFetch(
    `${REMOTE_BASE}/commands?after=${encodeURIComponent(String(after))}`,
    { cache: 'no-store' },
  )
  if (!response.ok)
    return { commands: [] as RemoteCommand[], reset: false, active: false }
  const payload = (await response.json()) as {
    data?: RemoteCommand[]
    reset?: boolean
    active?: boolean
  }
  return {
    commands: Array.isArray(payload.data) ? payload.data : [],
    reset: Boolean(payload.reset),
    active: Boolean(payload.active),
  }
}

async function applyCommand(command: RemoteCommand) {
  const state = usePlayerStore.getState()
  const song = state.queue[state.currentIndex]
  switch (command.action) {
    case 'play-pause':
      await state.togglePlay()
      break
    case 'next':
      await state.next()
      break
    case 'prev':
      await state.prev()
      break
    case 'seek': {
      const duration = song?.dt ?? 0
      const position = Math.max(
        0,
        Math.min(duration, Number(command.value) || 0),
      )
      state.setCurrentTime(position / 1000)
      seekAudio(position / 1000)
      break
    }
    case 'volume':
      state.setVolume(
        Math.max(0, Math.min(100, Math.round(Number(command.value) || 0))),
      )
      break
    default:
      break
  }
}

/**
 * The API relays phone state/commands over Server-Sent Events. The desktop
 * keeps one loopback EventSource open; it publishes state only while the API
 * reports that a phone is connected. No phone means no state polling at all.
 */
export function useRemoteBridge() {
  useEffect(() => {
    let disposed = false
    let active = false
    let lastCommandId = 0
    let stateTimer: number | null = null
    let source: EventSource | null = null

    const stopState = () => {
      if (stateTimer !== null) {
        window.clearInterval(stateTimer)
        stateTimer = null
      }
    }

    const publish = () => {
      if (disposed || !active) return
      void publishState().catch(() => undefined)
    }

    const startState = () => {
      if (disposed || !active) return
      publish()
      if (stateTimer === null) {
        stateTimer = window.setInterval(publish, STATE_PUBLISH_INTERVAL)
      }
    }

    const setActive = (next: boolean) => {
      active = next
      if (active) startState()
      else stopState()
    }

    const applyRemoteCommand = async (command: RemoteCommand) => {
      if (disposed || command.id <= lastCommandId) return
      try {
        await applyCommand(command)
      } catch {
        // A single failed remote action must not stop the bridge.
      }
      lastCommandId = Math.max(lastCommandId, command.id)
      publish()
    }

    // Catch commands sent while EventSource was reconnecting. This runs once
    // per connection, not on a timer.
    const syncMissedCommands = async () => {
      try {
        const result = await fetchCommands(lastCommandId)
        if (result.reset) lastCommandId = 0
        for (const command of result.commands) {
          await applyRemoteCommand(command)
        }
      } catch {
        // The API may still be starting.
      }
    }

    const connect = () => {
      if (disposed) return
      source = new EventSource(`${REMOTE_BASE}/desktop-events`)
      source.addEventListener('active', (event) => {
        try {
          const payload = JSON.parse((event as MessageEvent).data) as {
            active?: boolean
          }
          setActive(Boolean(payload.active))
        } catch {
          // Ignore malformed relay messages; EventSource reconnects.
        }
      })
      source.addEventListener('command', (event) => {
        try {
          const command = JSON.parse((event as MessageEvent).data) as RemoteCommand
          void applyRemoteCommand(command)
        } catch {
          // Ignore malformed command frames.
        }
      })
      source.onopen = () => {
        void syncMissedCommands()
      }
      source.onerror = () => {
        // The EventSource reconnects automatically. Stop publishing state
        // until the server confirms an active phone again.
        stopState()
      }
    }

    connect()
    return () => {
      disposed = true
      stopState()
      source?.close()
      source = null
    }
  }, [])
}
