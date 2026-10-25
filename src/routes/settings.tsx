import { useCallback, useEffect, useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import {
  Download,
  HardDrive,
  ListMusic,
  Loader2,
  RefreshCw,
  Settings2,
  Trash2,
} from 'lucide-react'
import { Button, Select } from '@pikoloo/darwin-ui'
import { CACHE_QUALITY_OPTIONS, useSettingsStore } from '../store/settings'
import {
  clearAudioCache,
  downloadCachedAudio,
  listCachedAudio,
  type CachedAudioItem,
} from '../lib/songCache'
import { formatDate, formatDuration } from '../lib/format'
import { toast } from '../lib/toast'

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
})

function formatBytes(bytes: number) {
  if (!bytes) return '0 MB'
  const mb = bytes / (1024 * 1024)
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function SettingsPage() {
  const cacheBitrate = useSettingsStore((state) => state.cacheBitrate)
  const setCacheBitrate = useSettingsStore((state) => state.setCacheBitrate)
  const [items, setItems] = useState<CachedAudioItem[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<number[]>([])
  const [clearing, setClearing] = useState(false)
  const [confirmingClear, setConfirmingClear] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [downloadingId, setDownloadingId] = useState<number | null>(null)

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
      window.setTimeout(() => setConfirmingClear(false), 3000)
      return
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
      toast.success(`已导出 ${count} 首缓存音乐，请查看下载目录`)
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
      toast.success(`已开始下载「${item.name}」`)
    } catch {
      toast.error('下载失败')
    } finally {
      setDownloadingId(null)
    }
  }

  return (
    <div className="mx-auto max-w-[900px] px-8 pb-16 pt-7">
      <div>
        <h1 className="headline-lg flex items-center gap-2">
          <Settings2 className="h-5 w-5 text-[#0066cc]" />
          设置
        </h1>
        <p className="mt-1.5 text-[12px] text-black/35">管理本地音乐缓存与存储占用</p>
      </div>

      <div className="mt-6 grid gap-5">
        <section className="apple-card p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="flex items-center gap-2 text-[14px] font-semibold text-black/80">
                <HardDrive className="h-4 w-4 text-[#0066cc]" />
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
              className="pressable flex h-7 w-7 flex-none items-center justify-center rounded-full text-black/35 transition-colors hover:bg-black/5 hover:text-black/70"
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
            <div className="rounded-[12px] border border-black/6 bg-[#f5f5f7] px-4 py-3">
              <p className="text-[11px] text-black/40">当前缓存</p>
              <p className="mt-1 text-[18px] font-semibold leading-tight text-black/80">
                {loading ? '…' : `${items.length} 首`}
              </p>
              <p className="text-[11px] text-black/35">
                {loading ? '正在读取…' : `占用 ${formatBytes(totalBytes)}`}
              </p>
            </div>
          </div>
        </section>

        <section className="apple-card overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-black/6 px-6 py-4">
            <div>
              <h2 className="flex items-center gap-2 text-[14px] font-semibold text-black/80">
                <ListMusic className="h-4 w-4 text-[#0066cc]" />
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
                  className="h-3.5 w-3.5 accent-[#0066cc]"
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
                      className="h-3.5 w-3.5 flex-none accent-[#0066cc]"
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
                      className="pressable flex h-7 w-7 flex-none items-center justify-center rounded-full text-black/35 transition-colors hover:bg-black/5 hover:text-[#0066cc] disabled:cursor-not-allowed disabled:opacity-40"
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
              下载会导出为 .opus 文件；浏览器可能询问是否允许下载多个文件。
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
      </div>
    </div>
  )
}
