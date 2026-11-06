import { useEffect } from 'react'
import { API_BASE } from './apiBase'
import { seekAudio } from './audio'
import { usePlayerStore } from '../store/player'

const REMOTE_BASE = `${API_BASE}/remote/api`
const POLL_INTERVAL = 1_000
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
  if (!response.ok) return { commands: [] as RemoteCommand[], reset: false }
  const payload = (await response.json()) as {
    data?: RemoteCommand[]
    reset?: boolean
  }
  return {
    commands: Array.isArray(payload.data) ? payload.data : [],
    reset: Boolean(payload.reset),
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
 * Publishes the desktop player's state to the local API and applies commands
 * posted by the LAN remote page. The API server is the only shared transport,
 * so this works from a phone on the same network without exposing a second
 * websocket port.
 */
export function useRemoteBridge() {
  useEffect(() => {
    let lastCommandId = 0
    let busy = false
    let disposed = false

    const tick = async () => {
      if (busy || disposed) return
      busy = true
      try {
        await publishState()
        const result = await fetchCommands(lastCommandId)
        if (result.reset) lastCommandId = 0
        for (const command of result.commands) {
          if (disposed) return
          try {
            await applyCommand(command)
          } catch {
            // A single failed remote action must not stop the bridge.
          }
          lastCommandId = Math.max(lastCommandId, command.id)
        }
        if (result.commands.length) await publishState()
      } catch {
        // The API may be starting or temporarily unreachable.
      } finally {
        busy = false
      }
    }

    const timer = window.setInterval(() => void tick(), POLL_INTERVAL)
    void tick()
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [])
}
