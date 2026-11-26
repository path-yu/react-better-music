import { Skeleton } from '@pikoloo/darwin-ui'

/**
 * Fallback shown while a code-split route module is still in flight.
 *
 * Route modules load on the first visit to a page; without a pending component
 * the old view is already unmounted and the content area stays fully blank for
 * 150–300ms, which reads as a white flash. The skeleton keeps the layout busy.
 * `defaultPendingMs: 120` means cached routes (the common case) never see it.
 */
export function RoutePending() {
  return (
    <div className="page" aria-busy="true">
      <Skeleton className="h-8 w-44 rounded-full" />
      <Skeleton className="mt-3 h-3 w-64 rounded-full" />
      <Skeleton className="mt-6 h-[220px] w-full rounded-[18px]" />
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} className="aspect-square w-full rounded-[12px]" />
        ))}
      </div>
    </div>
  )
}
