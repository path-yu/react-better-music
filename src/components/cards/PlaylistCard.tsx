import { useNavigate } from '@tanstack/react-router'
import { Play } from 'lucide-react'
import { ImageWithFallback } from '../common/ImageWithFallback'
import { formatNumber } from '../../lib/format'
import type { Playlist } from '../../types'

interface PlaylistCardProps {
  playlist: Playlist
  priority?: boolean
}

export function PlaylistCard({ playlist, priority }: PlaylistCardProps) {
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
      className="group flex cursor-pointer flex-col gap-2.5 text-left"
    >
      <div className="relative aspect-square w-full overflow-hidden rounded-[10px] shadow-[0_2px_8px_-2px_rgba(0,0,0,0.16)] transition-[transform,box-shadow] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:-translate-y-[3px] group-hover:shadow-[0_12px_28px_-6px_rgba(0,0,0,0.28)]">
        <ImageWithFallback
          src={playlist.coverImgUrl}
          alt={playlist.name}
          rounded="rounded-[10px]"
          resize="200y200"
          priority={priority}
          className="h-full w-full"
        />
        <div className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded-full bg-black/35 px-1.5 py-0.5 text-[11px] text-white backdrop-blur-sm">
          <Play className="h-3 w-3 fill-current" />
          {formatNumber(playlist.playCount)}
        </div>
        <span className="media-chip absolute bottom-2 right-2 flex h-[38px] w-[38px] translate-y-1.5 scale-90 items-center justify-center rounded-full bg-accent text-white opacity-0 shadow-[0_4px_12px_rgba(0,0,0,0.3)] transition-all duration-300 group-hover:translate-y-0 group-hover:scale-100 group-hover:opacity-100">
          <Play className="ml-0.5 h-4 w-4 fill-current" />
        </span>
      </div>
      <p className="line-clamp-2 min-h-[35px] text-[13px] font-medium leading-[1.35] text-black/80 transition-colors group-hover:text-accent">
        {playlist.name}
      </p>
      {playlist.creator?.nickname ? (
        <p className="-mt-1 truncate text-[12px] text-black/35">
          {playlist.creator.nickname}
        </p>
      ) : null}
    </div>
  )
}
