import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
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
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Select,
} from '@pikoloo/darwin-ui'
import {
  CACHE_MAX_MB_OPTIONS,
  CACHE_QUALITY_OPTIONS,
  CROSSFADE_DURATION_OPTIONS,
  NOW_PLAYING_TRANSITION_OPTIONS,
  BACKDROP_STYLE_OPTIONS,
  type BackdropStyle,
  useSettingsStore,
  type NowPlayingTransition,
} from '../store/settings'
import { useUiStore } from '../store/ui'
import { PALETTE_OPTIONS } from '../lib/theme'
import {
  SettingsNav,
  type SettingsTab,
} from '../components/settings/SettingsNav'
import { ToggleSwitch } from '../components/common/ToggleSwitch'
import { SearchInput } from '../components/common/SearchInput'
import { PlayerStylePicker } from '../components/settings/PlayerStylePicker'
import { RemoteControlCard } from '../components/settings/RemoteControlCard'
import { UpdateCard } from '../components/settings/UpdateCard'
import { YtDlpCard } from '../components/settings/YtDlpCard'
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
  uninstallSpleeter,
  type SpleeterStatus,
} from '../lib/spleeter'
import {
  getDownloadDir,
  isDesktopApp,
  openDownloadDir,
  pickDownloadDir,
} from '../lib/desktopDownloads'
import { getDevToolsPolicy, setDevToolsPolicy } from '../lib/desktopBridge'
import { clearCachedStems } from '../lib/smartStemCache'
import { locales, type Locale } from '../i18n'
import { formatDate, formatDuration, matchesKeyword } from '../lib/format'
import { useDocumentTitle } from '../lib/title'
import { toast } from '../lib/toast'

import { PageHeader } from '../components/common/PageHeader'
export const Route = createFileRoute('/settings')({
  validateSearch: (search: Record<string, unknown>) => {
    const tab = search.tab
    return {
      tab:
        tab === 'general' ||
        tab === 'playback' ||
        tab === 'cache' ||
        tab === 'desktop'
          ? (tab as SettingsTab)
          : ('general' as SettingsTab),
    }
  },
  component: SettingsPage,
})

type ShortcutKey = string | MessageDescriptor

const SHORTCUTS: Array<{ keys: ShortcutKey[]; label: MessageDescriptor }> = [
  { keys: [msg`空格`], label: msg`播放 / 暂停` },
  { keys: ['Alt', '↑ / ↓'], label: msg`音量 +5 / -5` },
  { keys: ['Shift', 'Alt', '↑ / ↓'], label: msg`音量 +1 / -1` },
  { keys: ['← / →'], label: msg`快退 / 快进 5 秒` },
  { keys: ['Ctrl / ⌘', '← / →'], label: msg`上一首 / 下一首` },
  { keys: ['M'], label: msg`静音 / 取消静音` },
  { keys: ['L'], label: msg`喜欢 / 取消喜欢当前歌曲` },
  { keys: ['↑ / ↓', 'Enter'], label: msg`在搜索建议中选择并进入` },
  { keys: ['Esc'], label: msg`关闭播放页、播放列表、侧栏或搜索建议` },
]

function formatBytes(bytes: number) {
  if (!bytes) return '0 MB'
  const mb = bytes / (1024 * 1024)
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

const SPLEETER_CODEC_OPTIONS = [
  { value: 'm4a', label: msg`M4A / AAC（推荐）` },
  { value: 'ogg', label: msg`OGG / Vorbis` },
  { value: 'mp3', label: msg`MP3` },
  { value: 'flac', label: msg`FLAC（无损）` },
  { value: 'wav', label: msg`WAV（未压缩）` },
] as const

const SPLEETER_BITRATE_OPTIONS = [
  { value: '128k', label: msg`128 kbps（更小）` },
  { value: '192k', label: msg`192 kbps（推荐）` },
  { value: '256k', label: msg`256 kbps` },
  { value: '320k', label: msg`320 kbps（最高）` },
] as const

function SettingsPage() {
  const { i18n } = useLingui()
  const navigate = useNavigate()
  const search = Route.useSearch()
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
  const preferUnblockSource = useSettingsStore(
    (state) => state.preferUnblockSource,
  )
  const setPreferUnblockSource = useSettingsStore(
    (state) => state.setPreferUnblockSource,
  )
  const locale = useSettingsStore((state) => state.locale)
  const setLocale = useSettingsStore((state) => state.setLocale)
  const [activeTab, setActiveTab] = useState<SettingsTab>(search.tab)
  useEffect(() => {
    setActiveTab(search.tab)
  }, [search.tab])
  const [settingsQuery, setSettingsQuery] = useState('')
  const [items, setItems] = useState<CachedAudioItem[]>([])
  const [cacheQuery, setCacheQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const settingsPanelsRef = useRef<HTMLDivElement>(null)
  // Selection holds cache keys: one song can have several cached versions.
  const [selected, setSelected] = useState<string[]>([])
  const [clearing, setClearing] = useState(false)
  const [confirmingClear, setConfirmingClear] = useState(false)
  const clearConfirmTimer = useRef<number | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
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
  const [uninstallOpen, setUninstallOpen] = useState(false)
  const [uninstalling, setUninstalling] = useState(false)
  const [clearingStems, setClearingStems] = useState(false)
  const [spleeterError, setSpleeterError] = useState('')
  const disableDevTools = useSettingsStore((state) => state.disableDevTools)
  const setDisableDevTools = useSettingsStore((state) => state.setDisableDevTools)
  const theme = useUiStore((state) => state.theme)
  const setTheme = useUiStore((state) => state.setTheme)
  const palette = useUiStore((state) => state.palette)
  const setPalette = useUiStore((state) => state.setPalette)
  const sidebarAutoCollapse = useUiStore((state) => state.sidebarAutoCollapse)
  const setSidebarAutoCollapse = useUiStore((state) => state.setSidebarAutoCollapse)
  const backdropStyle = useSettingsStore((state) => state.backdropStyle)
  const setBackdropStyle = useSettingsStore((state) => state.setBackdropStyle)
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
  const crossfadeEnabled = useSettingsStore(
    (state) => state.crossfadeEnabled,
  )
  const setCrossfadeEnabled = useSettingsStore(
    (state) => state.setCrossfadeEnabled,
  )
  const crossfadeSeconds = useSettingsStore(
    (state) => state.crossfadeSeconds,
  )
  const setCrossfadeSeconds = useSettingsStore(
    (state) => state.setCrossfadeSeconds,
  )
  const showRemainingTime = useSettingsStore((state) => state.showRemainingTime)
  const appleLyricsEffect = useSettingsStore((state) => state.appleLyricsEffect)
  const setAppleLyricsEffect = useSettingsStore(
    (state) => state.setAppleLyricsEffect,
  )
  const setShowRemainingTime = useSettingsStore(
    (state) => state.setShowRemainingTime,
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
            // Enable the smart button without requiring a page reload. Do not
            // overwrite an in-flight generation or an already-active stem: this
            // effect polls every 2.5s and the settings route can stay mounted
            // underneath the now-playing overlay.
            useSmartStemStore.setState({ installed: true })
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

  const handleClearStems = async () => {
    if (clearingStems) return
    setClearingStems(true)
    try {
      const count = await clearCachedStems()
      toast.success(
        count
          ? i18n._(msg`已清除 ${count} 首歌曲的伴奏缓存`)
          : i18n._(msg`没有可清除的伴奏缓存`),
      )
    } catch {
      toast.error(i18n._(msg`清除伴奏缓存失败`))
    } finally {
      setClearingStems(false)
    }
  }

  const handleUninstallSpleeter = async () => {
    if (uninstalling) return
    setUninstalling(true)
    setSpleeterError('')
    try {
      const status = await uninstallSpleeter()
      setSpleeterStatus(status)
      setUninstallOpen(false)
      toast.success(i18n._(msg`Spleeter 环境已卸载`))
    } catch (error) {
      setSpleeterError(String(error))
    } finally {
      setUninstalling(false)
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
      setSelected((prev) => prev.filter((key) => list.some((item) => item.key === key)))
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

  // The cache list can hold hundreds of entries; filter by song and artist so a
  // single track stays findable without scanning the whole list.
  const filteredItems = useMemo(() => {
    if (!cacheQuery.trim()) return items
    return items.filter((item) =>
      matchesKeyword(cacheQuery, item.name, item.artists),
    )
  }, [cacheQuery, items])

  const totalBytes = useMemo(
    () => filteredItems.reduce((total, item) => total + item.size, 0),
    [filteredItems],
  )
  const allSelected =
    filteredItems.length > 0 &&
    filteredItems.every((item) => selected.includes(item.key))

  const toggleAll = () => {
    const visibleKeys = filteredItems.map((item) => item.key)
    if (allSelected) {
      setSelected((prev) => prev.filter((key) => !visibleKeys.includes(key)))
      return
    }
    setSelected((prev) => Array.from(new Set([...prev, ...visibleKeys])))
  }

  const toggleOne = (key: string) => {
    setSelected((prev) =>
      prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key],
    )
  }

  /** Cache entries behind the current selection, for export. */
  const selectedRefs = () =>
    items
      .filter((item) => selected.includes(item.key))
      .map((item) => ({ id: item.id, source: item.source }))

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
      const count = await downloadCachedAudio(selectedRefs())
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
    setDownloadingId(item.key)
    try {
      await downloadCachedAudio([{ id: item.id, source: item.source }])
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
    if (!filteredItems.length) return
    // One song may be cached from several providers; queue it once.
    const seen = new Set<number>()
    const songs = filteredItems
      .filter((item) => {
        if (seen.has(item.id)) return false
        seen.add(item.id)
        return true
      })
      .map((item) => ({
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
    <div className="page settings-page max-w-[1200px] pb-4">
      <PageHeader
        title={<Trans>设置</Trans>}
        description={<Trans>管理外观、播放、缓存与桌面功能</Trans>}
      />

      <div className="settings-shell mt-6">
        <SettingsNav
          active={activeTab}
          query={settingsQuery}
          onQueryChange={setSettingsQuery}
          onSelect={(tab) => {
            setActiveTab(tab)
            void navigate({
              to: '/settings',
              search: { tab },
              replace: true,
            })
          }}
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
              <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink-1">
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
                    ? 'bg-white text-ink-2 shadow-sm dark:bg-white/15 dark:text-white'
                    : 'text-ink-3 hover:text-ink-2 dark:text-white/45 dark:hover:text-white/80'
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
                    ? 'bg-white text-ink-2 shadow-sm dark:bg-white/15 dark:text-white'
                    : 'text-ink-3 hover:text-ink-2 dark:text-white/45 dark:hover:text-white/80'
                }`}
              >
                <Moon className="h-3 w-3" />
                <Trans>深色</Trans>
              </button>
            </div>
          </div>

          <div className="mt-6">
            <p className="text-[12px] font-medium text-ink-2">
              <Trans>配色方案</Trans>
            </p>
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
                    title={i18n._(option.description)}
                    aria-pressed={selected}
                    onClick={() => setPalette(option.id)}
                    className={`group flex min-w-0 flex-col items-center gap-1.5 rounded-[14px] border px-2 py-2 transition-colors ${
                      selected
                        ? 'border-accent/30 bg-accent/5'
                        : 'border-black/5 bg-black/[0.02] hover:bg-black/[0.045] dark:border-white/8 dark:bg-white/[0.03] dark:hover:bg-white/[0.06]'
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
                          ? 'font-medium text-ink-1'
                          : 'text-ink-2'
                      }`}
                    >
                      {i18n._(option.label)}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="mt-5 divide-y overflow-hidden settings-group">
            <div className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-ink-2">
                  <Trans>播放页背景</Trans>
                </p>
                {/* <p className="mt-1 max-w-[560px] text-[11px] leading-relaxed text-ink-3">
                  <Trans>
                    CSS 渐变最省电；WebGL 雾化用 GPU 绘制封面色彩雾气；Apple Music 是把封面扭曲、模糊后缓慢旋转的流动背景。后两种不支持 WebGL 时自动回退到 CSS 渐变。
                  </Trans>
                </p> */}
              </div>
              <Select
                value={backdropStyle}
                onChange={(event) => setBackdropStyle(event.target.value as BackdropStyle)}
                options={BACKDROP_STYLE_OPTIONS.map((option) => ({
                  value: option.value,
                  label: i18n._(option.label),
                }))}
                className="settings-select w-[160px] shrink-0"
              />
            </div>

            <div className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-ink-2">
                  <Trans>播放页过渡动画</Trans>
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
                className="settings-select w-[160px] shrink-0"
              />
            </div>

            <div className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-ink-2">
                  <Trans>窄窗口自动收起侧栏</Trans>
                </p>
              
              </div>
              <ToggleSwitch
                checked={sidebarAutoCollapse}
                onChange={setSidebarAutoCollapse}
                aria-label={i18n._(msg`窄窗口自动收起侧栏`)}
              />
            </div>

            <div className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-[13px] font-medium text-ink-2">
                  <Languages className="h-3.5 w-3.5 text-accent" />
                  <span>语言 / Language</span>
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
                className="settings-select w-[160px] shrink-0"
              />
            </div>
          </div>
        </section>

        <section className="apple-card p-6" data-settings-section="playback">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink-1">
                <Headphones className="h-4 w-4 text-accent" />
                <Trans>播放</Trans>
              </h2>
            </div>
          </div>

          <div className="mt-5">
            <p className="text-[13px] font-medium text-ink-2">
              <Trans>播放器样式</Trans>
            </p>
            <PlayerStylePicker />
          </div>

          <div className="mt-5 flex items-center justify-between gap-4 border-t settings-divider pt-4">
            <div>
              <p className="text-[13px] font-medium text-ink-2">
                <Trans>交叉渐入渐出</Trans>
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-ink-3">
                <Trans>
                  自然播放结束时上一首逐渐淡出、下一首逐渐淡入。手动切歌会立即切换。
                </Trans>
              </p>
            </div>
            <ToggleSwitch
              checked={crossfadeEnabled}
              onChange={setCrossfadeEnabled}
              aria-label={i18n._(msg`交叉渐入渐出`)}
            />
          </div>

          {crossfadeEnabled ? (
            <div className="mt-4 flex items-center justify-between gap-4">
              <p className="text-[13px] font-medium text-ink-2">
                <Trans>交叉时长</Trans>
              </p>
              <Select
                value={String(crossfadeSeconds)}
                onChange={(event) =>
                  setCrossfadeSeconds(Number(event.target.value))
                }
                options={CROSSFADE_DURATION_OPTIONS.map((option) => ({
                  value: String(option.value),
                  label: i18n._(option.label),
                }))}
                className="settings-select w-[160px] shrink-0"
              />
            </div>
          ) : null}

          <div className="mt-5 flex items-center justify-between gap-4 border-t settings-divider pt-4">
            <div>
              <p className="text-[13px] font-medium text-ink-2">
                <Trans>音量均衡</Trans>
              </p>
              <p className="mt-1  text-[11px] leading-relaxed text-ink-3">
                <Trans>
                  实时分析播放响度，自动压低过响的部分并补足偏轻的歌曲，减少切歌时的音量跳变。部分设备或受保护音源可能无法分析。
                </Trans>
              </p>
            </div>
            <ToggleSwitch
              checked={volumeNormalization}
              onChange={setVolumeNormalization}
              aria-label={i18n._(msg`音量均衡`)}
            />
          </div>

          <div className="mt-5 flex items-center justify-between gap-4 border-t settings-divider pt-4">
            <div>
              <p className="text-[13px] font-medium text-ink-2">
                <Trans>进度条显示剩余时间</Trans>
              </p>
             
            </div>
            <ToggleSwitch
              checked={showRemainingTime}
              onChange={setShowRemainingTime}
              aria-label={i18n._(msg`进度条显示剩余时间`)}
            />
          </div>

          <div className="mt-5 flex items-center justify-between gap-4 border-t settings-divider pt-4">
            <div>
              <p className="text-[13px] font-medium text-ink-2">
                <Trans>Apple Music 歌词动效</Trans>
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-ink-3">
                <Trans>
                  开启后歌词逐字柔和擦亮、长音发光、弹簧滚动，间奏显示省略点；只有整行时间的歌词按整行高亮。关闭则使用经典逐字填充效果。
                </Trans>
              </p>
            </div>
            <ToggleSwitch
              checked={appleLyricsEffect}
              onChange={setAppleLyricsEffect}
              aria-label={i18n._(msg`Apple Music 歌词动效`)}
            />
          </div>
        </section>

        {desktop ? (
          <>
          <section className="apple-card p-5 sm:p-6" data-settings-section="playback">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink-1 dark:text-white/85">
                  <WandSparkles className="h-4 w-4 text-accent" />
                  <Trans>智能伴奏 · Spleeter</Trans>
                </h2>
               
              </div>
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ${
                  spleeterStatus?.available
                    ? 'bg-emerald-500/10 text-emerald-700'
                    : spleeterStatus?.install?.installing
                      ? 'bg-accent/10 text-accent'
                      : 'bg-black/5 text-ink-3'
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
                <span className="text-[11px] font-medium text-ink-3 dark:text-white/55">
                  <Trans>下载代理</Trans>
                </span>
                <input
                  value={spleeterProxyUrl}
                  onChange={(event) =>
                    setSpleeterProxyUrl(event.target.value)
                  }
                  placeholder="http://127.0.0.1:7890"
                  className="h-8 w-full max-w-[420px] rounded-[10px] border border-[var(--app-border)] bg-[var(--app-card)] px-2 text-[11px] text-ink-2 outline-none transition-colors focus:border-accent/50 dark:bg-white/[0.04] dark:text-white/72"
                />
                <span className="text-[11px] leading-relaxed text-ink-4 dark:text-white/40">
                  <Trans>
                    用于 Python、pip 和 FFprobe 下载。留空则直连；例如 Clash 的 http://127.0.0.1:7890。
                  </Trans>
                </span>
              </label>
            </div>

            <div className="mt-4 p-4 settings-group">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-[12px] font-medium text-ink-2 dark:text-white/80">
                    Python 3.9 · TensorFlow 2.9 · Spleeter 2.4
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-ink-3 dark:text-white/45">
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
                  {spleeterStatus?.venv ||
                  spleeterStatus?.available ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={
                        spleeterStatus?.install?.installing || uninstalling
                      }
                      onClick={() => setUninstallOpen(true)}
                    >
                      <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                      <Trans>卸载 Spleeter</Trans>
                    </Button>
                  ) : null}
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={clearingStems}
                    title={i18n._(msg`最多保留最近使用的 30 首歌曲的伴奏`)}
                    onClick={() => void handleClearStems()}
                  >
                    <Trans>清除伴奏缓存</Trans>
                  </Button>
                </div>
              </div>

              <div className="mt-3 rounded-[10px] bg-black/[0.02] p-2.5 dark:bg-white/[0.025]">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium text-ink-3 dark:text-white/50">
                      <Trans>安装目录</Trans>
                    </p>
                    <p
                      className="mt-0.5 truncate font-mono text-[11px] text-ink-2 dark:text-white/65"
                      title={spleeterStatus?.installRoot}
                    >
                      {spleeterStatus?.installRoot ||
                        i18n._(msg`正在读取…`)}
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

              <div className="mt-3 rounded-[10px] bg-black/[0.02] p-2.5 dark:bg-white/[0.025]">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium text-ink-3 dark:text-white/50">
                      <Trans>伴奏保存目录</Trans>
                    </p>
                    <p
                      className="mt-0.5 truncate font-mono text-[11px] text-ink-2 dark:text-white/65"
                      title={spleeterStatus?.libraryRoot}
                    >
                      {spleeterStatus?.libraryRoot ||
                        i18n._(msg`正在读取…`)}
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
                  <span className="text-[11px] font-medium text-ink-3 dark:text-white/55">
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
                      label: i18n._(option.label),
                    }))}
                    className="settings-select w-full"
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-medium text-ink-3 dark:text-white/55">
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
                      label: i18n._(option.label),
                    }))}
                    className="settings-select w-full"
                  />
                </label>
              </div>
              {spleeterStatus?.install?.installing ? (
                <div className="mt-3">
                  <div className="mb-1.5 flex items-center justify-between text-[11px] text-ink-3 dark:text-white/50">
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
                <p className="mt-3 text-[11px] text-amber-700">
                  {spleeterError || spleeterStatus?.install?.error}
                </p>
              ) : spleeterStatus?.available ? null : (
                <p className="mt-3 text-[11px] text-ink-3">
                  {spleeterStatus?.note || i18n._(msg`正在检查运行环境…`)}
                </p>
              )}
            </div>
          </section>
          <Dialog open={uninstallOpen} onOpenChange={setUninstallOpen}>
            <DialogContent size="sm" glass>
              <DialogHeader>
                <DialogTitle>
                  <Trans>卸载 Spleeter</Trans>
                </DialogTitle>
                <DialogDescription>
                  <Trans>
                    将删除本地虚拟环境、Python 运行时以及 FFmpeg/FFprobe 组件，不会删除已经生成的伴奏文件。
                  </Trans>
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={uninstalling}
                  onClick={() => setUninstallOpen(false)}
                >
                  <Trans>取消</Trans>
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  loading={uninstalling}
                  onClick={() => void handleUninstallSpleeter()}
                >
                  <Trans>卸载</Trans>
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          </>
        ) : null}

        <section className="apple-card p-6" data-settings-section="cache">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink-1">
                <HardDrive className="h-4 w-4 text-accent" />
                <Trans>音乐缓存</Trans>
              </h2>
              {/* <p className="mt-1 max-w-[560px] text-[12px] leading-relaxed text-ink-3">
                <Trans>
                  播放过的歌曲会转码为 Opus 缓存到本地；修改品质只影响之后缓存的新歌曲，已缓存的歌曲保持原品质。
                </Trans>
              </p> */}
            </div>
            <button
              type="button"
              aria-label={i18n._(msg`刷新缓存信息`)}
              title={i18n._(msg`刷新`)}
              onClick={() => void loadCache()}
              className="pressable flex h-7 w-7 flex-none items-center justify-center rounded-full text-ink-4 transition-colors hover:bg-black/5 hover:text-ink-2 max-md:h-10 max-md:w-10"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-[1fr_1fr_180px]">
            <div>
              <p className="mb-1.5 text-[11px] text-ink-3">
                <Trans>缓存品质</Trans>
              </p>
              <Select
                value={String(cacheBitrate)}
                onChange={(event) => setCacheBitrate(Number(event.target.value))}
                options={CACHE_QUALITY_OPTIONS.map((option) => ({
                  value: option.value,
                  label: i18n._(option.label),
                }))}
                className="settings-select "
              />
              <p className="mt-2 text-[11px] leading-relaxed text-ink-4">
                <Trans>
                  约 64kbps ≈ 1.9MB / 4 分钟，96kbps ≈ 2.9MB，128kbps ≈ 3.8MB。
                </Trans>
              </p>
            </div>
            <div>
              <p className="mb-1.5 text-[11px] text-ink-3">
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
                className="settings-select "
              />
              <p className="mt-2 text-[11px] leading-relaxed text-ink-4">
                <Trans>默认 200 MB，超出后按缓存时间从旧到新清理。</Trans>
              </p>
            </div>
            <div className="rounded-[14px] border border-[var(--app-border)] bg-[var(--app-card)] px-4 py-3">
              <p className="text-[11px] text-ink-3">
                <Trans>当前缓存</Trans>
              </p>
              <p className="mt-1 text-[19px] font-semibold leading-tight text-ink-1">
                {loading ? '…' : <Trans>{items.length} 首</Trans>}
              </p>
              <p className="text-[11px] text-ink-4">
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
                <p className="text-[11px] text-ink-3">
                  <Trans>下载目录</Trans>
                </p>
                <p className="mt-0.5 truncate text-[12px] text-ink-2" title={downloadDir}>
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
                <p className="text-[11px] text-ink-3">
                  <Trans>缓存目录</Trans>
                </p>
                <p className="mt-0.5 truncate text-[12px] text-ink-2" title={cacheDir}>
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
              <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink-1">
                <RefreshCw className="h-4 w-4 text-accent" />
                <Trans>音源匹配</Trans>
              </h2>
              <p className="mt-1 max-w-[560px] text-[12px] leading-relaxed text-ink-3">
                <Trans>
                  VIP 歌曲无法播放或仅能试听时，自动尝试匹配其他音源
                </Trans>
              </p>
            </div>
            <ToggleSwitch
              checked={autoReplaceVipSource}
              onChange={setAutoReplaceVipSource}
              aria-label={i18n._(msg`VIP 歌曲自动替换音源`)}
            />
          </div>

          {autoReplaceVipSource ? (
            <div className="mt-5 flex flex-col gap-3 border-t settings-divider pt-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-ink-2">
                  <Trans>优先调用解灰接口</Trans>
                </p>
                <p className="mt-1 max-w-[720px] text-[11px] leading-relaxed text-ink-3">
                  <Trans>
                    先请求 /song/url/match，没有可用结果时再尝试官方推荐的其他可播放版本；关闭后顺序相反。
                  </Trans>
                </p>
              </div>
              <ToggleSwitch
                checked={preferUnblockSource}
                onChange={setPreferUnblockSource}
                aria-label={i18n._(msg`优先调用解灰接口`)}
              />
            </div>
          ) : null}
        </section>

        <section className="apple-card p-6" data-settings-section="playback">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink-1">
                <ListMusic className="h-4 w-4 text-accent" />
                <Trans>听歌打卡</Trans>
              </h2>
              <p className="mt-1 max-w-[560px] text-[12px] leading-relaxed text-ink-3">
                <Trans>
                  开启后，真实播放达到歌曲的 50% 或 4 分钟后，向网易云上报一次听歌记录。默认关闭。
                </Trans>
              </p>
            </div>
            <ToggleSwitch
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
                <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink-1">
                  <Shield className="h-4 w-4 text-accent" />
                  <Trans>桌面端</Trans>
                </h2>
                <p className="mt-1 max-w-[560px] text-[12px] leading-relaxed text-ink-3">
                  <Trans>
                    禁用后，右键菜单与 F12 / Ctrl+Shift+I 等入口不再打开开发者工具。
                    当前窗口立即生效，WebView2 层面需要重启应用。
                  </Trans>
                </p>
              </div>
              <ToggleSwitch
                checked={disableDevTools}
                onChange={handleToggleDevTools}
                aria-label={i18n._(msg`禁用开发者工具`)}
              />
            </div>
            <p className="mt-4 rounded-[10px] bg-black/4 px-3 py-2 text-[11px] leading-relaxed text-ink-3">
              <Trans>
                桌面歌词：Ctrl / ⌘ + Shift + L 显示或隐藏，窗口始终置顶，可拖动到任意位置。
              </Trans>
            </p>
          </section>
        ) : null}

        {/* yt-dlp only exists for the Electrobun/Tauri shells: it is a local
            binary the API server spawns. */}
        {desktop ? <YtDlpCard /> : null}

        {desktop && import.meta.env.MODE !== 'tauri' ? <UpdateCard /> : null}

        {/* Electrobun only: the Tauri shell has its own API and bridge. */}
        {desktop && import.meta.env.MODE !== 'tauri' ? <RemoteControlCard /> : null}

        <section className="apple-card overflow-hidden" data-settings-section="cache">
          <div className="border-b settings-divider px-6 py-4">
            <div>
              <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink-1">
                <ListMusic className="h-4 w-4 text-accent" />
                <Trans>缓存列表</Trans>
              </h2>
              <p className="mt-1 text-[11px] text-ink-4">
                {loading ? (
                  <Trans>正在读取缓存…</Trans>
                ) : (
                  <Trans>
                    {filteredItems.length} 首 · {formatBytes(totalBytes)}
                  </Trans>
                )}
              </p>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <SearchInput
                value={cacheQuery}
                onChange={setCacheQuery}
                placeholder={i18n._(msg`搜索缓存歌曲`)}
                ariaLabel={i18n._(msg`搜索缓存歌曲`)}
                wrapperClassName="w-[220px] shrink-0"
                className="rounded-full text-[12px]"
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  leftIcon={<Play className="h-3.5 w-3.5" />}
                  disabled={!filteredItems.length || loading || downloading}
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
          </div>

          {!loading && items.length === 0 ? (
            <div className="px-6 py-12 text-center text-[12px] text-ink-4">
              <Trans>暂无缓存音乐，播放歌曲后会自动缓存</Trans>
            </div>
          ) : !loading && filteredItems.length === 0 ? (
            <div className="px-6 py-12 text-center text-[12px] text-ink-4">
              <Trans>没有匹配的缓存歌曲</Trans>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 border-b settings-divider bg-black/[0.015] px-6 py-2">
                <input
                  type="checkbox"
                  aria-label={i18n._(msg`全选`)}
                  checked={allSelected}
                  disabled={!filteredItems.length || loading}
                  onChange={toggleAll}
                  className="h-3.5 w-3.5 accent-accent"
                />
                <span className="text-[11px] text-ink-3">
                  <Trans>全选</Trans>
                </span>
                <span className="ml-auto text-[11px] text-ink-4">
                  <Trans>已选 {selected.length} 首</Trans>
                </span>
              </div>

              <ul className="max-h-[min(46vh,360px)] overflow-y-auto overscroll-contain [scrollbar-width:thin]">
                {filteredItems.map((item) => (
                  <li
                    key={item.key}
                    className="flex items-center gap-3 border-b settings-divider px-6 py-2.5 last:border-b-0 hover:bg-black/[0.02]"
                  >
                    <input
                      type="checkbox"
                      aria-label={i18n._(msg`选择 ${item.name}`)}
                      checked={selected.includes(item.key)}
                      onChange={() => toggleOne(item.key)}
                      className="h-3.5 w-3.5 flex-none accent-accent"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium text-ink-1">
                        <span className="truncate">{item.name}</span>
                        {item.source ? (
                          <span className="shrink-0 rounded-full bg-black/5 px-1.5 py-0.5 text-[11px] font-normal text-ink-4 dark:bg-white/10 dark:text-white/45">
                            {item.source === 'copyright-rcmd'
                              ? i18n._(msg`推荐版本`)
                              : item.source}
                          </span>
                        ) : null}
                      </p>
                      <p className="mt-0.5 truncate text-[11px] text-ink-4">
                        {item.artists || i18n._(msg`未知歌手`)}
                        {item.bitrate ? ` · ${item.bitrate}kbps` : ''}
                        <span className="mx-1.5 text-ink-4">·</span>
                        {formatDate(item.createdAt)}
                      </p>
                    </div>
                    <span className="w-12 flex-none text-right text-[12px] tabular-nums text-ink-3">
                      {item.duration ? formatDuration(item.duration) : '--:--'}
                    </span>
                    <span className="w-16 flex-none text-right text-[11px] tabular-nums text-ink-4">
                      {formatBytes(item.size)}
                    </span>
                    <button
                      type="button"
                      aria-label={i18n._(msg`下载 ${item.name}`)}
                      title={i18n._(msg`下载到本地`)}
                      disabled={downloadingId !== null}
                      onClick={() => void handleDownloadOne(item)}
                      className="pressable flex h-7 w-7 flex-none items-center justify-center rounded-full text-ink-4 transition-colors hover:bg-black/5 hover:text-accent disabled:cursor-not-allowed disabled:opacity-40 max-md:h-10 max-md:w-10"
                    >
                      {downloadingId === item.key ? (
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

          <div className="flex flex-wrap items-center justify-between gap-2 border-t settings-divider px-6 py-3">
            <p className="text-[11px] leading-relaxed text-ink-4">
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
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink-1">
            <Keyboard className="h-4 w-4 text-accent" />
            <Trans>快捷键</Trans>
            </h2>
          {/* <p className="mt-1 text-[12px] leading-relaxed text-ink-3">
            <Trans>在页面任意位置可用（输入框内保留系统默认行为）。</Trans>
          </p> */}
          <dl className="mt-4 grid gap-2 sm:grid-cols-2">
            {SHORTCUTS.map((shortcut) => (
              <div
                key={shortcut.label.id}
                className="flex items-center justify-between gap-3 rounded-[10px] bg-black/4 px-3 py-2"
              >
                <dt className="text-[12px] text-ink-2">
                  {i18n._(shortcut.label)}
                </dt>
                <dd className="flex shrink-0 items-center gap-1">
                  {shortcut.keys.map((key) => {
                    const label = typeof key === 'string' ? key : i18n._(key)
                    return (
                      <kbd
                        key={label}
                        className="rounded-[6px] border border-black/10 bg-white px-1.5 py-0.5 text-[11px] font-medium text-ink-2"
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
