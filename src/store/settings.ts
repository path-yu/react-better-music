import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import type { PlayLevel } from '../types'
import { activateLocale, defaultLocale, type Locale } from '../i18n'

export const CACHE_QUALITY_OPTIONS: Array<{
  value: string
  label: MessageDescriptor
}> = [
  { value: '64', label: msg`标准 · 64kbps` },
  { value: '96', label: msg`较高 · 96kbps` },
  { value: '128', label: msg`高 · 128kbps` },
]

export const PLAY_QUALITY_OPTIONS: Array<{
  value: PlayLevel
  label: MessageDescriptor
}> = [
  { value: 'standard', label: msg`标准` },
  { value: 'higher', label: msg`较高` },
  { value: 'exhigh', label: msg`极高` },
]

export type LyricDisplayMode = 'both' | 'original' | 'translation'
export type NowPlayingMode = 'audio' | 'video'
export type LyricStageStyle = 'flow' | 'partita' | 'tilt'
export type NowPlayingTransition = 'fade' | 'slide-up' | 'scale' | 'none'

export const NOW_PLAYING_TRANSITION_OPTIONS: Array<{
  value: NowPlayingTransition
  label: MessageDescriptor
}> = [
  { value: 'fade', label: msg`淡入` },
  { value: 'slide-up', label: msg`从底部滑入` },
  { value: 'scale', label: msg`缩放淡入` },
  { value: 'none', label: msg`无动画` },
]

export const LYRIC_STAGE_STYLE_OPTIONS: Array<{
  value: LyricStageStyle
  label: MessageDescriptor
}> = [
  { value: 'flow', label: msg`流光` },
  { value: 'partita', label: msg`云阶` },
  { value: 'tilt', label: msg`倾诉` },
]

export const LYRIC_DISPLAY_OPTIONS: Array<{
  value: LyricDisplayMode
  label: MessageDescriptor
}> = [
  { value: 'both', label: msg`双语对照` },
  { value: 'original', label: msg`仅原文` },
  { value: 'translation', label: msg`仅译文` },
]

interface SettingsState {
  cacheBitrate: number
  playLevel: PlayLevel
  /** How lyric lines and their translations are shown. */
  lyricDisplayMode: LyricDisplayMode
  /** Karaoke word-by-word animation; off falls back to whole-line highlighting. */
  wordByWordLyrics: boolean
  /** WebGL fog backdrop on the immersive player. */
  fogBackdrop: boolean
  /** Visualizer used by the song detail "律动" tab. */
  lyricStageStyle: LyricStageStyle
  /** Preferred third-party source module; `auto` tries all in order. */
  preferredSource: string
  /** Audio/video preference, persisted across tracks and app restarts. */
  nowPlayingMode: NowPlayingMode
  /** Entrance animation for the full-screen now-playing page. */
  nowPlayingTransition: NowPlayingTransition
  /** Desktop only: block right-click / F12 / DevTools shortcuts. */
  disableDevTools: boolean
  /** Prefer a matched provider for VIP tracks (manual switch is always available). */
  autoReplaceVipSource: boolean
  /** Opt-in: report one completed listen to NetEase after real playback. */
  autoScrobble: boolean
  /** UI language; the source catalog is Simplified Chinese. */
  locale: Locale
  setCacheBitrate: (value: number) => void
  setPlayLevel: (value: PlayLevel) => void
  setLyricDisplayMode: (value: LyricDisplayMode) => void
  setWordByWordLyrics: (value: boolean) => void
  setFogBackdrop: (value: boolean) => void
  setLyricStageStyle: (value: LyricStageStyle) => void
  setPreferredSource: (value: string) => void
  setNowPlayingMode: (value: NowPlayingMode) => void
  setNowPlayingTransition: (value: NowPlayingTransition) => void
  setDisableDevTools: (value: boolean) => void
  setAutoReplaceVipSource: (value: boolean) => void
  setAutoScrobble: (value: boolean) => void
  setLocale: (value: Locale) => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      cacheBitrate: 96,
      playLevel: 'exhigh',
      lyricDisplayMode: 'both',
      wordByWordLyrics: true,
      // CSS ambient gradients are cheaper and do not keep a WebGL context alive.
      // Users can opt into the WebGL fog in Settings.
      fogBackdrop: false,
      lyricStageStyle: 'flow',
      preferredSource: 'auto',
      nowPlayingMode: 'audio',
      nowPlayingTransition: 'fade',
      disableDevTools: false,
      autoReplaceVipSource: false,
      // Reporting private listening logs is opt-in and never automatic.
      autoScrobble: false,
      locale: defaultLocale,
      setCacheBitrate: (cacheBitrate) => set({ cacheBitrate }),
      setPlayLevel: (playLevel) => set({ playLevel }),
      setLyricDisplayMode: (lyricDisplayMode) => set({ lyricDisplayMode }),
      setWordByWordLyrics: (wordByWordLyrics) => set({ wordByWordLyrics }),
      setFogBackdrop: (fogBackdrop) => set({ fogBackdrop }),
      setLyricStageStyle: (lyricStageStyle) => set({ lyricStageStyle }),
      setPreferredSource: (preferredSource) => set({ preferredSource }),
      setNowPlayingMode: (nowPlayingMode) => set({ nowPlayingMode }),
      setNowPlayingTransition: (nowPlayingTransition) =>
        set({ nowPlayingTransition }),
      setDisableDevTools: (disableDevTools) => set({ disableDevTools }),
      setAutoReplaceVipSource: (autoReplaceVipSource) => set({ autoReplaceVipSource }),
      setAutoScrobble: (autoScrobble) => set({ autoScrobble }),
      setLocale: (locale) => {
        activateLocale(locale)
        set({ locale })
      },
    }),
    {
      name: 'react-music-settings',
      version: 5,
      // v1 stored a boolean translation switch; keep "off" users in original mode.
      migrate: (persisted, version) => {
        const previous = persisted as Partial<SettingsState> & {
          showLyricTranslation?: boolean
        }
        const next =
          version < 2
            ? {
                ...previous,
                lyricDisplayMode:
                  previous.showLyricTranslation === false ? 'original' : 'both',
              }
            : previous
        // v4 moves the WebGL fog behind an explicit opt-in. Reset old persisted
        // true values once so existing installs also get the safer default.
        const withFog = version < 4 ? { ...next, fogBackdrop: false } : next
        // v5 removes Lossless/Hi-Res. Keep existing installs on a valid level
        // instead of leaving a stale value that the quality picker cannot show.
        if (
          version < 5 &&
          !PLAY_QUALITY_OPTIONS.some(
            (option) => option.value === withFog.playLevel,
          )
        ) {
          return { ...withFog, playLevel: 'exhigh' as PlayLevel }
        }
        return withFog
      },
    },
  ),
)
