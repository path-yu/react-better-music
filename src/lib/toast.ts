export type ToastKind = 'info' | 'success' | 'warning' | 'error'

type ToastListener = (message: string, kind: ToastKind, title?: string) => void

const listeners = new Set<ToastListener>()

export function subscribeToast(listener: ToastListener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function emit(message: string, kind: ToastKind, title?: string) {
  listeners.forEach((listener) => listener(message, kind, title))
}

export const toast = {
  info: (message: string, title?: string) => emit(message, 'info', title),
  success: (message: string, title?: string) => emit(message, 'success', title),
  warning: (message: string, title?: string) => emit(message, 'warning', title),
  error: (message: string, title?: string) => emit(message, 'error', title),
}
