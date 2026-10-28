import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import {
  Download,
  FolderOpen,
  HardDrive,
  Keyboard,
  ListMusic,
  Loader2,
  RefreshCw,
  Settings2,
  Shield,
  Trash2,
} from 'lucide-react'
import { Button, Select, Switch } from '@pikoloo/darwin-ui'
import { CACHE_QUALITY_OPTIONS, useSettingsStore } from '../store/settings'
import {
  clearAudioCache,
  downloadCachedAudio,
  listCachedAudio,
  type CachedAudioItem,
} from '../lib/songCache'
import {
  getDownloadDir,
  isDesktopApp,
  openDownloadDir,
  pickDownloadDir,
} from '../lib/desktopDownloads'
import { getDevToolsPolicy, setDevToolsPolicy } from '../lib/desktopBridge'
import { formatDate, formatDuration } from '../lib/format'
import { useDocumentTitle } from '../lib/title'
import { toast } from '../lib/toast'

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
})

const SHORTCUTS: Array<{ keys: string[]; label: string }> = [
  { keys: ['空格'], label: '播放 / 暂停' },
  { keys: ['Alt', '↑ / ↓'], label: '音量 +5 / -5' },
  { keys: ['Shift', 'Alt', '↑ / ↓'], label: '音量 +1 / -1' },
  { keys: ['↑ / ↓', 'Enter'], label: '在搜索建议中选择并进入' },
  { keys: ['Esc'], label: '关闭播放页、播放列表、侧栏或搜索建议' },
]

function formatBytes(bytes: number) {
  if (!bytes) return '0 MB'
  const mb = bytes / (1024 * 1024)
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function SettingsPage() {
  useDocumentTitle('设置')
  const cacheBitrate = useSettingsStore((state) => state.cacheBitrate)
  const setCacheBitrate = useSettingsStore((state) => state.setCacheBitrate)
  const autoReplaceVipSource = useSettingsStore((state) => state.autoReplaceVipSource)
  const setAutoReplaceVipSource = useSettingsStore(
    (state) => state.setAutoReplaceVipSource,
  )
  const [items, setItems] = useState<CachedAudioItem[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<number[]>([])
  const [clearing, setClearing] = useState(false)
  const [confirmingClear, setConfirmingClear] = useState(false)
  const clearConfirmTimer = useRef<number | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [downloadingId, setDownloadingId] = useState<number | null>(null)
  const desktop = isDesktopApp()
  const [downloadDir, setDownloadDir] = useState('')
  const [pickingDir, setPickingDir] = useState(false)
  const disableDevTools = useSettingsStore((state) => state.disableDevTools)
  const setDisableDevTools = useSettingsStore((state) => state.setDisableDevTools)

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
        ? '已禁用开发者工具，重启应用后完全生效'
        : '已允许开发者工具，重启应用后完全生效',
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
      toast.success('缓存音乐已清除')
    } catch {
      toast.error('清除缓存失败')
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
            ? `已导出 ${count} 首缓存音乐到 ${downloadDir}`
            : `已导出 ${count} 首缓存音乐到下载目录`
          : selected.length > 1
            ? `已导出 ${count} 首缓存音乐（ZIP 压缩包）`
            : `已导出 ${count} 首缓存音乐，请查看下载目录`,
      )
    } catch {
      toast.error('导出缓存失败')
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
        desktop ? `已保存「${item.name}」到下载目录` : `已开始下载「${item.name}」`,
      )
    } catch {
      toast.error('下载失败')
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
        toast.success('下载目录已更新')
      }
    } catch {
      toast.error('无法选择下载目录')
    } finally {
      setPickingDir(false)
    }
  }

  const handleOpenDir = async () => {
    try {
      await openDownloadDir()
    } catch {
      toast.error('无法打开下载目录')
    }
  }

  return (
    <div className="mx-auto max-w-[900px] px-8 pb-16 pt-7">
      <div>
        <h1 className="headline-lg flex items-center gap-2">
          <Settings2 className="h-5 w-5 text-accent" />
          设置
        </h1>
        <p className="mt-1.5 text-[12px] text-black/35">管理本地音乐缓存与存储占用</p>
      </div>

      <div className="mt-6 grid gap-5">
        <section className="apple-card p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="flex items-center gap-2 text-[14px] font-semibold text-black/80">
                <HardDrive className="h-4 w-4 text-accent" />
                音乐缓存
              </h2>
              <p className="mt-1 max-w-[560px] text-[12px] leading-relaxed text-black/40">
                播放过的歌曲会转码为 Opus 并缓存到本地，用于加速之后的播放。修改品质只影响之后缓存的新歌曲，
                已缓存的歌曲保持原品质。
              </p>
            </div>
            <button
              type="button"
              aria-label="刷新缓存信息"
              title="刷新"
              onClick={() => void loadCache()}
              className="pressable flex h-7 w-7 flex-none items-center justify-center rounded-full text-black/35 transition-colors hover:bg-black/5 hover:text-black/70 max-md:h-10 max-md:w-10"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-[1fr_180px]">
            <div>
              <p className="mb-1.5 text-[11px] text-black/40">缓存品质</p>
              <Select
                value={String(cacheBitrate)}
                onChange={(event) => setCacheBitrate(Number(event.target.value))}
                options={CACHE_QUALITY_OPTIONS}
                className="text-[12px]"
              />
              <p className="mt-2 text-[11px] leading-relaxed text-black/30">
                约 64kbps ≈ 1.9MB / 4 分钟，96kbps ≈ 2.9MB，128kbps ≈ 3.8MB。
              </p>
            </div>
            <div className="rounded-[14px] border border-black/6 bg-[#f5f5f7] px-4 py-3">
              <p className="text-[11px] text-black/40">当前缓存</p>
              <p className="mt-1 text-[18px] font-semibold leading-tight text-black/80">
                {loading ? '…' : `${items.length} 首`}
              </p>
              <p className="text-[11px] text-black/35">
                {loading ? '正在读取…' : `占用 ${formatBytes(totalBytes)}`}
              </p>
            </div>
          </div>

          {desktop ? (
            <div className="mt-4 flex items-center gap-3 rounded-[14px] border border-black/6 bg-[#f5f5f7] px-4 py-3">
              <FolderOpen className="h-4 w-4 flex-none text-accent" />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] text-black/40">下载目录</p>
                <p className="mt-0.5 truncate text-[12px] text-black/70" title={downloadDir}>
                  {downloadDir || '正在读取…'}
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                loading={pickingDir}
                onClick={() => void handlePickDir()}
              >
                选择文件夹
              </Button>
              <Button variant="secondary" size="sm" onClick={() => void handleOpenDir()}>
                打开
              </Button>
            </div>
          ) : null}
        </section>

        <section className="apple-card p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="flex items-center gap-2 text-[14px] font-semibold text-black/80">
                <RefreshCw className="h-4 w-4 text-accent" />
                音源匹配
              </h2>
              <p className="mt-1 max-w-[560px] text-[12px] leading-relaxed text-black/40">
                VIP 歌曲无法播放或仅能试听时，自动尝试匹配其他音源；也可以在底部播放条点击
                「切换其他音源」手动替换。
              </p>
            </div>
            <Switch
              checked={autoReplaceVipSource}
              onChange={setAutoReplaceVipSource}
              aria-label="VIP 歌曲自动替换音源"
            />
          </div>
        </section>

        {desktop ? (
          <section className="apple-card p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="flex items-center gap-2 text-[14px] font-semibold text-black/80">
                  <Shield className="h-4 w-4 text-accent" />
                  桌面端
                </h2>
                <p className="mt-1 max-w-[560px] text-[12px] leading-relaxed text-black/40">
                  禁用后，右键菜单与 F12 / Ctrl+Shift+I 等入口不再打开开发者工具。
                  当前窗口立即生效，WebView2 层面需要重启应用。
                </p>
              </div>
              <Switch
                checked={disableDevTools}
                onChange={handleToggleDevTools}
                aria-label="禁用开发者工具"
              />
            </div>
            <p className="mt-4 rounded-[10px] bg-black/4 px-3 py-2 text-[11px] leading-relaxed text-black/40">
              桌面歌词：Ctrl / ⌘ + Shift + L 显示或隐藏，窗口始终置顶，可拖动到任意位置。
            </p>
          </section>
        ) : null}

        <section className="apple-card overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-black/6 px-6 py-4">
            <div>
              <h2 className="flex items-center gap-2 text-[14px] font-semibold text-black/80">
                <ListMusic className="h-4 w-4 text-accent" />
                缓存列表
              </h2>
              <p className="mt-1 text-[11px] text-black/35">
                {loading ? '正在读取缓存…' : `${items.length} 首 · ${formatBytes(totalBytes)}`}
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Download className="h-3.5 w-3.5" />}
              loading={downloading}
              disabled={!selected.length || loading}
              onClick={() => void handleDownloadSelected()}
            >
              {selected.length ? `下载选中 (${selected.length})` : '下载选中'}
            </Button>
          </div>

          {!loading && items.length === 0 ? (
            <div className="px-6 py-12 text-center text-[12px] text-black/30">
              暂无缓存音乐，播放歌曲后会自动缓存
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 border-b border-black/6 bg-black/[0.015] px-6 py-2">
                <input
                  type="checkbox"
                  aria-label="全选"
                  checked={allSelected}
                  disabled={!items.length || loading}
                  onChange={toggleAll}
                  className="h-3.5 w-3.5 accent-accent"
                />
                <span className="text-[11px] text-black/40">全选</span>
                <span className="ml-auto text-[11px] text-black/30">
                  已选 {selected.length} 首
                </span>
              </div>

              <ul>
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
                        {item.artists || '未知歌手'}
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
                      title="下载到本地"
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
                ? '下载会保存为 .opus 文件到上方设置的下载目录。'
                : '下载会导出为 .opus 文件；多选下载会打包为一个 ZIP 压缩包。'}
            </p>
            <Button
              variant={confirmingClear ? 'destructive' : 'secondary'}
              size="sm"
              leftIcon={<Trash2 className="h-3.5 w-3.5" />}
              loading={clearing}
              disabled={!items.length || loading || downloading}
              onClick={() => void handleClear()}
            >
              {confirmingClear ? '确认清除？' : '清除缓存'}
            </Button>
          </div>
        </section>

        <section className="apple-card p-6">
          <h2 className="flex items-center gap-2 text-[14px] font-semibold text-black/80">
            <Keyboard className="h-4 w-4 text-accent" />
            快捷键
          </h2>
          <p className="mt-1 text-[12px] leading-relaxed text-black/40">
            在页面任意位置可用（输入框内保留系统默认行为）。
          </p>
          <dl className="mt-4 grid gap-2 sm:grid-cols-2">
            {SHORTCUTS.map((shortcut) => (
              <div
                key={shortcut.label}
                className="flex items-center justify-between gap-3 rounded-[10px] bg-black/4 px-3 py-2"
              >
                <dt className="text-[12px] text-black/55">{shortcut.label}</dt>
                <dd className="flex shrink-0 items-center gap-1">
                  {shortcut.keys.map((key) => (
                    <kbd
                      key={key}
                      className="rounded-[6px] border border-black/10 bg-white px-1.5 py-0.5 text-[11px] font-medium text-black/60"
                    >
                      {key}
                    </kbd>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </div>
  )
}
