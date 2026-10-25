import type { ReactNode } from 'react'
import { Disc3 } from 'lucide-react'

export function EmptyState({
  title = '暂无数据',
  description,
  action,
  icon,
}: {
  title?: string
  description?: string
  action?: ReactNode
  icon?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-black/4 text-black/25">
        {icon ?? <Disc3 className="h-6 w-6" strokeWidth={1.5} />}
      </div>
      <p className="mt-4 text-[13px] font-medium text-black/55">{title}</p>
      {description ? <p className="mt-1 text-[11.5px] text-black/30">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}
