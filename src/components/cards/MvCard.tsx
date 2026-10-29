import { useNavigate } from '@tanstack/react-router'
import { Play } from 'lucide-react'
import { ImageWithFallback } from '../common/ImageWithFallback'
import { formatDuration, formatNumber } from '../../lib/format'
import type { Mv } from '../../types'

interface MvCardProps {
  mv: Mv
  className?: string
  /** The first row of a grid is above the fold: load it eagerly. */
  priority?: boolean
}

export function MvCard({ mv, className, priority }: MvCardProps) {
  const navigate = useNavigate()

  return (
    <button
      type="button"
      onClick={() => void navigate({ to: '/mv/$id', params: { id: String(mv.id) } })}
      className={`group cursor-pointer text-left ${className ?? ''}`}
    >
      <div className="relative overflow-hidden rounded-[14px]">
        <ImageWithFallback
          src={mv.cover}
          alt={mv.name}
          rounded="rounded-[14px]"
          resize="320y180"
          priority={priority}
          className="aspect-video w-full"
          imageClassName="transition-transform duration-500 group-hover:scale-[1.04]"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent opacity-70" />
        <div className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-black/30 px-1.5 py-0.5 text-[11px] text-white backdrop-blur-sm">
          <Play className="h-3 w-3 fill-current" />
          {formatNumber(mv.playCount)}
        </div>
        {mv.duration ? (
          <span className="absolute bottom-2 right-2 rounded-full bg-black/35 px-1.5 py-0.5 text-[11px] tabular-nums text-white/90 backdrop-blur-sm">
            {formatDuration(mv.duration)}
          </span>
        ) : null}
        <span className="media-chip absolute bottom-2 left-2 flex h-8 w-8 translate-y-1 items-center justify-center rounded-full bg-white/90 text-accent opacity-0 shadow-md transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100">
          <Play className="ml-0.5 h-3.5 w-3.5 fill-current" />
        </span>
      </div>
      <p className="mt-2 line-clamp-1 text-[12.5px] font-medium text-black/75 group-hover:text-accent">
        {mv.name}
      </p>
      <p className="mt-0.5 line-clamp-1 text-[11px] text-black/35">{mv.artistName}</p>
    </button>
  )
}
