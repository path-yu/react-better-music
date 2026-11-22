import { useCallback, useEffect, useState } from 'react'
import { Trans } from '@lingui/react/macro'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import {
  CheckCircle2,
  Download,
  Loader2,
  RefreshCw,
  RotateCcw,
} from 'lucide-react'
import { Button } from '@pikoloo/darwin-ui'
import {
  applyDesktopUpdate,
  checkDesktopUpdate,
  downloadDesktopUpdate,
  getDesktopUpdateState,
  isDesktopApp,
  type DesktopUpdateState,
} from '../../lib/desktopBridge'

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function formatMegabytes(bytes?: number) {
  if (!bytes || bytes <= 0) return ''
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** No status change for this long while downloading usually means a network stall. */
const STALL_HINT_MS = 30_000

type DownloadPhase =
  | 'starting'
  | 'local-check'
  | 'patch'
  | 'full-download'
  | 'decompressing'
  | 'finishing'

export function UpdateCard() {
  const { i18n } = useLingui()
  const [state, setState] = useState<DesktopUpdateState | null>(null)
  const [busy, setBusy] = useState<'check' | 'download' | 'apply' | null>(null)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    if (!isDesktopApp()) return
    try {
      setState(await getDesktopUpdateState())
    } catch {
      // The bridge may still be starting; the poll below retries.
    }
  }, [])

  useEffect(() => {
    if (!isDesktopApp()) return
    void refresh()
    const timer = window.setInterval(() => void refresh(), 2000)
    return () => window.clearInterval(timer)
  }, [refresh])

  if (!isDesktopApp()) return null

  const update = state?.update
  const status = state?.status
  const phase = status?.status
  // The main process only reports a newer *version* as an update; a rebuild
  // of the same version (different hash) is treated as up to date.
  const newerVersion = Boolean(state?.newerVersion)
  const updateReady = Boolean(update?.updateReady && newerVersion)
  // Trust the main process flag instead of enumerating Updater status names,
  // which change between Electrobun releases.
  const downloading = busy === 'download' || Boolean(state?.downloading)
  // Map Electrobun's fine-grained statuses onto a few user-facing stages.
  // Unknown statuses fall back to the generic "starting" label instead of
  // hiding the progress UI.
  const downloadPhase: DownloadPhase = (() => {
    switch (phase) {
      case 'download-starting':
        return 'starting'
      case 'checking-local-tar':
      case 'local-tar-found':
      case 'local-tar-missing':
        return 'local-check'
      case 'fetching-patch':
      case 'patch-found':
      case 'patch-not-found':
      case 'downloading-patch':
      case 'applying-patch':
      case 'patch-applied':
      case 'patch-failed':
      case 'patch-chain-complete':
        return 'patch'
      case 'downloading-full-bundle':
      case 'download-progress':
        return 'full-download'
      case 'decompressing':
        return 'decompressing'
      case 'extracting-version':
      case 'download-complete':
        return 'finishing'
      default:
        return 'starting'
    }
  })()
  // Only the full-bundle download reports a real percentage; other stages
  // show an indeterminate bar.
  const hasPercent = phase === 'download-progress'
  const progress = hasPercent
    ? Math.max(0, Math.min(100, Math.round(status?.details?.progress ?? 0)))
    : downloadPhase === 'decompressing' || downloadPhase === 'finishing'
      ? 100
      : null
  const downloadedLabel = formatMegabytes(status?.details?.bytesDownloaded)
  const totalLabel = formatMegabytes(status?.details?.totalBytes)
  // The card polls every 2 s, so Date.now() here is refreshed on each poll.
  // Only judge staleness against a download status; the previous
  // "update-available" entry may be minutes old when the click happens.
  const isDownloadStatus =
    phase === 'download-starting' || downloadPhase !== 'starting'
  const stalled =
    downloading &&
    isDownloadStatus &&
    downloadPhase !== 'decompressing' &&
    downloadPhase !== 'finishing' &&
    typeof status?.timestamp === 'number' &&
    Date.now() - status.timestamp > STALL_HINT_MS
  const applying = busy === 'apply' || status?.status === 'applying'
  const checking =
    busy === 'check' ||
    Boolean(state?.checking) ||
    status?.status === 'checking'
  const upToDate =
    !checking &&
    !update?.error &&
    !newerVersion &&
    (phase === 'no-update' || Boolean(update?.updateAvailable))

  const handleCheck = async () => {
    if (busy) return
    setBusy('check')
    setError('')
    try {
      setState(await checkDesktopUpdate())
    } catch (nextError) {
      setError(errorMessage(nextError))
    } finally {
      setBusy(null)
    }
  }

  const handleDownload = async () => {
    if (busy) return
    setBusy('download')
    setError('')
    try {
      setState(await downloadDesktopUpdate())
    } catch (nextError) {
      setError(errorMessage(nextError))
    } finally {
      setBusy(null)
    }
  }

  const handleApply = async () => {
    if (busy) return
    setBusy('apply')
    setError('')
    try {
      await applyDesktopUpdate()
    } catch (nextError) {
      setError(errorMessage(nextError))
      setBusy(null)
    }
  }

  return (
    <section className="apple-card p-6" data-settings-section="desktop">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink-1">
            <RefreshCw className="h-4 w-4 text-accent" />
            <Trans>检查更新</Trans>
          </h2>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-3">
            {state?.packaged === false ? (
              <Trans>开发版</Trans>
            ) : state?.local?.version ? (
              <Trans>当前版本 {state.local.version}</Trans>
            ) : (
              <Trans>读取当前版本…</Trans>
            )}
            {state?.local?.channel ? (
              <span className="text-ink-4"> · {state.local.channel}</span>
            ) : null}
          </p>
        </div>
        <button
          type="button"
          aria-busy={checking}
          disabled={!state?.supported || Boolean(busy) || checking}
          onClick={() => void handleCheck()}
          className="pressable inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-[var(--app-border)] px-3 text-[11px] font-medium text-ink-3 transition-colors hover:border-accent/30 hover:bg-accent/8 hover:text-ink-1 disabled:cursor-default disabled:opacity-40"
        >
          {checking ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          <Trans>检查更新</Trans>
        </button>
      </div>

      {checking ? (
        <p
          aria-live="polite"
          className="mt-4 flex items-center gap-2 rounded-[10px] bg-black/4 px-3 py-2 text-[11px] text-ink-3"
        >
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
          <Trans>
            正在连接 GitHub 获取更新清单，通常需要几秒…
          </Trans>
        </p>
      ) : null}

      {!state?.packaged ? (
        <p className="mt-4 rounded-[10px] bg-black/4 px-3 py-2 text-[11px] leading-relaxed text-ink-3">
          <Trans>
            自动更新只在安装版中启用；开发版请使用 desktop:release 验证更新流程。
          </Trans>
        </p>
      ) : null}

      {state?.packaged && state?.supported === false ? (
        <p className="mt-4 rounded-[10px] bg-black/4 px-3 py-2 text-[11px] leading-relaxed text-ink-3">
          {state.reason || i18n._(msg`更新配置不可用。`)}
        </p>
      ) : null}

      {error ? (
        <p className="mt-4 rounded-[10px] bg-danger/8 px-3 py-2 text-[11px] leading-relaxed text-danger">
          {error}
        </p>
      ) : null}

      {update?.error ? (
        <p className="mt-4 rounded-[10px] bg-danger/8 px-3 py-2 text-[11px] leading-relaxed text-danger">
          {update.error}
        </p>
      ) : null}

      {updateReady && update ? (
        <div className="mt-4 rounded-[14px] border border-accent/25 bg-accent/8 p-4">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-ink-1">
                <Trans>更新已下载完成</Trans>
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-ink-3">
                <Trans>
                  新版本 {update.version} 会在重启后安装，当前播放状态会结束。
                </Trans>
              </p>
            </div>
            <Button
              size="sm"
              loading={busy === 'apply'}
              disabled={Boolean(busy) || applying}
              onClick={() => void handleApply()}
            >
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              <Trans>重启并更新</Trans>
            </Button>
          </div>
        </div>
      ) : newerVersion && update ? (
        <div className="mt-4 rounded-[14px] border border-black/8 bg-black/[0.025] p-4 dark:border-white/10 dark:bg-white/[0.035]">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[13px] font-medium text-ink-1">
                <Trans>发现新版本 {update.version}</Trans>
              </p>
              <p className="mt-1 text-[11px] text-ink-3">
                <Trans>下载完成后可选择重启安装。</Trans>
              </p>
            </div>
            <Button
              size="sm"
              loading={busy === 'download'}
              disabled={Boolean(busy) || downloading}
              onClick={() => void handleDownload()}
            >
              <Download className="mr-1.5 h-3.5 w-3.5" />
              <Trans>下载更新</Trans>
            </Button>
          </div>
          {downloading ? (
            <div className="mt-3">
              <div className="mb-1.5 flex items-center justify-between text-[11px] text-ink-3">
                <span aria-live="polite">
                  {downloadPhase === 'local-check' ? (
                    <Trans>正在检查本地已有的安装包…</Trans>
                  ) : downloadPhase === 'patch' ? (
                    <Trans>正在下载增量补丁…</Trans>
                  ) : downloadPhase === 'full-download' ? (
                    <Trans>正在下载完整更新包…</Trans>
                  ) : downloadPhase === 'decompressing' ? (
                    <Trans>正在解压并校验更新…</Trans>
                  ) : downloadPhase === 'finishing' ? (
                    <Trans>正在完成准备…</Trans>
                  ) : (
                    <Trans>正在准备下载…</Trans>
                  )}
                </span>
                <span className="tabular-nums">
                  {hasPercent && downloadedLabel
                    ? totalLabel
                      ? `${downloadedLabel} / ${totalLabel} · ${progress}%`
                      : downloadedLabel
                    : progress !== null
                      ? `${progress}%`
                      : null}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-black/8 dark:bg-white/10">
                {progress === null ? (
                  // Stage without a percentage: indeterminate pulse.
                  <div className="h-full w-1/3 animate-pulse rounded-full bg-accent/60" />
                ) : (
                  <div
                    className="h-full rounded-full bg-accent transition-[width] duration-300"
                    style={{ width: `${Math.max(2, progress)}%` }}
                  />
                )}
              </div>
              {stalled ? (
                <p className="mt-2 text-[11px] leading-relaxed text-ink-4">
                  <Trans>
                    已超过 30 秒没有新进度，可能是无法连接 GitHub。请检查网络或代理设置，下载会在超时后自动报错。
                  </Trans>
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : upToDate ? (
        <p className="mt-4 rounded-[10px] bg-black/4 px-3 py-2 text-[11px] text-ink-3">
          <Trans>当前已是最新版本。</Trans>
        </p>
      ) : null}

      {applying ? (
        <p className="mt-3 text-[11px] text-ink-3">
          <Trans>正在准备重启并安装更新…</Trans>
        </p>
      ) : null}
    </section>
  )
}
