import { Trans } from '@lingui/react/macro'
import { useNavigate } from '@tanstack/react-router'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@pikoloo/darwin-ui'

/**
 * Shown when the user picks the YouTube source without a yt-dlp binary.
 * Points at the settings card that can install it, instead of a vague
 * "switch failed" toast.
 */
export function YtDlpDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const navigate = useNavigate()

  const goToSettings = () => {
    onOpenChange(false)
    // `/settings` requires a tab; the installer lives in the desktop section.
    void navigate({ to: '/settings', search: { tab: 'desktop' } })
    // The settings page renders its cards after the route mounts.
    window.setTimeout(() => {
      document
        .getElementById('settings-youtube')
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 350)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" glass>
        <DialogHeader>
          <DialogTitle>
            <Trans>需要安装 yt-dlp</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>YouTube 音源依赖本机的 yt-dlp 来解析音频。可以在设置页一键安装官方版本（约 17 MB），装好后重新选择 YouTube 即可。</Trans>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            <Trans>取消</Trans>
          </Button>
          <Button size="sm" onClick={goToSettings}>
            <Trans>去设置安装</Trans>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
