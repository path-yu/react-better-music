import {
  Link,
  Outlet,
  createRootRoute,
  type ErrorComponentProps,
} from '@tanstack/react-router'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { Button, OverlayProvider, ToastProvider } from '@pikoloo/darwin-ui'
import { AppShell } from '../components/layout/AppShell'
import { ToastBridge } from '../components/common/ToastBridge'
import { useDocumentTitle } from '../lib/title'
import { apiErrorMessage } from '../lib/apiErrors'
import '../styles.css'

export const Route = createRootRoute({
  component: RootComponent,
  notFoundComponent: RootNotFound,
  errorComponent: RootError,
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

function RootNotFound() {
  const { i18n } = useLingui()
  useDocumentTitle(i18n._(msg`页面不存在`))
  return (
    <div className="flex min-h-dvh items-center justify-center px-6">
      <div className="apple-card w-full max-w-[420px] p-8 text-center">
        <p className="eyebrow">404</p>
        <h1 className="headline-lg mt-2 text-[24px]">页面不存在</h1>
        <p className="mt-2 text-[12px] leading-relaxed text-black/40">
          链接可能已失效，或内容已被移除。
        </p>
        <div className="mt-5 flex justify-center">
          <Link
            to="/"
            className="pressable rounded-full bg-accent px-4 py-1.5 text-[12px] text-white hover:bg-accent-hover"
          >
            返回首页
          </Link>
        </div>
      </div>
    </div>
  )
}

function RootError({ error, reset }: ErrorComponentProps) {
  const { i18n } = useLingui()
  useDocumentTitle(i18n._(msg`出错了`))
  const message =
    error instanceof Error
      ? apiErrorMessage(error, i18n._(msg`发生未知错误`))
      : typeof error === 'string'
        ? error
        : i18n._(msg`发生未知错误`)
  return (
    <div className="flex min-h-dvh items-center justify-center px-6">
      <div className="apple-card w-full max-w-[420px] p-8 text-center">
        <p className="eyebrow">出错了</p>
        <h1 className="headline-lg mt-2 text-[24px]">页面暂时无法显示</h1>
        <p className="mt-2 break-words text-[12px] leading-relaxed text-black/40">
          {message}
        </p>
        <div className="mt-5 flex items-center justify-center gap-2">
          <Button
            variant="primary"
            size="sm"
            className="rounded-full px-4"
            onClick={reset}
          >
            重试
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="rounded-full px-4"
            onClick={() => window.location.assign('/')}
          >
            返回首页
          </Button>
        </div>
      </div>
    </div>
  )
}
