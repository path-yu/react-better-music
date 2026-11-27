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

/** Preset limits for the locally cached audio library. */
export const CACHE_MAX_MB_OPTIONS = [100, 200, 300, 500, 1000, 2048]

export type LyricDisplayMode = 'both' | 'original' | 'translation'
export type LyricFontSize = 'small' | 'medium' | 'large'
export type NowPlayingMode = 'audio' | 'video'
export type LyricStageStyle = 'flow' | 'partita' | 'tilt'
export type NowPlayingTransition =
  | 'fade'
  | 'slide-up'
  | 'scale'
  | 'cover'
  | 'none'
export type PlayerStyle = 'cover' | 'vinyl' | 'cassette'
/** Original audio or Spleeter-backed smart accompaniment. */
export type StemMode = 'off' | 'smart'
export type StemKind = 'accompaniment' | 'vocals'
export type SongStemKind = StemKind | 'karaoke'
export type SongStemState = {
  enabled: boolean
  kind: SongStemKind
}
export type SpleeterCodec = 'm4a' | 'ogg' | 'mp3' | 'flac' | 'wav'
export type SpleeterBitrate = '128k' | '192k' | '256k' | '320k'

export const PLAYER_STYLE_OPTIONS: Array<{
  value: PlayerStyle
  label: MessageDescriptor
}> = [
  { value: 'cover', label: msg`封面` },
  { value: 'vinyl', label: msg`黑胶唱片` },
  { value: 'cassette', label: msg`磁带` },
]

/** Song page backdrop: CSS gradient (default), WebGL fog, or Apple Music's
    blurred-cover scene (PixiJS, loaded on demand). */
export type BackdropStyle = 'ambient' | 'fog' | 'apple'

export const BACKDROP_STYLE_OPTIONS: Array<{
  value: BackdropStyle
  label: MessageDescriptor
}> = [
  { value: 'ambient', label: msg`CSS 渐变` },
  { value: 'fog', label: msg`WebGL 雾化` },
  { value: 'apple', label: msg`Apple Music` },
]

export const NOW_PLAYING_TRANSITION_OPTIONS: Array<{
  value: NowPlayingTransition
  label: MessageDescriptor
}> = [
  { value: 'fade', label: msg`淡入` },
  { value: 'slide-up', label: msg`从底部滑入` },
  { value: 'scale', label: msg`缩放淡入` },
  { value: 'cover', label: msg`从封面展开` },
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

export const LYRIC_FONT_SIZE_OPTIONS: Array<{
  value: LyricFontSize
  label: MessageDescriptor
  scale: number
}> = [
  { value: 'small', label: msg`小`, scale: 0.9 },
  { value: 'medium', label: msg`标准`, scale: 1 },
  { value: 'large', label: msg`大`, scale: 1.15 },
]

/** Overlap window used when one track fades into the next. */
export const CROSSFADE_DURATION_OPTIONS: Array<{
  value: number
  label: MessageDescriptor
}> = [
  { value: 1, label: msg`1 秒` },
  { value: 2, label: msg`2 秒` },
  { value: 4, label: msg`4 秒` },
  { value: 6, label: msg`6 秒` },
  { value: 8, label: msg`8 秒` },
  { value: 12, label: msg`12 秒` },
]

interface SettingsState {
  cacheBitrate: number
  /** Maximum size of the local audio cache, in megabytes. */
  cacheMaxMb: number
  playLevel: PlayLevel
  /** How lyric lines and their translations are shown. */
  lyricDisplayMode: LyricDisplayMode
  /** Reading size of desktop lyric lines. */
  lyricFontSize: LyricFontSize
  /** Karaoke word-by-word animation; off falls back to whole-line highlighting. */
  wordByWordLyrics: boolean
  /** Backdrop of the immersive player. */
  backdropStyle: BackdropStyle
  /** Visualizer used by the song detail "律动" tab. */
  lyricStageStyle: LyricStageStyle
  /** Preferred third-party source module; `auto` tries all in order. */
  preferredSource: string
  /** Audio/video preference, persisted across tracks and app restarts. */
  nowPlayingMode: NowPlayingMode
  /** Entrance animation for the full-screen now-playing page. */
  nowPlayingTransition: NowPlayingTransition
  /** Artwork treatment on the full-screen now-playing page. */
  playerStyle: PlayerStyle
  /** Dynamically even out per-track loudness during playback. */
  volumeNormalization: boolean
  /** Fade the previous track out while the next one starts. */
  crossfadeEnabled: boolean
  /** Overlap window in seconds when crossfade is enabled. */
  crossfadeSeconds: number
  /** Right-hand label of every progress bar: time left (true) or total length. */
  showRemainingTime: boolean
  /** Instant approximation vs. cached Spleeter accompaniment. */
  stemMode: StemMode
  /** Which separated stem smart mode should play. */
  stemKind: StemKind
  /** Per-song smart mode + selected stem; switching tracks never converts other songs. */
  stemSongs: Record<string, SongStemState>
  /** Vocal level used by the karaoke mix (0–1); default is intentionally low. */
  karaokeVocalLevel: number
  /** Spleeter output container/codec. Defaults to compressed AAC. */
  spleeterCodec: SpleeterCodec
  spleeterBitrate: SpleeterBitrate
  /** Optional download proxy for the Spleeter installer (Python/pip/FFprobe). */
  spleeterProxyUrl: string
  /** Desktop only: block right-click / F12 / DevTools shortcuts. */
  disableDevTools: boolean
  /** Prefer a matched provider for VIP tracks (manual switch is always available). */
  autoReplaceVipSource: boolean
  /**
   * With `autoReplaceVipSource` on, ask `/song/url/match` before the official
   * "other playable edition" recommendation (`/song/copyright/rcmd`).
   */
  preferUnblockSource: boolean
  /** Opt-in: report one completed listen to NetEase after real playback. */
  autoScrobble: boolean
  /** UI language; the source catalog is Simplified Chinese. */
  locale: Locale
  setCacheBitrate: (value: number) => void
  setCacheMaxMb: (value: number) => void
  setPlayLevel: (value: PlayLevel) => void
  setLyricDisplayMode: (value: LyricDisplayMode) => void
  setLyricFontSize: (value: LyricFontSize) => void
  setWordByWordLyrics: (value: boolean) => void
  setBackdropStyle: (value: BackdropStyle) => void
  setLyricStageStyle: (value: LyricStageStyle) => void
  setPreferredSource: (value: string) => void
  setNowPlayingMode: (value: NowPlayingMode) => void
  setNowPlayingTransition: (value: NowPlayingTransition) => void
  setPlayerStyle: (value: PlayerStyle) => void
  setVolumeNormalization: (value: boolean) => void
  setCrossfadeEnabled: (value: boolean) => void
  setCrossfadeSeconds: (value: number) => void
  setShowRemainingTime: (value: boolean) => void
  setStemMode: (value: StemMode) => void
  setStemKind: (value: StemKind) => void
  setSongStemEnabled: (
    songId: number,
    enabled: boolean,
    kind?: SongStemKind,
  ) => void
  setSongStemKind: (songId: number, kind: SongStemKind) => void
  setKaraokeVocalLevel: (value: number) => void
  setSpleeterCodec: (value: SpleeterCodec) => void
  setSpleeterBitrate: (value: SpleeterBitrate) => void
  setSpleeterProxyUrl: (value: string) => void
  setDisableDevTools: (value: boolean) => void
  setAutoReplaceVipSource: (value: boolean) => void
  setPreferUnblockSource: (value: boolean) => void
  setAutoScrobble: (value: boolean) => void
  setLocale: (value: Locale) => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      cacheBitrate: 96,
      cacheMaxMb: 200,
      playLevel: 'exhigh',
      lyricDisplayMode: 'both',
      lyricFontSize: 'medium',
      wordByWordLyrics: true,
      // CSS ambient gradients are cheaper and do not keep a WebGL context alive.
      // Users can opt into the WebGL fog or the Apple Music scene in Settings.
      backdropStyle: 'ambient',
      lyricStageStyle: 'flow',
      preferredSource: 'auto',
      nowPlayingMode: 'audio',
      nowPlayingTransition: 'fade',
      playerStyle: 'cover',
      // Matches the reference player's default: analyse and even out loudness
      // without requiring ReplayGain tags in every file.
      volumeNormalization: true,
      // Radio-style overlap is enabled by default; 4s is long enough to hear
      // the blend without starting the next track too early.
      crossfadeEnabled: true,
      crossfadeSeconds: 4,
      // Matches the original song page and Apple Music; click the label to flip.
      showRemainingTime: true,
      stemMode: 'off',
      stemKind: 'accompaniment',
      stemSongs: {},
      karaokeVocalLevel: 0.08,
      spleeterCodec: 'm4a',
      spleeterBitrate: '192k',
      spleeterProxyUrl: '',
      disableDevTools: false,
      autoReplaceVipSource: false,
      // Matching prefers the UnblockNeteaseMusic endpoint; the official edition
      // recommendation is only the fallback. Existing installs keep this too,
      // because zustand merges the persisted state over these defaults.
      preferUnblockSource: true,
      // Reporting private listening logs is opt-in and never automatic.
      autoScrobble: false,
      locale: defaultLocale,
      setCacheBitrate: (cacheBitrate) => set({ cacheBitrate }),
      setCacheMaxMb: (cacheMaxMb) => set({ cacheMaxMb }),
      setPlayLevel: (playLevel) => set({ playLevel }),
      setLyricDisplayMode: (lyricDisplayMode) => set({ lyricDisplayMode }),
      setLyricFontSize: (lyricFontSize) => set({ lyricFontSize }),
      setWordByWordLyrics: (wordByWordLyrics) => set({ wordByWordLyrics }),
      setBackdropStyle: (backdropStyle) => set({ backdropStyle }),
      setLyricStageStyle: (lyricStageStyle) => set({ lyricStageStyle }),
      setPreferredSource: (preferredSource) => set({ preferredSource }),
      setNowPlayingMode: (nowPlayingMode) => set({ nowPlayingMode }),
      setNowPlayingTransition: (nowPlayingTransition) =>
        set({ nowPlayingTransition }),
      setPlayerStyle: (playerStyle) => set({ playerStyle }),
      setVolumeNormalization: (volumeNormalization) =>
        set({ volumeNormalization }),
      setCrossfadeEnabled: (crossfadeEnabled) => set({ crossfadeEnabled }),
      setCrossfadeSeconds: (crossfadeSeconds) =>
        set({
          crossfadeSeconds: Math.min(12, Math.max(1, crossfadeSeconds)),
        }),
      setShowRemainingTime: (showRemainingTime) => set({ showRemainingTime }),
      setStemMode: (stemMode) => set({ stemMode }),
      setStemKind: (stemKind) => set({ stemKind }),
      setSongStemEnabled: (songId, enabled, kind) =>
        set((state) => {
          const stemSongs = state.stemSongs ?? {}
          return {
            stemSongs: {
              ...stemSongs,
              [songId]: {
                enabled,
                kind:
                  kind ??
                  stemSongs[songId]?.kind ??
                  state.stemKind,
              },
            },
          }
        }),
      setSongStemKind: (songId, kind) =>
        set((state) => {
          const stemSongs = state.stemSongs ?? {}
          return {
            stemSongs: {
              ...stemSongs,
              [songId]: {
                enabled: stemSongs[songId]?.enabled ?? true,
                kind,
              },
            },
            ...(kind === 'karaoke' ? {} : { stemKind: kind }),
          }
        }),
      setKaraokeVocalLevel: (karaokeVocalLevel) =>
        set({
          karaokeVocalLevel: Math.min(
            1,
            Math.max(0, karaokeVocalLevel),
          ),
        }),
      setSpleeterCodec: (spleeterCodec) => set({ spleeterCodec }),
      setSpleeterBitrate: (spleeterBitrate) =>
        set({ spleeterBitrate }),
      setSpleeterProxyUrl: (spleeterProxyUrl) =>
        set({ spleeterProxyUrl: spleeterProxyUrl.trim() }),
      setDisableDevTools: (disableDevTools) => set({ disableDevTools }),
      setAutoReplaceVipSource: (autoReplaceVipSource) => set({ autoReplaceVipSource }),
      setPreferUnblockSource: (preferUnblockSource) =>
        set({ preferUnblockSource }),
      setAutoScrobble: (autoScrobble) => set({ autoScrobble }),
      setLocale: (locale) => {
        activateLocale(locale)
        set({ locale })
      },
    }),
    {
      name: 'react-music-settings',
      version: 11,
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
        // v6 folds the old standalone "grow from cover" toggle into the
        // transition choices.
        const withCover =
          version < 6 &&
          (previous as { growFromCover?: boolean }).growFromCover
            ? { ...withFog, nowPlayingTransition: 'cover' as NowPlayingTransition }
            : withFog
        // v7 removes the realtime band-pass mode; existing fast users move to
        // the Spleeter path (or fall back to off if the environment is absent).
        const withStem =
          version < 7 &&
          (withCover as { stemMode?: string }).stemMode === 'fast'
            ? { ...withCover, stemMode: 'smart' as StemMode }
            : withCover
        // v8 moves smart mode to an explicit per-song switch. Old global smart
        // mode no longer auto-separates every song.
        const withSongStem =
          version < 8
            ? {
                ...withStem,
                stemMode: 'off' as StemMode,
                stemSongs: {} as Record<string, SongStemState>,
              }
            : withStem
        // v9 replaces the original-only option with the karaoke mix.
        const withKaraoke =
          version < 9
            ? {
                ...withSongStem,
                karaokeVocalLevel: 0.08,
                stemSongs: Object.fromEntries(
                  Object.entries(
                    (withSongStem as Partial<SettingsState>)
                      .stemSongs ?? {},
                  ).map(([id, value]) => [
                    id,
                    {
                      ...value,
                      kind:
                        (value.kind as string) === 'original'
                          ? ('karaoke' as SongStemKind)
                          : value.kind,
                    },
                  ]),
                ),
              }
            : withSongStem
        // v10 turns the fog on/off switch into a three-way backdrop choice.
        const withBackdrop =
          version < 10
            ? {
                ...withKaraoke,
                backdropStyle: ((withKaraoke as { fogBackdrop?: boolean }).fogBackdrop
                  ? 'fog'
                  : 'ambient') as BackdropStyle,
              }
            : withKaraoke
        // v11 exposes the dual-player crossfade, enabled by default.
        const withCrossfade =
          version < 11
            ? {
                ...withBackdrop,
                crossfadeEnabled: true,
                crossfadeSeconds: 4,
              }
            : withBackdrop
        // v5 removes Lossless/Hi-Res. Keep existing installs on a valid level
        // instead of leaving a stale value that the quality picker cannot show.
        if (
          version < 5 &&
          !PLAY_QUALITY_OPTIONS.some(
            (option) => option.value === withCrossfade.playLevel,
          )
        ) {
          return { ...withCrossfade, playLevel: 'exhigh' as PlayLevel }
        }
        return withCrossfade
      },
    },
  ),
)
