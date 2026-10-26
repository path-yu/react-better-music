import { ListPlus, Play } from 'lucide-react'
import { Button } from '@pikoloo/darwin-ui'
import { usePlayerStore } from '../../store/player'
import { toast } from '../../lib/toast'
import type { Song } from '../../types'

interface PlayAllButtonProps {
  songs: Song[]
  playlistId: string
  label?: string
}

export function PlayAllButton({ songs, playlistId, label = '播放全部' }: PlayAllButtonProps) {
  const initQueue = usePlayerStore((state) => state.initQueue)
  const addToQueue = usePlayerStore((state) => state.addToQueue)

  const handlePlayAll = () => {
    if (!songs.length) {
      toast.warning('暂无可播放歌曲')
      return
    }
    // Start from the first playable track: initQueue rejects an unplayable
    // target instead of silently falling back to index 0.
    const start = songs.findIndex((song) => song.fee !== 0)
    if (start < 0) {
      toast.warning('该列表暂无可播放歌曲')
      return
    }
    void initQueue(songs, start, playlistId)
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="primary"
        size="sm"
        className="pressable rounded-full px-4 text-[12.5px]"
        onClick={handlePlayAll}
      >
        <Play className="mr-1.5 h-3.5 w-3.5 fill-current" />
        {label}
      </Button>
      <Button
        variant="secondary"
        size="sm"
        className="pressable rounded-full px-3 text-[12px]"
        onClick={() => addToQueue(songs)}
        title="添加全部到播放列表"
      >
        <ListPlus className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}
