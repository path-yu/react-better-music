import { useCallback, useEffect, useState } from 'react'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { Trans } from '@lingui/react/macro'
import { Loader2, RefreshCw, Smartphone } from 'lucide-react'
import { Button, Switch } from '@pikoloo/darwin-ui'
import {
  getRemoteControl,
  setRemoteControl,
  type RemoteControlInfo,
} from '../../lib/desktopBridge'
import { cn } from '../../lib/format'
import { toast } from '../../lib/toast'

/** Poll while enabled so the listener state and phone count stay current. */
const REFRESH_INTERVAL = 3000

/**
 * LAN phone remote. Off by default; when on, the desktop shows a QR code that
 * carries the pairing key, and only phones that scanned it can connect.
 */
export function RemoteControlCard() {
  const { i18n } = useLingui()
  const [info, setInfo] = useState<RemoteControlInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState(0)

  const refresh = useCallback(async () => {
    try {
      setInfo(await getRemoteControl())
    } catch {
      // The bridge or API may still be starting; the next poll retries.
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const enabled = Boolean(info?.enabled)
  useEffect(() => {
    if (!enabled) return
    const timer = window.setInterval(() => void refresh(), REFRESH_INTERVAL)
    return () => window.clearInterval(timer)
  }, [enabled, refresh])

  const update = async (patch: { enabled?: boolean; resetToken?: boolean }) => {
    if (busy) return
    setBusy(true)
    try {
      setInfo(await setRemoteControl(patch))
      if (patch.resetToken) {
        toast.success(i18n._(msg`已重置配对，之前连接的手机需要重新扫码`))
      }
    } catch {
      toast.error(i18n._(msg`手机遥控设置失败，请稍后重试`))
    } finally {
      setBusy(false)
    }
  }

  const urls = info?.urls ?? []
  const current = urls[Math.min(selected, Math.max(0, urls.length - 1))]
  const phones = info?.phones ?? 0
  const starting = enabled && !info?.listening && !info?.error

  return (
    <section className="apple-card p-6" data-settings-section="desktop">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink-1">
            <Smartphone className="h-4 w-4 text-accent" />
            <Trans>手机遥控</Trans>
          </h2>
          <p className="mt-1 max-w-[560px] text-[12px] leading-relaxed text-ink-3">
            <Trans>
              开启后，同一局域网内的手机扫描下方二维码即可控制播放。只有扫过当前二维码的设备可以连接。
            </Trans>
          </p>
        </div>
        <Switch
          checked={enabled}
          onChange={(value: boolean) => void update({ enabled: value })}
          aria-label={i18n._(msg`手机遥控`)}
        />
      </div>

      {enabled ? (
        <div className="mt-4">
          {info?.error ? (
            <p className="rounded-[10px] bg-warn/10 px-3 py-2 text-[12px] leading-relaxed text-warn-ink">
              <Trans>遥控端口被占用，请关闭占用该端口的程序后重新开启</Trans>
              {info.port ? ` (${info.port})` : null}
            </p>
          ) : urls.length === 0 ? (
            <p className="text-[12px] leading-relaxed text-ink-3">
              {info?.apiReady === false ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <Trans>正在启动遥控服务…</Trans>
                </span>
              ) : (
                <Trans>未检测到局域网地址，请确认电脑已连接 Wi-Fi 或有线网络</Trans>
              )}
            </p>
          ) : (
            <div className="flex flex-wrap items-start gap-5">
              {current?.qr ? (
                <img
                  src={current.qr}
                  alt={i18n._(msg`手机遥控二维码`)}
                  className="h-[160px] w-[160px] rounded-[14px] border border-black/8 bg-white p-2"
                />
              ) : null}
              <div className="min-w-0 flex-1 space-y-3">
                <p className="text-[12px] leading-relaxed text-ink-2">
                  {starting ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <Trans>正在启动遥控服务…</Trans>
                    </span>
                  ) : (
                    <Trans>
                      用手机相机或浏览器扫码打开，可「添加到主屏幕」作为遥控器使用。
                    </Trans>
                  )}
                </p>
                {urls.length > 1 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {urls.map((item, index) => (
                      <button
                        key={item.url}
                        type="button"
                        title={item.name}
                        onClick={() => setSelected(index)}
                        className={cn(
                          'rounded-full border px-2.5 py-1 text-[11px] tabular-nums',
                          item === current
                            ? 'border-accent/40 bg-accent/10 text-accent'
                            : 'border-black/10 text-ink-3 hover:text-ink-2',
                        )}
                      >
                        {item.address}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] tabular-nums text-ink-3">{current?.address}</p>
                )}
                <p className="text-[11px] text-ink-3">
                  <Trans>已连接 {phones} 台设备</Trans>
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  className="rounded-full px-3.5 text-[12px]"
                  loading={busy}
                  onClick={() => void update({ resetToken: true })}
                >
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                  <Trans>重置配对</Trans>
                </Button>
              </div>
            </div>
          )}
          <p className="mt-4 rounded-[10px] bg-black/4 px-3 py-2 text-[11px] leading-relaxed text-ink-3">
            <Trans>
              首次开启时 Windows 可能弹出防火墙提示，请允许「专用网络」访问。手机与电脑需连接同一网络。
            </Trans>
          </p>
        </div>
      ) : null}
    </section>
  )
}
