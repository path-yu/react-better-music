import { useNavigate } from '@tanstack/react-router'
import { Play } from 'lucide-react'
import { ImageWithFallback } from '../common/ImageWithFallback'
import { formatNumber } from '../../lib/format'
import type { Playlist } from '../../types'

interface PlaylistCardProps {
  playlist: Playlist
  compact?: boolean
}

export function PlaylistCard({ playlist, compact }: PlaylistCardProps) {
  const navigate = useNavigate()

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => void navigate({ to: '/songlists/$id', params: { id: String(playlist.id) } })}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          void navigate({ to: '/songlists/$id', params: { id: String(playlist.id) } })
        }
      }}
      className="apple-card apple-card-hover group cursor-pointer p-2.5"
    >
      <div className="relative overflow-hidden rounded-[9px]">
        <ImageWithFallback
          src={playlist.coverImgUrl}
          alt={playlist.name}
          rounded="rounded-[9px]"
          className={compact ? 'aspect-square w-full' : 'aspect-square w-full'}
          imageClassName="transition-transform duration-500 group-hover:scale-[1.04]"
        />
        <div className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded-full bg-black/35 px-1.5 py-0.5 text-[9px] text-white backdrop-blur-sm">
          <Play className="h-2.5 w-2.5 fill-current" />
          {formatNumber(playlist.playCount)}
        </div>
        <span className="media-chip absolute bottom-2 right-2 flex h-8 w-8 translate-y-1 items-center justify-center rounded-full bg-white/90 text-[#0066cc] opacity-0 shadow-md transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100">
          <Play className="ml-0.5 h-3.5 w-3.5 fill-current" />
        </span>
      </div>
      <p className="line-clamp-2 mt-2.5 min-h-[34px] px-0.5 text-[12px] leading-[1.4] text-black/75">
        {playlist.name}
      </p>
    </div>
  )
}
