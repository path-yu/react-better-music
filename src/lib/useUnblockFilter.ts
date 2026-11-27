import { useEffect, useState } from 'react'

/**
 * 「仅看可换源」开关，按页面 key 记在 sessionStorage。
 *
 * 歌单 / 专辑 / 歌手页都在切走时卸载，纯 `useState` 会把它重置成关闭、列表
 * 也从"可换源"跳回全部。与 tab、滚动位置一样把这个开关留在会话里，回来时
 * 按钮状态和筛选后的列表都能原样恢复。
 */
export function useUnblockFilter(storageKey: string) {
  const key = `unblock-only:${storageKey}`
  const [enabled, setEnabled] = useState(() => {
    try {
      return sessionStorage.getItem(key) === '1'
    } catch {
      return false
    }
  })

  useEffect(() => {
    try {
      if (enabled) sessionStorage.setItem(key, '1')
      else sessionStorage.removeItem(key)
    } catch {
      // storage may be unavailable
    }
  }, [enabled, key])

  return [enabled, setEnabled] as const
}
