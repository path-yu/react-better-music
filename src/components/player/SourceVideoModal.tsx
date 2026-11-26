import { useEffect, useRef } from 'react'
import { Trans } from '@lingui/react/macro'
import { X } from 'lucide-react'
import { usePlayerStore } from '../../store/player'

/**
 * Plays the bilibili / YouTube page the current track was matched to.
 *
 * Those sites cannot be fed to a `<video>` element (the player JS decrypts the
 * streams), so the official embed is used instead. Opening it pauses the music
 * and closing it resumes, mirroring the MV page behaviour.
 */
export function SourceVideoModal({
  open,
  onClose,
  source,
  webUrl,
  title,
}: {
  open: boolean
  onClose: () => void
  source: 'bilibili' | 'youtube'
  webUrl: string
  title?: string
}) {
  const wasPlayingRef = useRef(false)

  useEffect(() => {
    if (!open) return
    const state = usePlayerStore.getState()
    if (state.playing) {
      wasPlayingRef.current = true
      state.setPlaying(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      if (!wasPlayingRef.current) return
      wasPlayingRef.current = false
      usePlayerStore.getState().setPlaying(true)
    }
  }, [open, onClose])

  if (!open) return null

  const bvid = webUrl.match(/bilibili\.com\/video\/(BV[\w]+)/i)?.[1]
  const youtubeId =
    webUrl.match(/[?&]v=([\w-]{6,})/)?.[1] ??
    webUrl.match(/youtu\.be\/([\w-]{6,})/)?.[1]

  const embed =
    source === 'bilibili' && bvid
      ? `https://player.bilibili.com/player.html?bvid=${bvid}&autoplay=1&high_quality=1&danmaku=0`
      : youtubeId
        ? `https://www.youtube.com/embed/${youtubeId}?autoplay=1&rel=0`
        : ''

  return (
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={title ?? 'video'}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[1100px]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="min-w-0 truncate text-[13px] text-white/80">
            {title || (source === 'bilibili' ? 'Bilibili' : 'YouTube')}
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label="close"
            className="pressable flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/10 text-white/75 transition-colors hover:bg-white/20 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="relative aspect-video w-full overflow-hidden rounded-[14px] bg-black">
          {embed ? (
            <iframe
              key={embed}
              src={embed}
              title={title ?? 'video'}
              className="absolute inset-0 h-full w-full"
              allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
              allowFullScreen
            />
          ) : (
            <div className="flex h-full items-center justify-center text-[12px] text-white/45">
              <Trans>无法解析视频地址</Trans>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
