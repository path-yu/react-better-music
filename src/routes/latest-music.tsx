import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Music2 } from 'lucide-react'
import { SongTable } from '../components/songs/SongTable'
import { PlayAllButton } from '../components/songs/PlayAllButton'
import { fetchNewSongs } from '../api'
import { cn } from '../lib/format'
import { useDocumentTitle } from '../lib/title'
import { toast } from '../lib/toast'
import type { Song } from '../types'

export const Route = createFileRoute('/latest-music')({
  component: LatestMusicPage,
})

const TYPES = [
  { value: 0, label: '全部' },
  { value: 7, label: '华语' },
  { value: 96, label: '欧美' },
  { value: 8, label: '日本' },
  { value: 16, label: '韩国' },
] as const

type NewSongType = (typeof TYPES)[number]['value']

function LatestMusicPage() {
  useDocumentTitle('最新音乐')
  const [type, setType] = useState<NewSongType>(0)
  const [songs, setSongs] = useState<Song[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchNewSongs(type)
      .then((list) => {
        if (!cancelled) setSongs(list)
      })
      .catch(() => {
        if (!cancelled) toast.error('新歌加载失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [type])

  return (
    <div className="px-8 pb-14 pt-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="headline-lg flex items-center gap-2">
            <Music2 className="h-5 w-5 text-[#0066cc]" />
            最新音乐
          </h1>
          <p className="mt-1.5 text-[12px] text-black/35">每日更新的华语与全球新歌速递</p>
        </div>
        <PlayAllButton songs={songs} playlistId={`top-song-${type}`} />
      </div>

      <div className="sticky top-0 z-20 -mx-8 mt-4 flex gap-1.5 bg-white/88 px-8 py-2.5 backdrop-blur-xl">
        {TYPES.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => setType(item.value)}
            className={cn(
              'rounded-full px-3.5 py-1.5 text-[11.5px] transition-colors',
              type === item.value
                ? 'bg-[#0066cc] text-white'
                : 'border border-black/8 bg-[#f5f5f7] text-black/55 hover:bg-[#ececf0] hover:text-black/75',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="mt-2">
        <SongTable
          songs={songs}
          playlistId={`top-song-${type}`}
          loading={loading}
          emptyText="暂无新歌"
        />
      </div>
    </div>
  )
}
