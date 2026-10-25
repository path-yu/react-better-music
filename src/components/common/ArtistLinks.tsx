import { useNavigate } from '@tanstack/react-router'
import { cn } from '../../lib/format'
import type { Artist } from '../../types'

interface ArtistLinksProps {
  artists?: Artist[] | null
  className?: string
}

export function ArtistLinks({ artists, className }: ArtistLinksProps) {
  const navigate = useNavigate()
  if (!artists?.length) return null

  return (
    <span className={className}>
      {artists.map((artist, index) => (
        <span key={`${artist.id}-${index}`}>
          {index > 0 ? <span className="text-black/20"> / </span> : null}
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              void navigate({ to: '/artist/$id', params: { id: String(artist.id) } })
            }}
            onDoubleClick={(event) => event.stopPropagation()}
            className={cn(
              'cursor-pointer rounded-sm text-left transition-colors hover:text-[#0066cc] hover:underline',
            )}
          >
            {artist.name}
          </button>
        </span>
      ))}
    </span>
  )
}
