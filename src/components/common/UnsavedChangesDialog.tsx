import { Trans } from '@lingui/react/macro'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@pikoloo/darwin-ui'

/** Confirmation shown by useUnsavedChangesGuard; Esc or a backdrop click keeps editing. */
export function UnsavedChangesDialog({
  open,
  onStay,
  onLeave,
}: {
  open: boolean
  onStay: () => void
  onLeave: () => void
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next: boolean) => {
        if (!next) onStay()
      }}
    >
      <DialogContent size="sm" glass>
        <DialogHeader>
          <DialogTitle>
            <Trans>放弃未保存的修改？</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>离开此页面后，刚才的修改不会保存。</Trans>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="secondary" size="sm" onClick={onStay}>
            <Trans>继续编辑</Trans>
          </Button>
          <Button variant="destructive" size="sm" onClick={onLeave}>
            <Trans>放弃修改</Trans>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
