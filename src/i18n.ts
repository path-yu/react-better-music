import { i18n } from '@lingui/core'
import { messages as enMessages } from './locales/en.po'
import { messages as zhMessages } from './locales/zh-CN.po'

export const locales = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'en', label: 'English' },
] as const

export type Locale = (typeof locales)[number]['value']
export const defaultLocale: Locale = 'zh-CN'

i18n.load({
  'zh-CN': zhMessages,
  en: enMessages,
})
i18n.activate(defaultLocale)

/** Activate a catalog and keep the document language in sync. */
export function activateLocale(locale: Locale) {
  i18n.activate(locale)
  document.documentElement.lang = locale
}

export { i18n }
