import { get, postJson } from '../lib/http'

export interface YtDlpStatus {
  installed: boolean
  version: string
  path: string
  downloadUrl: string
  installing: boolean
}

const EMPTY_STATUS: YtDlpStatus = {
  installed: false,
  version: '',
  path: '',
  downloadUrl: '',
  installing: false,
}

/** Whether the local API can find a usable yt-dlp binary. */
export async function fetchYtDlpStatus(): Promise<YtDlpStatus> {
  const res = await get<{ data?: YtDlpStatus }>('/youtube/ytdlp')
  return res.data ?? EMPTY_STATUS
}

/** Download the official yt-dlp release into the app-data bin directory. */
export async function installYtDlp(): Promise<{
  installed: boolean
  version: string
  path: string
} | null> {
  const res = await postJson<{
    data?: { installed: boolean; version: string; path: string }
  }>('/youtube/ytdlp', {})
  return res.data ?? null
}
