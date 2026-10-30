import { useMemo } from 'react'
import { cn } from '../../lib/format'
import {
  FALLBACK_PALETTE,
  type Palette,
  withAlpha,
} from '../../lib/color'

type Props = {
  artwork: string
  palette: Palette
  /** 播放中时色斑更亮，暂停时整体压暗。 */
  playing?: boolean
  className?: string
}

/**
 * Apple Music 风格"动态渐变背景"
 * 组成：封面超采样模糊层（Ken Burns 缓慢游移）
 *      + 5 团从封面取色的漂浮色斑（各自不同周期，永不重复）
 *      + 颗粒噪点 + 暗角 + 顶部高光
 */
export default function AmbientBackground({
  artwork,
  palette,
  playing = false,
  className,
}: Props) {
  const colors = palette.colors.length ? palette.colors : FALLBACK_PALETTE.colors

  // 色斑配置：位置 / 尺寸 / 动画周期各不相同，叠加出持续的"流动感"
  const blobs = useMemo(
    () => [
      { c: colors[0], size: 78, x: '6%', y: '-8%', anim: 'am-drift-a', dur: 27, blend: 'screen', o: 0.62 },
      { c: colors[1], size: 66, x: '52%', y: '6%', anim: 'am-drift-b', dur: 34, blend: 'screen', o: 0.55 },
      { c: colors[2], size: 58, x: '18%', y: '48%', anim: 'am-drift-c', dur: 23, blend: 'screen', o: 0.5 },
      { c: colors[3], size: 46, x: '62%', y: '52%', anim: 'am-drift-d', dur: 30, blend: 'screen', o: 0.45 },
      { c: colors[4], size: 70, x: '-14%', y: '34%', anim: 'am-drift-e', dur: 41, blend: 'normal', o: 0.6 },
    ],
    [colors],
  )

  return (
    <div
      className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}
    >
      {/* 1. 封面本体放大 + 重度模糊：这是底色的来源 */}
      <div className="absolute inset-0 scale-[2.6]">
        <img
          src={artwork}
          alt=""
          aria-hidden
          className="am-kenburns h-full w-full object-cover opacity-90 blur-[120px] saturate-[2] contrast-[1.05]"
        />
      </div>
      {/* 2. 取色色斑（暂停时整体压暗，突出"静止"感） */}
      <div className="absolute inset-0 transition-opacity duration-1000" style={{ opacity: playing ? 1 : 0.75 }}>
        {blobs.map((b, i) => (
          <div
            key={i}
            className={cn(
              'absolute rounded-full transition-colors duration-[1600ms] ease-out',
              b.anim,
            )}
            style={{
              width: `${b.size}vmax`,
              height: `${b.size}vmax`,
              left: b.x,
              top: b.y,
              backgroundColor: b.c,
              opacity: b.o,
              filter: 'blur(90px)',
              mixBlendMode: b.blend as 'screen' | 'normal',
              // The shared `.am-drift-*` rule only declares timing; the name
              // must be supplied here or the blobs never move at all.
              animationName: b.anim,
              animationDuration: `${b.dur}s`,
              animationDelay: `${-i * 3.5}s`,
            }}
          />
        ))}
      </div>

      {/* 3. 让整体变暗、变柔和，突出前景 UI */}
      <div className="absolute inset-0 bg-[radial-gradient(120%_120%_at_50%_45%,rgba(0,0,0,0.12)_0%,rgba(0,0,0,0.42)_60%,rgba(0,0,0,0.66)_100%)]" />
      <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-black/35 to-transparent" />

      {/* 4. 细颗粒噪点，避免大面积渐变出现色带 */}
      <div
        className="am-grain absolute inset-0 opacity-[0.16] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)' opacity='0.55'/%3E%3C/svg%3E\")",
        }}
      />
    </div>
  )
}

/** 取色失败 / 加载中时铺底的静态渐变，避免闪白 */
export function FallbackWash({ palette }: { palette: Palette }) {
  const [a, b, c] = palette.colors
  return (
    <div
      className="absolute inset-0"
      style={{
        background: `radial-gradient(70% 70% at 15% 10%, ${a} 0%, transparent 60%),
                    radial-gradient(70% 70% at 85% 25%, ${b} 0%, transparent 60%),
                    radial-gradient(80% 80% at 50% 100%, ${c} 0%, transparent 65%),
                    linear-gradient(140deg, ${withAlpha(a, 0.9)}, ${withAlpha(b, 0.9)})`,
      }}
    />
  )
}
