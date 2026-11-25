import type { ReactNode } from 'react'
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
  /** Corner chip over the cover, e.g. a "本地" marker. */
  badge?: ReactNode
}

export function AlbumCard({
  album,
  priority = false,
  badge,
}: AlbumCardProps) {
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
      className="apple-card group p-2.5 text-left"
    >
      <div className="album-card-cover relative rounded-[10px]">
        <ImageWithFallback
          src={album.picUrl ?? album.blurPicUrl}
          alt={album.name}
          rounded="rounded-[10px]"
          resize="300y300"
          priority={priority}
          className="aspect-square w-full"
        />
        {badge ? (
          <span className="absolute right-1.5 top-1.5 rounded-full bg-black/45 px-1.5 py-0.5 text-[11px] leading-none text-white backdrop-blur-sm">
            {badge}
          </span>
        ) : null}
      </div>
      <span className="mt-2 line-clamp-2 block min-h-[34px] text-[12px] leading-[1.4] text-ink-2 transition-colors group-hover:text-accent">
        {album.name}
      </span>
      <span className="mt-0.5 block truncate text-[11px] text-ink-4">
        {subtitle}
        {album.size ? (
          <Trans> · {album.size} 首</Trans>
        ) : null}
      </span>
    </button>
  )
}
