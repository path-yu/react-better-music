import { Outlet, createRootRoute } from '@tanstack/react-router'
import { OverlayProvider, ToastProvider } from '@pikoloo/darwin-ui'
import { AppShell } from '../components/layout/AppShell'
import { ToastBridge } from '../components/common/ToastBridge'
import '../styles.css'

export const Route = createRootRoute({
  component: RootComponent,
})

function RootComponent() {
  return (
    <OverlayProvider>
      <ToastProvider>
        <AppShell>
          <Outlet />
        </AppShell>
        <ToastBridge />
      </ToastProvider>
    </OverlayProvider>
  )
}
