import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'

/**
 * Modules exposed by `@neteasecloudmusicapienhanced/unblockmusic-utils`.
 * `/song/url/match?id=&source=` accepts exactly one module; an empty source
 * lets the matcher try them in its built-in order.
 */
export interface SourceOption {
  value: string
  label: MessageDescriptor
  description: MessageDescriptor
}

export const SOURCE_OPTIONS: SourceOption[] = [
  {
    value: 'auto',
    label: msg`自动匹配`,
    description: msg`按内置顺序尝试所有音源`,
  },
  {
    value: 'unm',
    label: msg`UNM 聚合`,
    description: msg`QQ、酷我、酷狗等综合音源`,
  },
  {
    value: 'gdmusic',
    label: msg`GD 音乐台`,
    description: msg`第三方聚合接口`,
  },
  {
    value: 'byfuns',
    label: msg`ByFuns`,
    description: msg`第三方音源`,
  },
  {
    value: 'bilibili',
    label: msg`哔哩哔哩`,
    description: msg`按歌名搜索视频音频，适合找回原曲`,
  },
  {
    value: 'youtube',
    label: msg`YouTube`,
    description: msg`需要本机安装 yt-dlp`,
  },
]

export function getSourceOption(value?: string | null): SourceOption {
  return (
    SOURCE_OPTIONS.find((option) => option.value === value) ?? SOURCE_OPTIONS[0]
  )
}
