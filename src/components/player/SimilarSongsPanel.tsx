import { useEffect, useState } from 'react'
import { Trans } from '@lingui/react/macro'
import { Loader2, Play } from 'lucide-react'
import { fetchSimilarSongs } from '../../api'
import { ImageWithFallback } from '../common/ImageWithFallback'
import { ArtistLinks } from '../common/ArtistLinks'
import { formatDuration } from '../../lib/format'
import { usePlayerStore } from '../../store/player'
import type { Song } from '../../types'

export function SimilarSongsPanel({
  songId,
  className,
}: {
  songId: number
  className?: string
}) {
  const playSong = usePlayerStore((state) => state.playSong)
  const [songs, setSongs] = useState<Song[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setFailed(false)
    void fetchSimilarSongs(songId, controller.signal)
      .then((items) => {
        if (controller.signal.aborted) return
        setSongs(items.filter((song) => song.id !== songId))
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setSongs([])
          setFailed(true)
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [songId])

  if (loading) {
    return (
      <div
        className={className}
        role="status"
        aria-live="polite"
      >
        <div className="flex h-full min-h-[220px] flex-col items-center justify-center gap-2.5 text-[12px] text-white/40">
          <Loader2 className="h-4 w-4 animate-spin text-accent" />
          <Trans>正在加载相似歌曲…</Trans>
        </div>
      </div>
    )
  }

  if (failed) {
    return (
      <div className={className}>
        <div className="flex h-full min-h-[220px] items-center justify-center text-[12px] text-white/45">
          <Trans>相似歌曲加载失败</Trans>
        </div>
      </div>
    )
  }

  if (!songs.length) {
    return (
      <div className={className}>
        <div className="flex h-full min-h-[220px] items-center justify-center text-[12px] text-white/45">
          <Trans>暂无相似歌曲</Trans>
        </div>
      </div>
    )
  }

  return (
    <div className={className}>
      <div className="flex h-full flex-col">
        <div className="flex shrink-0 items-center justify-between px-3 pb-2 pt-3">
          <p className="text-[11px] text-white/40">
            <Trans>根据当前歌曲推荐</Trans>
          </p>
          <span className="text-[10px] tabular-nums text-white/25">
            {songs.length}
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {songs.map((song, index) => (
            <div
              key={`${song.id}-${index}`}
              role="button"
              tabIndex={0}
              title={song.name}
              onClick={() => void playSong(song)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  void playSong(song)
                }
              }}
              className="group flex w-full cursor-pointer items-center gap-3 rounded-[10px] px-2 py-2 text-left transition-colors hover:bg-white/7 focus-visible:bg-white/7 focus-visible:outline-none"
            >
              <span className="w-5 shrink-0 text-right text-[10px] tabular-nums text-white/25">
                {String(index + 1).padStart(2, '0')}
              </span>
              <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-[7px]">
                <ImageWithFallback
                  src={song.al.picUrl}
                  alt={song.name}
                  rounded="rounded-[7px]"
                  className="h-full w-full"
                  resize="96y96"
                />
                <span className="absolute inset-0 flex items-center justify-center bg-black/25 opacity-0 transition-opacity group-hover:opacity-100">
                  <Play className="h-3.5 w-3.5 fill-white text-white" />
                </span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] text-white/85">
                  {song.name}
                </span>
                <ArtistLinks
                  artists={song.ar}
                  className="mt-0.5 block truncate text-[10.5px] text-white/40"
                />
              </span>
              <span className="shrink-0 text-[10px] tabular-nums text-white/30">
                {formatDuration(song.dt)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
