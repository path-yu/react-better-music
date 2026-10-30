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
    value: 'ddyr',
    label: msg`DDYR`,
    description: msg`第三方音源`,
  },
  {
    value: 'msls',
    label: msg`MSLS`,
    description: msg`第三方音源`,
  },
  {
    value: 'oi',
    label: msg`OI 音乐`,
    description: msg`第三方音源`,
  },
  {
    value: 'qijieya',
    label: msg`奇迹音乐`,
    description: msg`第三方音源`,
  },
]

export function getSourceOption(value?: string | null): SourceOption {
  return (
    SOURCE_OPTIONS.find((option) => option.value === value) ?? SOURCE_OPTIONS[0]
  )
}
