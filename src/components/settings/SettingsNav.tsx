import { useEffect } from 'react'
import { HardDrive, Headphones, Monitor, Search, Settings2 } from 'lucide-react'
import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { cn } from '../../lib/format'

export type SettingsTab = 'general' | 'playback' | 'cache' | 'desktop'

const TABS: Array<{
  id: SettingsTab
  label: MessageDescriptor
  icon: typeof Settings2
}> = [
  { id: 'general', label: msg`通用`, icon: Settings2 },
  { id: 'playback', label: msg`播放`, icon: Headphones },
  { id: 'cache', label: msg`缓存`, icon: HardDrive },
  { id: 'desktop', label: msg`桌面`, icon: Monitor },
]

const SEARCH_TERMS: Record<SettingsTab, string[]> = {
  general: ['外观', '主题', '配色', '语言', 'appearance', 'theme', 'palette', 'language'],
  playback: [
    'Spleeter',
    '智能伴奏',
    '人声分离',
    '一键安装',
    '播放器样式',
    '封面',
    '黑胶',
    '磁带',
    '音量均衡',
    '音源匹配',
    '听歌打卡',
    'player style',
    'cover',
    'vinyl',
    'cassette',
    'loudness',
    'normalization',
    'source',
    'scrobble',
  ],
  cache: [
    '音乐缓存',
    '缓存品质',
    '最大缓存容量',
    '缓存列表',
    '下载目录',
    '清除缓存',
    'cache',
    'quality',
    'storage',
    'downloads',
    'clear',
  ],
  desktop: [
    '桌面',
    '开发者工具',
    '快捷键',
    'desktop',
    'devtools',
    'shortcuts',
  ],
}

export function SettingsNav({
  active,
  query,
  onQueryChange,
  onSelect,
}: {
  active: SettingsTab
  query: string
  onQueryChange: (value: string) => void
  onSelect: (tab: SettingsTab) => void
}) {
  const { i18n } = useLingui()
  const normalized = query.trim().toLowerCase()
  const visible = TABS.filter((tab) => {
    if (!normalized) return true
    const haystack = [
      i18n._(tab.label),
      ...SEARCH_TERMS[tab.id],
    ]
      .join(' ')
      .toLowerCase()
    return haystack.includes(normalized)
  })

  // Searching for a setting should reveal the matching panel immediately,
  // rather than leaving the previously active panel on screen.
  useEffect(() => {
    if (!normalized || !visible.length) return
    if (!visible.some((tab) => tab.id === active)) {
      onSelect(visible[0].id)
    }
    // `visible` is derived from the query and labels above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalized, active, onSelect])

  return (
    <aside className="settings-nav" aria-label={i18n._(msg`设置分类`)}>
      <label className="settings-search">
        <Search className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
        <input
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={i18n._(msg`搜索`)}
          aria-label={i18n._(msg`搜索设置`)}
        />
      </label>

      <nav className="settings-nav__list" role="tablist">
        {visible.map((tab) => {
          const Icon = tab.icon
          const selected = active === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onSelect(tab.id)}
              className={cn('settings-nav__item', selected && 'is-active')}
            >
              <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
              <span>{i18n._(tab.label)}</span>
            </button>
          )
        })}
      </nav>

      {!visible.length ? (
        <p className="settings-nav__empty">
          {i18n._(msg`没有匹配的设置`)}
        </p>
      ) : null}
    </aside>
  )
}
