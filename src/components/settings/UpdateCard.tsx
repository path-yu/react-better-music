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

/** No progress for this long while downloading usually means a network stall. */
const STALL_HINT_MS = 30_000

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

  const phase = state?.phase
  // Poll faster while bytes are moving so the progress bar stays smooth.
  const active =
    phase === 'checking' || phase === 'downloading' || phase === 'verifying'

  useEffect(() => {
    if (!isDesktopApp()) return
    void refresh()
    const timer = window.setInterval(() => void refresh(), active ? 1000 : 2000)
    return () => window.clearInterval(timer)
  }, [refresh, active])

  if (!isDesktopApp()) return null

  const remote = state?.remote
  const newerVersion = Boolean(state?.newerVersion && remote)
  const checking = busy === 'check' || phase === 'checking'
  const downloading =
    busy === 'download' || phase === 'downloading' || phase === 'verifying'
  const verifying = phase === 'verifying'
  // Keep the ready card (with its spinner) visible while the installer starts.
  const ready = newerVersion && (phase === 'ready' || phase === 'installing')
  const installing = busy === 'apply' || phase === 'installing'
  const failed = phase === 'error'
  const upToDate = phase === 'up-to-date'

  const totalBytes = state?.totalBytes || remote?.size || 0
  const downloadedBytes = state?.downloadedBytes ?? 0
  const progress =
    verifying
      ? 100
      : totalBytes > 0
        ? Math.max(0, Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)))
        : null
  const downloadedLabel = formatMegabytes(downloadedBytes)
  const totalLabel = formatMegabytes(totalBytes)
  const sizeLabel = formatMegabytes(remote?.size)
  // Date.now() is re-evaluated on every poll render.
  const stalled =
    phase === 'downloading' &&
    typeof state?.updatedAt === 'number' &&
    Date.now() - state.updatedAt > STALL_HINT_MS

  const run = async (
    kind: 'check' | 'download',
    request: () => Promise<DesktopUpdateState>,
  ) => {
    if (busy) return
    setBusy(kind)
    setError('')
    try {
      setState(await request())
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
      // The app quits shortly; keep the button disabled until then.
    } catch (nextError) {
      setError(errorMessage(nextError))
      setBusy(null)
      void refresh()
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
          disabled={
            !state?.supported ||
            Boolean(busy) ||
            checking ||
            downloading ||
            installing
          }
          onClick={() => void run('check', checkDesktopUpdate)}
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
          <Trans>正在连接 GitHub 获取最新版本信息，通常需要几秒…</Trans>
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

      {error || (failed && state?.error) ? (
        <p className="mt-4 rounded-[10px] bg-danger/8 px-3 py-2 text-[11px] leading-relaxed text-danger">
          {error || state?.error}
        </p>
      ) : null}

      {ready && remote ? (
        <div className="mt-4 rounded-[14px] border border-accent/25 bg-accent/8 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-ink-1">
                  <Trans>新版本 {remote.version} 的安装包已下载</Trans>
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-ink-3">
                  <Trans>
                    点击「立即安装」后声屿会关闭，安装程序会覆盖安装到原来的目录，完成后自动重新打开。当前播放会结束。
                  </Trans>
                </p>
              </div>
            </div>
            <Button
              size="sm"
              loading={busy === 'apply'}
              disabled={Boolean(busy) || installing}
              onClick={() => void handleApply()}
            >
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              <Trans>立即安装</Trans>
            </Button>
          </div>
          {installing ? (
            <p className="mt-3 flex items-center gap-2 text-[11px] text-ink-3">
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
              <Trans>正在启动安装程序，声屿即将关闭…</Trans>
            </p>
          ) : null}
        </div>
      ) : newerVersion && remote ? (
        <div className="mt-4 rounded-[14px] border border-black/8 bg-black/[0.025] p-4 dark:border-white/10 dark:bg-white/[0.035]">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[13px] font-medium text-ink-1">
                <Trans>发现新版本 {remote.version}</Trans>
              </p>
              <p className="mt-1 text-[11px] text-ink-3">
                {sizeLabel ? (
                  <Trans>
                    将下载完整安装包（{sizeLabel}），下载完成后运行安装程序完成更新。
                  </Trans>
                ) : (
                  <Trans>将下载完整安装包，下载完成后运行安装程序完成更新。</Trans>
                )}
              </p>
            </div>
            <Button
              size="sm"
              loading={busy === 'download'}
              disabled={Boolean(busy) || downloading || checking}
              onClick={() => void run('download', downloadDesktopUpdate)}
            >
              <Download className="mr-1.5 h-3.5 w-3.5" />
              {failed ? <Trans>重新下载</Trans> : <Trans>下载更新</Trans>}
            </Button>
          </div>
          {downloading ? (
            <div className="mt-3">
              <div className="mb-1.5 flex items-center justify-between text-[11px] text-ink-3">
                <span aria-live="polite">
                  {verifying ? (
                    <Trans>正在校验安装包…</Trans>
                  ) : (
                    <Trans>正在下载安装包…</Trans>
                  )}
                </span>
                <span className="tabular-nums">
                  {verifying
                    ? '100%'
                    : totalLabel
                      ? `${downloadedLabel || '0.0 MB'} / ${totalLabel} · ${progress ?? 0}%`
                      : downloadedLabel || null}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-black/8 dark:bg-white/10">
                {progress === null ? (
                  // Size unknown: indeterminate pulse instead of an empty bar.
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
                    已超过 30 秒没有新进度，可能是无法连接 GitHub。请检查网络或代理设置，60 秒无数据会自动停止并提示重试。
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
    </section>
  )
}
