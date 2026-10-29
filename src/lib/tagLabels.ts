import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'

/**
 * NetEase sends playlist/MV tags in Chinese. They double as API query values,
 * so keep the raw string and only translate the label shown to the user.
 */
export const TAG_LABELS: Record<string, MessageDescriptor> = {
  华语: msg`华语`,
  欧美: msg`欧美`,
  韩语: msg`韩语`,
  日语: msg`日语`,
  粤语: msg`粤语`,
  '另类/独立': msg`另类/独立`,
  'R&B/Soul': msg`R&B/Soul`,
  怀旧: msg`怀旧`,
  小语种: msg`小语种`,
  学习: msg`学习`,
  夜晚: msg`夜晚`,
  运动: msg`运动`,
  ACG: msg`ACG`,
  影视原声: msg`影视原声`,
  流行: msg`流行`,
  内地: msg`内地`,
  港台: msg`港台`,
  日本: msg`日本`,
  韩国: msg`韩国`,
  官方版: msg`官方版`,
  现场版: msg`现场版`,
  原生: msg`原生`,
  网易出品: msg`网易出品`,
}
