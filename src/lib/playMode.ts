import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import type { PlayMode } from '../store/player'

/** One label per play mode, shared by every transport and the mode toast. */
export const PLAY_MODE_LABELS: Record<PlayMode, MessageDescriptor> = {
  order: msg`顺序播放`,
  loop: msg`列表循环`,
  random: msg`随机播放`,
  singleLoop: msg`单曲循环`,
}

/** Button order: 列表循环 → 随机 → 单曲循环 → 顺序（播完停止）. */
export const PLAY_MODE_CYCLE: PlayMode[] = ['loop', 'random', 'singleLoop', 'order']
