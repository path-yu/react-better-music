import { useEffect, useState } from 'react'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { Trans } from '@lingui/react/macro'
import { CheckCircle2, Download, MonitorPlay, RefreshCw } from 'lucide-react'
import { Button } from '@pikoloo/darwin-ui'
import {
  fetchYtDlpStatus,
  installYtDlp,
  type YtDlpStatus,
} from '../../api/ytdlp'
import { toast } from '../../lib/toast'

/**
 * Desktop-only card: shows whether the local API can find yt-dlp and installs
 * the official build into the app-data directory when it cannot.
 */
export function YtDlpCard() {
  const { i18n } = useLingui()
  const [status, setStatus] = useState<YtDlpStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [installing, setInstalling] = useState(false)

  const refresh = async () => {
    setLoading(true)
    try {
      setStatus(await fetchYtDlpStatus())
    } catch {
      toast.error(i18n._(msg`检测 yt-dlp 失败`))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleInstall = async () => {
    if (installing) return
    setInstalling(true)
    try {
      const result = await installYtDlp()
      if (result?.installed) {
        toast.success(i18n._(msg`已安装 yt-dlp ${result.version}`))
        await refresh()
      } else {
        toast.error(i18n._(msg`安装失败`))
      }
    } catch {
      toast.error(i18n._(msg`安装失败`))
    } finally {
      setInstalling(false)
    }
  }

  return (
    // The settings panel only shows cards whose `data-settings-section` equals
    // the active tab, so this belongs to "desktop"; the id is the scroll
    // target the dialog uses.
    <section
      id="settings-youtube"
      className="apple-card p-6"
      data-settings-section="desktop"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink-1">
            <MonitorPlay className="h-4 w-4 text-accent" />
            <Trans>YouTube 音源</Trans>
          </h2>
          <p className="mt-1 max-w-[560px] text-[12px] leading-relaxed text-ink-3">
            <Trans>YouTube 音源依赖本机的 yt-dlp 来解析音频。这里可以一键下载官方版本（约 17 MB）并安装到应用数据目录；也可以在系统里自行安装后点「重新检测」。</Trans>
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
            loading={loading}
            disabled={installing}
            onClick={() => void refresh()}
          >
            <Trans>重新检测</Trans>
          </Button>
          <Button
            size="sm"
            leftIcon={<Download className="h-3.5 w-3.5" />}
            loading={installing}
            disabled={loading}
            onClick={() => void handleInstall()}
          >
            {status?.installed ? (
              <Trans>重新安装</Trans>
            ) : (
              <Trans>安装 yt-dlp</Trans>
            )}
          </Button>
        </div>
      </div>

      <p className="mt-4 flex flex-wrap items-center gap-2 rounded-[10px] bg-black/4 px-3 py-2 text-[11px] leading-relaxed text-ink-3">
        {loading && !status ? (
          <Trans>正在检测…</Trans>
        ) : status?.installed ? (
          <>
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-accent" />
            <Trans>已安装 {status.version}</Trans>
            <span className="min-w-0 truncate text-ink-4">{status.path}</span>
          </>
        ) : (
          <Trans>未检测到 yt-dlp，YouTube 音源暂不可用</Trans>
        )}
      </p>
    </section>
  )
}
