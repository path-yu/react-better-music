import { msg } from '@lingui/core/macro'
import { i18n } from '../i18n'

/**
 * Translate the common Chinese messages returned by the local NetEase proxy.
 * Unknown backend messages fall back to the caller's localized copy instead of
 * leaking Chinese text into the English UI.
 */
export function apiErrorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : ''
  if (i18n.locale.startsWith('zh')) return message || fallback
  if (!/[\u4e00-\u9fff]/.test(message)) return message || fallback

  if (/登录|验证|需要/.test(message)) return i18n._(msg`请先登录后再试`)
  if (/版权|不可用|下架/.test(message)) return i18n._(msg`该歌曲暂不可用`)
  if (/参数/.test(message)) return i18n._(msg`请求参数有误`)
  if (/不存在/.test(message)) return i18n._(msg`内容不存在或已下架`)
  if (/超时/.test(message)) return i18n._(msg`请求超时，请稍后重试`)
  if (/网络|连接|fetch/i.test(message)) {
    return i18n._(msg`网络请求失败，请稍后重试`)
  }
  return fallback
}
