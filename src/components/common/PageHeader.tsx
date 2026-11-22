import type { ReactNode } from 'react'
import { cn } from '../../lib/format'

/**
 * Shared page heading: optional eyebrow, the page title, one line of
 * description and right-aligned actions. Spacing and type live in the
 * `.page-header*` classes (styles.css), so every page lines up the same way.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: ReactNode
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <header className={cn('page-header', className)}>
      <div className="min-w-0">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1 className={cn('headline-lg', eyebrow ? 'mt-1.5' : undefined)}>{title}</h1>
        {description ? <p className="page-subtitle">{description}</p> : null}
      </div>
      {actions ? <div className="page-header__actions">{actions}</div> : null}
    </header>
  )
}
