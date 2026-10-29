import { useNavigate } from '@tanstack/react-router'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { Trans } from '@lingui/react/macro'
import { ImageWithFallback } from '../common/ImageWithFallback'
import { formatDate } from '../../lib/format'
import type { Album } from '../../types'

interface AlbumCardProps {
  album: Album
  priority?: boolean
}

export function AlbumCard({ album, priority = false }: AlbumCardProps) {
  const { i18n } = useLingui()
  const navigate = useNavigate()
  const year = album.publishTime
    ? formatDate(album.publishTime).slice(0, 4)
    : ''
  const subtitle = album.artist?.name || year

  return (
    <button
      type="button"
      onClick={() =>
        void navigate({ to: '/albums/$id', params: { id: String(album.id) } })
      }
      aria-label={i18n._(msg`打开专辑 ${album.name}`)}
      className="apple-card group p-2.5 text-left transition-colors hover:bg-white/80"
    >
      <div className="relative overflow-hidden rounded-[10px] shadow-[0_10px_30px_-20px_rgba(0,0,0,0.32)]">
        <ImageWithFallback
          src={album.picUrl ?? album.blurPicUrl}
          alt={album.name}
          rounded="rounded-[10px]"
          resize="300y300"
          priority={priority}
          className="aspect-square w-full"
          imageClassName="transition-transform duration-500 group-hover:scale-[1.04]"
        />
      </div>
      <span className="mt-2 line-clamp-2 block min-h-[34px] text-[12px] leading-[1.4] text-black/75 transition-colors group-hover:text-accent">
        {album.name}
      </span>
      <span className="mt-0.5 block truncate text-[11px] text-black/30">
        {subtitle}
        {album.size ? (
          <Trans> · {album.size} 首</Trans>
        ) : null}
      </span>
    </button>
  )
}
