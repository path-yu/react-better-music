import type { CSSProperties } from 'react'
import { I18nProvider } from '@videojs/react/i18n'
import { Video, VideoPlayer, VideoSkin } from '@videojs/react/video'
import '@videojs/react/video/skin.css'

interface MvVideoPlayerProps {
  src: string
  poster?: string
  autoPlay?: boolean
  onPlay?: () => void
  onEnded?: () => void
}

/**
 * Video.js 10 skin tuned to the app's macOS look: frosted control bar, Apple
 * blue accent and the same 16px radius / font stack as the rest of the UI.
 * The packaged skin only exposes CSS custom properties, see
 * https://videojs.org/docs/framework/react/guides/customize-skins
 *
 * The skin ships a dark-only palette, so the light-mode tokens are remapped in
 * `src/styles.css` (search for "Video.js 10 player skin").
 */
const skinStyle = {
  width: '100%',
  aspectRatio: '16 / 9',
  '--media-accent-color': 'var(--apple-blue)',
  // Set explicitly: `contrast-color()` is not available in older WebViews.
  '--media-accent-text-color': '#ffffff',
  '--media-border-color': 'transparent',
  '--media-border-radius': '16px',
  '--media-font-family': 'var(--font-apple)',
  // `contain` keeps 4:3 MVs from being cropped; the shell is already 16:9.
  '--media-object-fit': 'contain',
} as CSSProperties

export function MvVideoPlayer({
  src,
  poster,
  autoPlay = false,
  onPlay,
  onEnded,
}: MvVideoPlayerProps) {
  return (
    <VideoPlayer>
      <I18nProvider locale="zh-CN">
        <VideoSkin style={skinStyle}>
          <Video
            src={src}
            poster={poster}
            autoPlay={autoPlay}
            playsInline
            preload="metadata"
            onPlay={onPlay}
            onEnded={onEnded}
          />
        </VideoSkin>
      </I18nProvider>
    </VideoPlayer>
  )
}
