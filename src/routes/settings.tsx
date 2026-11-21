import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { Trans } from '@lingui/react/macro'
import {
  Check,
  Download,
  FolderOpen,
  HardDrive,
  Headphones,
  Keyboard,
  ListMusic,
  Languages,
  Loader2,
  Moon,
  Palette as PaletteIcon,
  Play,
  RefreshCw,
  Shield,
  Sun,
  Trash2,
  WandSparkles,
} from 'lucide-react'
import { Button, Select, Switch } from '@pikoloo/darwin-ui'
import {
  CACHE_MAX_MB_OPTIONS,
  CACHE_QUALITY_OPTIONS,
  NOW_PLAYING_TRANSITION_OPTIONS,
  useSettingsStore,
  type NowPlayingTransition,
} from '../store/settings'
import { useUiStore } from '../store/ui'
import { PALETTE_OPTIONS } from '../lib/theme'
import {
  SettingsNav,
  type SettingsTab,
} from '../components/settings/SettingsNav'
import { PlayerStylePicker } from '../components/settings/PlayerStylePicker'
import {
  clearAudioCache,
  downloadCachedAudio,
  listCachedAudio,
  trimAudioCacheToLimit,
  type CachedAudioItem,
} from '../lib/songCache'
import {
  desktopAudioCacheDir,
  openDesktopAudioCacheDir,
  pickDesktopAudioCacheDir,
} from '../lib/desktopAudioCache'
import { usePlayerStore } from '../store/player'
import { useSmartStemStore } from '../store/smartStem'
import {
  getSpleeterStatus,
  pickSpleeterInstallDir,
  pickSpleeterLibraryDir,
  setSpleeterInstallRoot,
  setSpleeterLibraryRoot,
  startSpleeterInstall,
  type SpleeterStatus,
} from '../lib/spleeter'
import {
  getDownloadDir,
  isDesktopApp,
  openDownloadDir,
  pickDownloadDir,
} from '../lib/desktopDownloads'
import { getDevToolsPolicy, setDevToolsPolicy } from '../lib/desktopBridge'
import { locales, type Locale } from '../i18n'
import { formatDate, formatDuration } from '../lib/format'
import { useDocumentTitle } from '../lib/title'
import { toast } from '../lib/toast'

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
})

type ShortcutKey = string | MessageDescriptor

const SHORTCUTS: Array<{ keys: ShortcutKey[]; label: MessageDescriptor }> = [
  { keys: [msg`空格`], label: msg`播放 / 暂停` },
  { keys: ['Alt', '↑ / ↓'], label: msg`音量 +5 / -5` },
  { keys: ['Shift', 'Alt', '↑ / ↓'], label: msg`音量 +1 / -1` },
  { keys: ['↑ / ↓', 'Enter'], label: msg`在搜索建议中选择并进入` },
  { keys: ['Esc'], label: msg`关闭播放页、播放列表、侧栏或搜索建议` },
]

function formatBytes(bytes: number) {
  if (!bytes) return '0 MB'
  const mb = bytes / (1024 * 1024)
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

const SPLEETER_CODEC_OPTIONS = [
  { value: 'm4a', label: 'M4A / AAC（推荐）' },
  { value: 'ogg', label: 'OGG / Vorbis' },
  { value: 'mp3', label: 'MP3' },
  { value: 'flac', label: 'FLAC（无损）' },
  { value: 'wav', label: 'WAV（未压缩）' },
] as const

const SPLEETER_BITRATE_OPTIONS = [
  { value: '128k', label: '128 kbps（更小）' },
  { value: '192k', label: '192 kbps（推荐）' },
  { value: '256k', label: '256 kbps' },
  { value: '320k', label: '320 kbps（最高）' },
] as const

function SettingsPage() {
  const { i18n } = useLingui()
  useDocumentTitle(i18n._(msg`设置`))
  const spleeterCodec = useSettingsStore((state) => state.spleeterCodec)
  const spleeterBitrate = useSettingsStore(
    (state) => state.spleeterBitrate,
  )
  const setSpleeterCodec = useSettingsStore(
    (state) => state.setSpleeterCodec,
  )
  const setSpleeterBitrate = useSettingsStore(
    (state) => state.setSpleeterBitrate,
  )
  const spleeterProxyUrl = useSettingsStore(
    (state) => state.spleeterProxyUrl,
  )
  const setSpleeterProxyUrl = useSettingsStore(
    (state) => state.setSpleeterProxyUrl,
  )
  const cacheBitrate = useSettingsStore((state) => state.cacheBitrate)
  const cacheMaxMb = useSettingsStore((state) => state.cacheMaxMb)
  const setCacheMaxMb = useSettingsStore((state) => state.setCacheMaxMb)
  const setCacheBitrate = useSettingsStore((state) => state.setCacheBitrate)
  const autoReplaceVipSource = useSettingsStore((state) => state.autoReplaceVipSource)
  const setAutoReplaceVipSource = useSettingsStore(
    (state) => state.setAutoReplaceVipSource,
  )
  const locale = useSettingsStore((state) => state.locale)
  const setLocale = useSettingsStore((state) => state.setLocale)
  const [activeTab, setActiveTab] = useState<SettingsTab>('general')
  const [settingsQuery, setSettingsQuery] = useState('')
  const [items, setItems] = useState<CachedAudioItem[]>([])
  const [loading, setLoading] = useState(true)
  const settingsPanelsRef = useRef<HTMLDivElement>(null)
  const [selected, setSelected] = useState<number[]>([])
  const [clearing, setClearing] = useState(false)
  const [confirmingClear, setConfirmingClear] = useState(false)
  const clearConfirmTimer = useRef<number | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [downloadingId, setDownloadingId] = useState<number | null>(null)
  const desktop = isDesktopApp()
  const [downloadDir, setDownloadDir] = useState('')
  const [pickingDir, setPickingDir] = useState(false)
  const [cacheDir, setCacheDir] = useState('')
  const [canPickCacheDir, setCanPickCacheDir] = useState(false)
  const [pickingCacheDir, setPickingCacheDir] = useState(false)
  const [spleeterStatus, setSpleeterStatus] =
    useState<SpleeterStatus | null>(null)
  const [spleeterBusy, setSpleeterBusy] = useState(false)
  const [spleeterPicking, setSpleeterPicking] = useState(false)
  const [libraryPicking, setLibraryPicking] = useState(false)
  const [spleeterError, setSpleeterError] = useState('')
  const disableDevTools = useSettingsStore((state) => state.disableDevTools)
  const setDisableDevTools = useSettingsStore((state) => state.setDisableDevTools)
  const theme = useUiStore((state) => state.theme)
  const setTheme = useUiStore((state) => state.setTheme)
  const palette = useUiStore((state) => state.palette)
  const setPalette = useUiStore((state) => state.setPalette)
  const fogBackdrop = useSettingsStore((state) => state.fogBackdrop)
  const setFogBackdrop = useSettingsStore((state) => state.setFogBackdrop)
  const nowPlayingTransition = useSettingsStore(
    (state) => state.nowPlayingTransition,
  )
  const setNowPlayingTransition = useSettingsStore(
    (state) => state.setNowPlayingTransition,
  )

  const autoScrobble = useSettingsStore((state) => state.autoScrobble)
  const setAutoScrobble = useSettingsStore((state) => state.setAutoScrobble)
  const volumeNormalization = useSettingsStore(
    (state) => state.volumeNormalization,
  )
  const setVolumeNormalization = useSettingsStore(
    (state) => state.setVolumeNormalization,
  )

  useEffect(() => {
    if (!desktop) return
    let active = true
    const load = () => {
      void getSpleeterStatus()
        .then((status) => {
          if (!active) return
          setSpleeterStatus(status)
          if (status.available) {
            // Enable the smart button without requiring a page reload.
            useSmartStemStore.setState({
              installed: true,
              status: 'idle',
              error: '',
            })
          }
        })
        .catch(() => undefined)
    }
    load()
    const timer = window.setInterval(load, 2500)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [desktop])

  const handlePickSpleeterDir = async () => {
    if (spleeterPicking) return
    setSpleeterPicking(true)
    setSpleeterError('')
    try {
      const result = await pickSpleeterInstallDir()
      if (result.status) setSpleeterStatus(result.status)
    } catch (error) {
      setSpleeterError(String(error))
    } finally {
      setSpleeterPicking(false)
    }
  }

  const handleResetSpleeterDir = async () => {
    if (!spleeterStatus) return
    setSpleeterError('')
    try {
      const status = await setSpleeterInstallRoot(
        spleeterStatus.defaultInstallRoot,
      )
      setSpleeterStatus(status)
    } catch (error) {
      setSpleeterError(String(error))
    }
  }

  const handlePickLibraryDir = async () => {
    if (libraryPicking) return
    setLibraryPicking(true)
    setSpleeterError('')
    try {
      const result = await pickSpleeterLibraryDir()
      if (result.status) setSpleeterStatus(result.status)
    } catch (error) {
      setSpleeterError(String(error))
    } finally {
      setLibraryPicking(false)
    }
  }

  const handleResetLibraryDir = async () => {
    if (!spleeterStatus) return
    setSpleeterError('')
    try {
      const status = await setSpleeterLibraryRoot(
        spleeterStatus.defaultLibraryRoot,
      )
      setSpleeterStatus(status)
    } catch (error) {
      setSpleeterError(String(error))
    }
  }

  const handleInstallSpleeter = async () => {
    if (spleeterBusy || spleeterStatus?.install?.installing) return
    setSpleeterBusy(true)
    setSpleeterError('')
    try {
      const state = await startSpleeterInstall(spleeterProxyUrl)
      setSpleeterStatus((current) =>
        current ? { ...current, install: state } : current,
      )
    } catch (error) {
      setSpleeterError(String(error))
    } finally {
      setSpleeterBusy(false)
    }
  }

  useEffect(() => {
    if (!desktop) return
    let active = true
    void getDownloadDir()
      .then((dir) => {
        if (active) setDownloadDir(dir)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [desktop])

  useEffect(() => {
    if (!desktop) return
    let active = true
    void desktopAudioCacheDir()
      .then(({ dir, canPick }) => {
        if (!active) return
        setCacheDir(dir)
        setCanPickCacheDir(canPick)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [desktop])

  // The main-process policy is authoritative for the next launch; pull it once
  // so the switch reflects what WebView2 will actually do.
  useEffect(() => {
    if (!desktop) return
    let active = true
    void getDevToolsPolicy()
      .then(({ disabled }) => {
        if (active) setDisableDevTools(disabled)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [desktop, setDisableDevTools])

  const handleToggleDevTools = (disabled: boolean) => {
    setDisableDevTools(disabled)
    void setDevToolsPolicy(disabled).catch(() => undefined)
    toast.info(
      disabled
        ? i18n._(msg`已禁用开发者工具，重启应用后完全生效`)
        : i18n._(msg`已允许开发者工具，重启应用后完全生效`),
    )
  }

  const loadCache = useCallback(async () => {
    setLoading(true)
    try {
      const list = await listCachedAudio()
      setItems(list)
      setSelected((prev) => prev.filter((id) => list.some((item) => item.id === id)))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadCache()
  }, [loadCache])

  useEffect(() => {
    return () => {
      if (clearConfirmTimer.current !== null) {
        window.clearTimeout(clearConfirmTimer.current)
        clearConfirmTimer.current = null
      }
    }
  }, [])

  const totalBytes = useMemo(
    () => items.reduce((total, item) => total + item.size, 0),
    [items],
  )
  const allSelected = items.length > 0 && selected.length === items.length

  const toggleAll = () => {
    setSelected(allSelected ? [] : items.map((item) => item.id))
  }

  const toggleOne = (id: number) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    )
  }

  const handleClear = async () => {
    if (clearing || loading || !items.length) return
    if (!confirmingClear) {
      setConfirmingClear(true)
      if (clearConfirmTimer.current !== null) {
        window.clearTimeout(clearConfirmTimer.current)
      }
      clearConfirmTimer.current = window.setTimeout(() => {
        clearConfirmTimer.current = null
        setConfirmingClear(false)
      }, 3000)
      return
    }
    if (clearConfirmTimer.current !== null) {
      window.clearTimeout(clearConfirmTimer.current)
      clearConfirmTimer.current = null
    }
    setConfirmingClear(false)
    setClearing(true)
    try {
      await clearAudioCache()
      setItems([])
      setSelected([])
      toast.success(i18n._(msg`缓存音乐已清除`))
    } catch {
      toast.error(i18n._(msg`清除缓存失败`))
    } finally {
      setClearing(false)
    }
  }

  const handleDownloadSelected = async () => {
    if (downloading || !selected.length) return
    setDownloading(true)
    try {
      const count = await downloadCachedAudio(selected)
      toast.success(
        desktop
          ? downloadDir
            ? i18n._(msg`已导出 ${count} 首缓存音乐到 ${downloadDir}`)
            : i18n._(msg`已导出 ${count} 首缓存音乐到下载目录`)
          : selected.length > 1
            ? i18n._(msg`已导出 ${count} 首缓存音乐（ZIP 压缩包）`)
            : i18n._(msg`已导出 ${count} 首缓存音乐，请查看下载目录`),
      )
    } catch {
      toast.error(i18n._(msg`导出缓存失败`))
    } finally {
      setDownloading(false)
    }
  }

  const handleDownloadOne = async (item: CachedAudioItem) => {
    if (downloadingId !== null) return
    setDownloadingId(item.id)
    try {
      await downloadCachedAudio([item.id])
      toast.success(
        desktop
          ? i18n._(msg`已保存「${item.name}」到下载目录`)
          : i18n._(msg`已开始下载「${item.name}」`),
      )
    } catch {
      toast.error(i18n._(msg`下载失败`))
    } finally {
      setDownloadingId(null)
    }
  }

  const handlePickDir = async () => {
    if (pickingDir) return
    setPickingDir(true)
    try {
      const dir = await pickDownloadDir()
      if (dir) {
        setDownloadDir(dir)
        toast.success(i18n._(msg`下载目录已更新`))
      }
    } catch {
      toast.error(i18n._(msg`无法选择下载目录`))
    } finally {
      setPickingDir(false)
    }
  }

  const handleOpenDir = async () => {
    try {
      await openDownloadDir()
    } catch {
      toast.error(i18n._(msg`无法打开下载目录`))
    }
  }

  const handlePickCacheDir = async () => {
    if (pickingCacheDir) return
    setPickingCacheDir(true)
    try {
      const dir = await pickDesktopAudioCacheDir()
      if (dir) {
        setCacheDir(dir)
        toast.success(i18n._(msg`缓存目录已更新`))
        void loadCache()
      }
    } catch {
      toast.error(i18n._(msg`无法选择缓存目录`))
    } finally {
      setPickingCacheDir(false)
    }
  }

  const handleOpenCacheDir = async () => {
    try {
      await openDesktopAudioCacheDir()
    } catch {
      toast.error(i18n._(msg`无法打开缓存目录`))
    }
  }

  const handlePlayAll = async () => {
    if (!items.length) return
    const songs = items.map((item) => ({
      id: item.id,
      name: item.name,
      ar: [],
      al: { id: item.albumId ?? 0, name: '', picUrl: item.picUrl ?? '' },
      dt: item.duration ?? 0,
      fee: 0,
    }))
    await usePlayerStore.getState().initQueue(songs, 0, 'cached-audio')
    toast.success(i18n._(msg`开始播放缓存音乐`))
  }

  useEffect(() => {
    settingsPanelsRef.current?.scrollTo({ top: 0 })
  }, [activeTab])

  return (
    <div className="settings-page mx-auto max-w-[1200px] px-8 pb-4 pt-7 max-md:px-5">
      {/* <div>
        <h1 className="headline-lg flex items-center gap-2">
          <Settings2 className="h-5 w-5 text-accent" />
          <Trans>设置</Trans>
        </h1>
        <p className="mt-1.5 text-[12px] text-black/35">
          <Trans>管理外观、播放、缓存与桌面功能</Trans>
        </p>
      </div> */}

      <div className="settings-shell mt-6">
        <SettingsNav
          active={activeTab}
          query={settingsQuery}
          onQueryChange={setSettingsQuery}
          onSelect={setActiveTab}
        />
        <div
          ref={settingsPanelsRef}
          className="settings-panels"
          data-active={activeTab}
        >
          <div className="grid gap-5">
        <section className="apple-card p-5 sm:p-6" data-settings-section="general">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-[14px] font-semibold text-black/80">
                <PaletteIcon className="h-4 w-4 text-accent" />
                <Trans>外观</Trans>
              </h2>
            </div>
            <div className="flex shrink-0 items-center rounded-full border border-black/8 bg-black/4 p-0.5">
              <button
                type="button"
                onClick={() => setTheme('light')}
                aria-pressed={theme === 'light'}
                className={`pressable flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] transition-colors ${
                  theme === 'light'
                    ? 'bg-white text-black/75 shadow-sm dark:bg-white/15 dark:text-white'
                    : 'text-black/40 hover:text-black/65 dark:text-white/45 dark:hover:text-white/80'
                }`}
              >
                <Sun className="h-3 w-3" />
                <Trans>浅色</Trans>
              </button>
              <button
                type="button"
                onClick={() => setTheme('dark')}
                aria-pressed={theme === 'dark'}
                className={`pressable flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] transition-colors ${
                  theme === 'dark'
                    ? 'bg-white text-black/75 shadow-sm dark:bg-white/15 dark:text-white'
                    : 'text-black/40 hover:text-black/65 dark:text-white/45 dark:hover:text-white/80'
                }`}
              >
                <Moon className="h-3 w-3" />
                <Trans>深色</Trans>
              </button>
            </div>
          </div>

          <div className="mt-6">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[12px] font-medium text-black/65">
                <Trans>配色方案</Trans>
              </p>
              <span className="text-[10.5px] text-black/30">
                <Trans>点击色点立即切换</Trans>
              </span>
            </div>
            <div
              className="settings-palette-grid mt-3"
              role="group"
              aria-label={i18n._(msg`配色方案`)}
            >
              {PALETTE_OPTIONS.map((option) => {
                const selected = palette === option.id
                const preview = theme === 'dark' ? option.dark : option.light
                return (
                  <button
                    key={option.id}
                    type="button"
                    title={option.description}
                    aria-pressed={selected}
                    onClick={() => setPalette(option.id)}
                    className={`group flex min-w-0 flex-col items-center gap-2 rounded-xl border px-2 py-3 transition-colors ${
                      selected
                        ? 'border-accent/25 bg-accent/5'
                        : 'border-transparent hover:bg-black/4 dark:hover:bg-white/5'
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-black/10 transition-transform duration-200 group-hover:scale-105 dark:border-white/15"
                      style={{
                        backgroundColor: preview.accent,
                        boxShadow: selected
                          ? `inset 0 1px 2px rgba(255,255,255,0.4), 0 4px 10px -4px rgba(0,0,0,0.35), 0 0 0 2px var(--app-card), 0 0 0 4px ${preview.accent}66, 0 0 18px ${preview.accent}55`
                          : 'inset 0 1px 2px rgba(255,255,255,0.4), 0 4px 10px -4px rgba(0,0,0,0.3)',
                      }}
                    >
                      {selected ? (
                        <Check
                          className="h-4 w-4 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)]"
                          strokeWidth={2.5}
                        />
                      ) : null}
                    </span>
                    <span
                      className={`min-w-0 max-w-full truncate text-[11px] ${
                        selected
                          ? 'font-medium text-black/80'
                          : 'text-black/55'
                      }`}
                    >
                      {option.label}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="mt-5 divide-y divide-[var(--app-border)] overflow-hidden rounded-xl border border-[var(--app-border)] bg-black/[0.018] dark:bg-white/[0.025]">
            <div className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-black/75">
                  <Trans>WebGL 雾化背景</Trans>
                </p>
                <p className="mt-1 max-w-[560px] text-[11px] leading-relaxed text-black/40">
                  <Trans>
                    默认使用轻量的 CSS 动态渐变；开启后在歌曲详情页使用 GPU 绘制封面色彩雾气，不支持 WebGL 时自动回退。
                  </Trans>
                </p>
              </div>
              <Switch
                checked={fogBackdrop}
                onChange={setFogBackdrop}
                aria-label={i18n._(msg`WebGL 雾化背景`)}
              />
            </div>

            <div className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-black/75">
                  <Trans>播放页过渡动画</Trans>
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-black/40">
                  <Trans>进入和离开歌曲详情页时使用的动画效果。</Trans>
                </p>
              </div>
              <Select
                value={nowPlayingTransition}
                onChange={(event) =>
                  setNowPlayingTransition(
                    event.target.value as NowPlayingTransition,
                  )
                }
                options={NOW_PLAYING_TRANSITION_OPTIONS.map((option) => ({
                  value: option.value,
                  label: i18n._(option.label),
                }))}
                className="w-[160px] shrink-0 text-[12px]"
              />
            </div>

            <div className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-[13px] font-medium text-black/75">
                  <Languages className="h-3.5 w-3.5 text-accent" />
                  <span>语言 / Language</span>
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-black/40">
                  <Trans>切换界面语言，语言资源加载后立即生效。</Trans>
                </p>
              </div>
              <Select
                value={locale}
                onChange={(event) =>
                  setLocale(event.target.value as Locale)
                }
                options={locales.map((item) => ({
                  value: item.value,
                  label: item.label,
                }))}
                className="w-[160px] shrink-0 text-[12px]"
              />
            </div>
          </div>
        </section>

        <section className="apple-card p-6" data-settings-section="playback">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="flex items-center gap-2 text-[14px] font-semibold text-black/80">
                <Headphones className="h-4 w-4 text-accent" />
                <Trans>播放</Trans>
              </h2>
              <p className="mt-1 max-w-[560px] text-[12px] leading-relaxed text-black/40">
                <Trans>
                  调整歌曲详情页的唱片样式，并让不同歌曲以更接近的响度播放。
                </Trans>
              </p>
            </div>
          </div>

          <div className="mt-5">
            <p className="text-[13px] font-medium text-black/75">
              <Trans>播放器样式</Trans>
            </p>
            <p className="mt-1 max-w-[560px] text-[11px] leading-relaxed text-black/40">
              <Trans>选择歌曲详情页的封面呈现方式，立即生效。</Trans>
            </p>
            <PlayerStylePicker />
          </div>

          <div className="mt-5 flex items-center justify-between gap-4 border-t border-[var(--app-border)] pt-4">
            <div>
              <p className="text-[13px] font-medium text-black/75">
                <Trans>音量均衡</Trans>
              </p>
              <p className="mt-1 max-w-[560px] text-[11px] leading-relaxed text-black/40">
                <Trans>
                  实时分析播放响度，自动压低过响的部分并补足偏轻的歌曲，减少切歌时的音量跳变。部分设备或受保护音源可能无法分析。
                </Trans>
              </p>
            </div>
            <Switch
              checked={volumeNormalization}
              onChange={setVolumeNormalization}
              aria-label={i18n._(msg`音量均衡`)}
            />
          </div>
        </section>

        {desktop ? (
          <section className="apple-card p-5 sm:p-6" data-settings-section="playback">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="flex items-center gap-2 text-[14px] font-semibold text-black/80 dark:text-white/85">
                  <WandSparkles className="h-4 w-4 text-accent" />
                  <Trans>智能伴奏 · Spleeter</Trans>
                </h2>
                <p className="mt-1 max-w-[620px] text-[11px] leading-relaxed text-black/40 dark:text-white/45">
                  <Trans>
                    安装本地 Spleeter 后，可在歌曲详情页生成并切换原曲、人声或伴奏，结果会缓存到本机。
                  </Trans>
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-medium ${
                  spleeterStatus?.available
                    ? 'bg-emerald-500/10 text-emerald-700'
                    : spleeterStatus?.install?.installing
                      ? 'bg-accent/10 text-accent'
                      : 'bg-black/5 text-black/40'
                }`}
              >
                {spleeterStatus?.available
                  ? i18n._(msg`Spleeter 已就绪`)
                  : spleeterStatus?.install?.installing
                    ? i18n._(msg`正在安装`)
                    : i18n._(msg`未安装`)}
              </span>
            </div>

            <div className="mt-4">
              <label className="flex flex-col gap-1.5">
                <span className="text-[10.5px] font-medium text-black/50 dark:text-white/55">
                  <Trans>下载代理</Trans>
                </span>
                <input
                  value={spleeterProxyUrl}
                  onChange={(event) =>
                    setSpleeterProxyUrl(event.target.value)
                  }
                  placeholder="http://127.0.0.1:7890"
                  className="h-8 w-full max-w-[420px] rounded-lg border border-[var(--app-border)] bg-[var(--app-card)] px-2 text-[11px] text-black/72 outline-none transition-colors focus:border-accent/50 dark:bg-white/[0.04] dark:text-white/72"
                />
                <span className="text-[10px] leading-relaxed text-black/35 dark:text-white/40">
                  <Trans>
                    用于 Python、pip 和 FFprobe 下载。留空则直连；例如 Clash 的 http://127.0.0.1:7890。
                  </Trans>
                </span>
              </label>
            </div>

            <div className="mt-4 rounded-xl border border-[var(--app-border)] bg-black/[0.018] p-4 dark:bg-white/[0.025]">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-[12px] font-medium text-black/75 dark:text-white/80">
                    Python 3.9 · TensorFlow 2.9 · Spleeter 2.4
                  </p>
                  <p className="mt-1 text-[10.5px] leading-relaxed text-black/40 dark:text-white/45">
                    <Trans>
                      安装约 1 GB，需要联网，通常耗时数分钟。模型会在第一次生成伴奏时下载。
                    </Trans>
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {!spleeterStatus?.available ||
                  !spleeterStatus.venvInInstallRoot ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={spleeterBusy || spleeterStatus?.install?.installing}
                      disabled={spleeterStatus?.install?.installing}
                      onClick={() => void handleInstallSpleeter()}
                    >
                      {spleeterStatus?.available
                        ? i18n._(msg`安装到当前目录`)
                        : i18n._(msg`一键安装 Spleeter`)}
                    </Button>
                  ) : null}
                </div>
              </div>

              <div className="mt-3 rounded-lg border border-[var(--app-border)] bg-black/[0.02] p-2.5 dark:bg-white/[0.025]">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-[10px] font-medium text-black/45 dark:text-white/50">
                      <Trans>安装目录</Trans>
                    </p>
                    <p
                      className="mt-0.5 truncate font-mono text-[10.5px] text-black/65 dark:text-white/65"
                      title={spleeterStatus?.installRoot}
                    >
                      {spleeterStatus?.installRoot ||
                        i18n._(msg`正在读取…`)}
                    </p>
                    <p className="mt-0.5 text-[9.5px] text-black/32 dark:text-white/35">
                      <Trans>
                        默认安装到应用所在目录下的 spleeter-runtime
                      </Trans>
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {spleeterStatus?.customInstallRoot ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void handleResetSpleeterDir()}
                      >
                        <Trans>恢复默认</Trans>
                      </Button>
                    ) : null}
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={spleeterPicking}
                      onClick={() => void handlePickSpleeterDir()}
                    >
                      <Trans>更改目录</Trans>
                    </Button>
                  </div>
                </div>
              </div>

              <div className="mt-3 rounded-lg border border-[var(--app-border)] bg-black/[0.02] p-2.5 dark:bg-white/[0.025]">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-[10px] font-medium text-black/45 dark:text-white/50">
                      <Trans>伴奏保存目录</Trans>
                    </p>
                    <p
                      className="mt-0.5 truncate font-mono text-[10.5px] text-black/65 dark:text-white/65"
                      title={spleeterStatus?.libraryRoot}
                    >
                      {spleeterStatus?.libraryRoot ||
                        i18n._(msg`正在读取…`)}
                    </p>
                    <p className="mt-0.5 text-[9.5px] text-black/32 dark:text-white/35">
                      <Trans>
                        每首歌生成独立文件夹，默认在应用目录下的 spleeter-library
                      </Trans>
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {spleeterStatus?.customLibraryRoot ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void handleResetLibraryDir()}
                      >
                        <Trans>恢复默认</Trans>
                      </Button>
                    ) : null}
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={libraryPicking}
                      onClick={() => void handlePickLibraryDir()}
                    >
                      <Trans>更改目录</Trans>
                    </Button>
                  </div>
                </div>
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5">
                  <span className="text-[10.5px] font-medium text-black/50 dark:text-white/55">
                    <Trans>输出格式</Trans>
                  </span>
                  <Select
                    value={spleeterCodec}
                    onChange={(event) =>
                      setSpleeterCodec(
                        event.target.value as typeof spleeterCodec,
                      )
                    }
                    options={SPLEETER_CODEC_OPTIONS.map((option) => ({
                      value: option.value,
                      label: option.label,
                    }))}
                    className="w-full text-[11px]"
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[10.5px] font-medium text-black/50 dark:text-white/55">
                    <Trans>输出码率</Trans>
                  </span>
                  <Select
                    value={spleeterBitrate}
                    disabled={
                      spleeterCodec === 'wav' || spleeterCodec === 'flac'
                    }
                    onChange={(event) =>
                      setSpleeterBitrate(
                        event.target.value as typeof spleeterBitrate,
                      )
                    }
                    options={SPLEETER_BITRATE_OPTIONS.map((option) => ({
                      value: option.value,
                      label: option.label,
                    }))}
                    className="w-full text-[11px]"
                  />
                </label>
              </div>
              <p className="mt-2 text-[10px] leading-relaxed text-black/35 dark:text-white/40">
                {spleeterCodec === 'wav'
                  ? i18n._(msg`WAV 为未压缩 PCM，两条音轨约 70–100 MB/首。`)
                  : spleeterCodec === 'flac'
                    ? i18n._(msg`FLAC 为无损压缩，两条音轨约 40–60 MB/首。`)
                    : i18n._(msg`有损压缩，两条音轨合计约 6–14 MB/首。`)}
                {' '}
                <Trans>修改后仅影响之后新生成的伴奏，已缓存音轨不会重新编码。</Trans>
              </p>

              {spleeterStatus?.venv ? (
                <p
                  className="mt-3 truncate rounded-lg bg-black/[0.035] px-2.5 py-1.5 text-[10.5px] text-black/45 dark:bg-white/[0.045] dark:text-white/50"
                  title={spleeterStatus.venv}
                >
                  {spleeterStatus.venv}
                </p>
              ) : null}

              {spleeterStatus?.install?.installing ? (
                <div className="mt-3">
                  <div className="mb-1.5 flex items-center justify-between text-[10.5px] text-black/45 dark:text-white/50">
                    <span className="truncate">
                      {spleeterStatus.install.log || i18n._(msg`准备安装…`)}
                    </span>
                    <span>{spleeterStatus.install.progress}%</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-black/8">
                    <div
                      className="h-full rounded-full bg-accent transition-[width] duration-300"
                      style={{ width: `${spleeterStatus.install.progress}%` }}
                    />
                  </div>
                </div>
              ) : spleeterError || spleeterStatus?.install?.error ? (
                <p className="mt-3 text-[10.5px] text-amber-700">
                  {spleeterError || spleeterStatus?.install?.error}
                </p>
              ) : spleeterStatus?.available ? (
                <p className="mt-3 text-[10.5px] text-emerald-700">
                  <Trans>
                    智能模式可在歌曲详情页的心动模式按钮旁开启。生成过的伴奏会自动缓存。
                  </Trans>
                </p>
              ) : (
                <p className="mt-3 text-[10.5px] text-black/40">
                  {spleeterStatus?.note || i18n._(msg`正在检查运行环境…`)}
                </p>
              )}
            </div>
          </section>
        ) : null}

        <section className="apple-card p-6" data-settings-section="cache">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="flex items-center gap-2 text-[14px] font-semibold text-black/80">
                <HardDrive className="h-4 w-4 text-accent" />
                <Trans>音乐缓存</Trans>
              </h2>
              <p className="mt-1 max-w-[560px] text-[12px] leading-relaxed text-black/40">
                <Trans>
                  播放过的歌曲会转码为 Opus 并缓存到本地，用于加速之后的播放。修改品质只影响之后缓存的新歌曲，
                  已缓存的歌曲保持原品质。
                </Trans>
              </p>
            </div>
            <button
              type="button"
              aria-label={i18n._(msg`刷新缓存信息`)}
              title={i18n._(msg`刷新`)}
              onClick={() => void loadCache()}
              className="pressable flex h-7 w-7 flex-none items-center justify-center rounded-full text-black/35 transition-colors hover:bg-black/5 hover:text-black/70 max-md:h-10 max-md:w-10"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-[1fr_1fr_180px]">
            <div>
              <p className="mb-1.5 text-[11px] text-black/40">
                <Trans>缓存品质</Trans>
              </p>
              <Select
                value={String(cacheBitrate)}
                onChange={(event) => setCacheBitrate(Number(event.target.value))}
                options={CACHE_QUALITY_OPTIONS.map((option) => ({
                  value: option.value,
                  label: i18n._(option.label),
                }))}
                className="text-[12px]"
              />
              <p className="mt-2 text-[11px] leading-relaxed text-black/30">
                <Trans>
                  约 64kbps ≈ 1.9MB / 4 分钟，96kbps ≈ 2.9MB，128kbps ≈ 3.8MB。
                </Trans>
              </p>
            </div>
            <div>
              <p className="mb-1.5 text-[11px] text-black/40">
                <Trans>最大缓存容量</Trans>
              </p>
              <Select
                value={String(cacheMaxMb)}
                onChange={(event) => {
                  const next = Number(event.target.value)
                  setCacheMaxMb(next)
                  void trimAudioCacheToLimit(next)
                    .then(() => loadCache())
                    .catch(() => undefined)
                }}
                options={CACHE_MAX_MB_OPTIONS.map((mb) => ({
                  value: String(mb),
                  label: `${mb} MB`,
                }))}
                className="text-[12px]"
              />
              <p className="mt-2 text-[11px] leading-relaxed text-black/30">
                <Trans>默认 200 MB，超出后按缓存时间从旧到新清理。</Trans>
              </p>
            </div>
            <div className="rounded-[14px] border border-[var(--app-border)] bg-[var(--app-card)] px-4 py-3">
              <p className="text-[11px] text-black/40">
                <Trans>当前缓存</Trans>
              </p>
              <p className="mt-1 text-[18px] font-semibold leading-tight text-black/80">
                {loading ? '…' : <Trans>{items.length} 首</Trans>}
              </p>
              <p className="text-[11px] text-black/35">
                {loading ? (
                  <Trans>正在读取…</Trans>
                ) : (
                  <Trans>占用 {formatBytes(totalBytes)}</Trans>
                )}
              </p>
            </div>
          </div>

          {desktop ? (
            <div className="mt-4 flex items-center gap-3 rounded-[14px] border border-[var(--app-border)] bg-[var(--app-card)] px-4 py-3">
              <FolderOpen className="h-4 w-4 flex-none text-accent" />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] text-black/40">
                  <Trans>下载目录</Trans>
                </p>
                <p className="mt-0.5 truncate text-[12px] text-black/70" title={downloadDir}>
                  {downloadDir || i18n._(msg`正在读取…`)}
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                loading={pickingDir}
                onClick={() => void handlePickDir()}
              >
                <Trans>选择文件夹</Trans>
              </Button>
              <Button variant="secondary" size="sm" onClick={() => void handleOpenDir()}>
                <Trans>打开</Trans>
              </Button>
            </div>
          ) : null}

          {desktop ? (
            <div className="mt-2 flex items-center gap-3 rounded-[14px] border border-[var(--app-border)] bg-[var(--app-card)] px-4 py-3">
              <HardDrive className="h-4 w-4 flex-none text-accent" />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] text-black/40">
                  <Trans>缓存目录</Trans>
                </p>
                <p className="mt-0.5 truncate text-[12px] text-black/70" title={cacheDir}>
                  {cacheDir || i18n._(msg`正在读取…`)}
                </p>
              </div>
              {canPickCacheDir ? (
                <Button
                  variant="secondary"
                  size="sm"
                  loading={pickingCacheDir}
                  onClick={() => void handlePickCacheDir()}
                >
                  <Trans>选择文件夹</Trans>
                </Button>
              ) : null}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void handleOpenCacheDir()}
              >
                <Trans>打开</Trans>
              </Button>
            </div>
          ) : null}
        </section>

        <section className="apple-card p-6" data-settings-section="playback">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="flex items-center gap-2 text-[14px] font-semibold text-black/80">
                <RefreshCw className="h-4 w-4 text-accent" />
                <Trans>音源匹配</Trans>
              </h2>
              <p className="mt-1 max-w-[560px] text-[12px] leading-relaxed text-black/40">
                <Trans>
                  VIP 歌曲无法播放或仅能试听时，自动尝试匹配其他音源；也可以在底部播放条点击
                  「切换其他音源」手动替换。
                </Trans>
              </p>
            </div>
            <Switch
              checked={autoReplaceVipSource}
              onChange={setAutoReplaceVipSource}
              aria-label={i18n._(msg`VIP 歌曲自动替换音源`)}
            />
          </div>
        </section>

        <section className="apple-card p-6" data-settings-section="playback">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="flex items-center gap-2 text-[14px] font-semibold text-black/80">
                <ListMusic className="h-4 w-4 text-accent" />
                <Trans>听歌打卡</Trans>
              </h2>
              <p className="mt-1 max-w-[560px] text-[12px] leading-relaxed text-black/40">
                <Trans>
                  开启后，真实播放达到歌曲的 50% 或 4 分钟后，向网易云上报一次听歌记录。默认关闭。
                </Trans>
              </p>
            </div>
            <Switch
              checked={autoScrobble}
              onChange={setAutoScrobble}
              aria-label={i18n._(msg`听歌打卡`)}
            />
          </div>
        </section>

        {desktop ? (
          <section className="apple-card p-6" data-settings-section="desktop">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="flex items-center gap-2 text-[14px] font-semibold text-black/80">
                  <Shield className="h-4 w-4 text-accent" />
                  <Trans>桌面端</Trans>
                </h2>
                <p className="mt-1 max-w-[560px] text-[12px] leading-relaxed text-black/40">
                  <Trans>
                    禁用后，右键菜单与 F12 / Ctrl+Shift+I 等入口不再打开开发者工具。
                    当前窗口立即生效，WebView2 层面需要重启应用。
                  </Trans>
                </p>
              </div>
              <Switch
                checked={disableDevTools}
                onChange={handleToggleDevTools}
                aria-label={i18n._(msg`禁用开发者工具`)}
              />
            </div>
            <p className="mt-4 rounded-[10px] bg-black/4 px-3 py-2 text-[11px] leading-relaxed text-black/40">
              <Trans>
                桌面歌词：Ctrl / ⌘ + Shift + L 显示或隐藏，窗口始终置顶，可拖动到任意位置。
              </Trans>
            </p>
          </section>
        ) : null}

        <section className="apple-card overflow-hidden" data-settings-section="cache">
          <div className="flex items-center justify-between gap-3 border-b border-black/6 px-6 py-4">
            <div>
              <h2 className="flex items-center gap-2 text-[14px] font-semibold text-black/80">
                <ListMusic className="h-4 w-4 text-accent" />
                <Trans>缓存列表</Trans>
              </h2>
              <p className="mt-1 text-[11px] text-black/35">
                {loading ? (
                  <Trans>正在读取缓存…</Trans>
                ) : (
                  <Trans>
                    {items.length} 首 · {formatBytes(totalBytes)}
                  </Trans>
                )}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<Play className="h-3.5 w-3.5" />}
                disabled={!items.length || loading || downloading}
                onClick={() => void handlePlayAll()}
              >
                <Trans>播放全部</Trans>
              </Button>
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<Download className="h-3.5 w-3.5" />}
                loading={downloading}
                disabled={!selected.length || loading}
                onClick={() => void handleDownloadSelected()}
              >
                {selected.length ? (
                  <Trans>下载选中 ({selected.length})</Trans>
                ) : (
                  <Trans>下载选中</Trans>
                )}
              </Button>
            </div>
          </div>

          {!loading && items.length === 0 ? (
            <div className="px-6 py-12 text-center text-[12px] text-black/30">
              <Trans>暂无缓存音乐，播放歌曲后会自动缓存</Trans>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 border-b border-black/6 bg-black/[0.015] px-6 py-2">
                <input
                  type="checkbox"
                  aria-label={i18n._(msg`全选`)}
                  checked={allSelected}
                  disabled={!items.length || loading}
                  onChange={toggleAll}
                  className="h-3.5 w-3.5 accent-accent"
                />
                <span className="text-[11px] text-black/40">
                  <Trans>全选</Trans>
                </span>
                <span className="ml-auto text-[11px] text-black/30">
                  <Trans>已选 {selected.length} 首</Trans>
                </span>
              </div>

              <ul className="max-h-[min(46vh,360px)] overflow-y-auto overscroll-contain [scrollbar-width:thin]">
                {items.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center gap-3 border-b border-black/5 px-6 py-2.5 last:border-b-0 hover:bg-black/[0.02]"
                  >
                    <input
                      type="checkbox"
                      aria-label={`选择 ${item.name}`}
                      checked={selected.includes(item.id)}
                      onChange={() => toggleOne(item.id)}
                      className="h-3.5 w-3.5 flex-none accent-accent"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12.5px] font-medium text-black/80">
                        {item.name}
                      </p>
                      <p className="mt-0.5 truncate text-[11px] text-black/35">
                        {item.artists || i18n._(msg`未知歌手`)}
                        {item.bitrate ? ` · ${item.bitrate}kbps` : ''}
                        <span className="mx-1.5 text-black/15">·</span>
                        {formatDate(item.createdAt)}
                      </p>
                    </div>
                    <span className="w-12 flex-none text-right text-[11.5px] tabular-nums text-black/45">
                      {item.duration ? formatDuration(item.duration) : '--:--'}
                    </span>
                    <span className="w-16 flex-none text-right text-[11px] tabular-nums text-black/35">
                      {formatBytes(item.size)}
                    </span>
                    <button
                      type="button"
                      aria-label={`下载 ${item.name}`}
                      title={i18n._(msg`下载到本地`)}
                      disabled={downloadingId !== null}
                      onClick={() => void handleDownloadOne(item)}
                      className="pressable flex h-7 w-7 flex-none items-center justify-center rounded-full text-black/35 transition-colors hover:bg-black/5 hover:text-accent disabled:cursor-not-allowed disabled:opacity-40 max-md:h-10 max-md:w-10"
                    >
                      {downloadingId === item.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Download className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-black/6 px-6 py-3">
            <p className="text-[11px] leading-relaxed text-black/30">
              {desktop
                ? (
                  <Trans>下载会保存为 .opus 文件到上方设置的下载目录。</Trans>
                ) : (
                  <Trans>
                    下载会导出为 .opus 文件；多选下载会打包为一个 ZIP 压缩包。
                  </Trans>
                )}
            </p>
            <Button
              variant={confirmingClear ? 'destructive' : 'secondary'}
              size="sm"
              leftIcon={<Trash2 className="h-3.5 w-3.5" />}
              loading={clearing}
              disabled={!items.length || loading || downloading}
              onClick={() => void handleClear()}
            >
              {confirmingClear ? <Trans>确认清除？</Trans> : <Trans>清除缓存</Trans>}
            </Button>
          </div>
        </section>

        <section className="apple-card p-6" data-settings-section="desktop">
          <h2 className="flex items-center gap-2 text-[14px] font-semibold text-black/80">
            <Keyboard className="h-4 w-4 text-accent" />
            <Trans>快捷键</Trans>
            </h2>
          <p className="mt-1 text-[12px] leading-relaxed text-black/40">
            <Trans>在页面任意位置可用（输入框内保留系统默认行为）。</Trans>
          </p>
          <dl className="mt-4 grid gap-2 sm:grid-cols-2">
            {SHORTCUTS.map((shortcut) => (
              <div
                key={shortcut.label.id}
                className="flex items-center justify-between gap-3 rounded-[10px] bg-black/4 px-3 py-2"
              >
                <dt className="text-[12px] text-black/55">
                  {i18n._(shortcut.label)}
                </dt>
                <dd className="flex shrink-0 items-center gap-1">
                  {shortcut.keys.map((key) => {
                    const label = typeof key === 'string' ? key : i18n._(key)
                    return (
                      <kbd
                        key={label}
                        className="rounded-[6px] border border-black/10 bg-white px-1.5 py-0.5 text-[11px] font-medium text-black/60"
                      >
                        {label}
                      </kbd>
                    )
                  })}
                </dd>
              </div>
            ))}
          </dl>
        </section>
          </div>
        </div>
      </div>
    </div>
  )
}
