import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { ListPlus, Play } from 'lucide-react'
import { Button } from '@pikoloo/darwin-ui'
import { usePlayerStore } from '../../store/player'
import { toast } from '../../lib/toast'
import { cn } from '../../lib/format'
import type { Song } from '../../types'

interface PlayAllButtonProps {
  songs: Song[]
  playlistId: string
  label?: string
  /**
   * `tinted`: a light accent pill the height of the tab group, for toolbars
   * where a solid accent button would outweigh everything else.
   */
  tone?: 'solid' | 'tinted'
}

export function PlayAllButton({ songs, playlistId, label, tone = 'solid' }: PlayAllButtonProps) {
  const { i18n } = useLingui()
  const text = label ?? i18n._(msg`播放全部`)
  const initQueue = usePlayerStore((state) => state.initQueue)
  const addToQueue = usePlayerStore((state) => state.addToQueue)

  const handlePlayAll = () => {
    if (!songs.length) {
      toast.warning(i18n._(msg`暂无可播放歌曲`))
      return
    }
    void initQueue(songs, 0, playlistId)
  }

  if (tone === 'tinted') {
    return (
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={handlePlayAll}
          className="pressable inline-flex h-8 items-center gap-1.5 rounded-full bg-accent/12 px-3.5 text-[13px] font-medium text-accent transition-colors hover:bg-accent/20"
        >
          <Play className="h-3.5 w-3.5 fill-current" />
          {text}
        </button>
        <button
          type="button"
          onClick={() => addToQueue(songs)}
          title={i18n._(msg`添加全部到播放列表`)}
          aria-label={i18n._(msg`添加全部到播放列表`)}
          className={cn(
            'pressable inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-3 transition-colors',
            'bg-black/[0.05] hover:bg-black/[0.09] hover:text-ink-2 dark:bg-white/[0.08] dark:hover:bg-white/[0.14]',
          )}
        >
          <ListPlus className="h-3.5 w-3.5" />
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="primary"
        size="sm"
        className="pressable rounded-full px-4 text-[13px]"
        onClick={handlePlayAll}
      >
        <Play className="mr-1.5 h-3.5 w-3.5 fill-current" />
        {text}
      </Button>
      <Button
        variant="secondary"
        size="sm"
        className="pressable rounded-full px-3 text-[12px]"
        onClick={() => addToQueue(songs)}
        title={i18n._(msg`添加全部到播放列表`)}
      >
        <ListPlus className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}
