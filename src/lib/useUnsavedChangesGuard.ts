import { useCallback, useEffect, useRef } from 'react'
import { useBlocker } from '@tanstack/react-router'
import { isDesktopShell } from './desktop'

/**
 * Hold any navigation away from a page with unsaved edits (sidebar links,
 * Back/Forward, programmatic navigate) until the user confirms in the
 * in-app dialog. Pair with <UnsavedChangesDialog>.
 *
 * Call `allowNextNavigation()` right before navigating after a successful
 * save: the form still differs from the data loaded on entry at that point.
 */
export function useUnsavedChangesGuard(dirty: boolean) {
  const dirtyRef = useRef(dirty)
  const bypassRef = useRef(false)
  useEffect(() => {
    dirtyRef.current = dirty
  }, [dirty])

  const shouldBlockFn = useCallback(
    () => dirtyRef.current && !bypassRef.current,
    [],
  )
  // Closing or reloading the browser tab can only show the browser's own
  // prompt. The desktop window hides to the tray instead of unloading, and a
  // WebView2 unload prompt would get in the way of quitting the app.
  const enableBeforeUnload = useCallback(
    () => !isDesktopShell() && dirtyRef.current && !bypassRef.current,
    [],
  )
  const blocker = useBlocker({ shouldBlockFn, enableBeforeUnload, withResolver: true })

  const allowNextNavigation = useCallback(() => {
    bypassRef.current = true
  }, [])

  return {
    /** A navigation is waiting for the user's answer. */
    blocked: blocker.status === 'blocked',
    /** Cancel the pending navigation and keep editing. */
    stay: () => blocker.reset?.(),
    /** Discard the edits and continue the pending navigation. */
    leave: () => blocker.proceed?.(),
    allowNextNavigation,
  }
}
