import { useNavigate, useRouterState } from '@tanstack/react-router'
import {
  Disc3,
  Film,
  Heart,
  ListMusic,
  Music2,
  Plus,
  Sparkles,
  Star,
  UserRound,
} from 'lucide-react'
import { Button } from '@pikoloo/darwin-ui'
import { ImageWithFallback } from '../common/ImageWithFallback'
import { usePlayerStore } from '../../store/player'
import { useUserStore } from '../../store/user'
import { useUiStore } from '../../store/ui'
import { cn } from '../../lib/format'

const primaryNav = [
  { to: '/', label: '发现音乐', icon: Sparkles },
  { to: '/songlists', label: '推荐歌单', icon: ListMusic },
  { to: '/latest-music', label: '最新音乐', icon: Music2 },
  { to: '/latest-mv', label: '最新MV', icon: Film },
] as const

export function Sidebar() {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const navigate = useNavigate()
  const openLogin = useUiStore((state) => state.openLogin)
  const isLogin = useUserStore((state) => state.isLogin)
  const profile = useUserStore((state) => state.profile)
  const createdPlaylists = useUserStore((state) => state.createdPlaylists)
  const collectedPlaylists = useUserStore((state) => state.collectedPlaylists)
  const queue = usePlayerStore((state) => state.queue)
  const showNowPlaying = usePlayerStore((state) => state.showNowPlaying)
  const toggleNowPlaying = usePlayerStore((state) => state.toggleNowPlaying)

  const likedPlaylist = createdPlaylists[0]
  const myPlaylists = createdPlaylists.slice(1)

  const goPlaylist = (id: number) => {
    void navigate({ to: '/songlists/$id', params: { id: String(id) } })
  }

  const isActive = (to: string) => {
    if (to === '/') return pathname === '/'
    if (to === '/songlists') return pathname === '/songlists' || pathname === '/songlists/'
    return pathname.startsWith(to)
  }

  const playlistActive = (id: number) => pathname === `/songlists/${id}`

  return (
    <aside className="sidebar-glass select-none">
      <div className="flex-1 overflow-y-auto px-3 pb-4 pt-4">
        <p className="eyebrow px-2.5 pb-1.5">浏览</p>
        <nav className="flex flex-col gap-0.5">
          {primaryNav.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.to}
                type="button"
                onClick={() => void navigate({ to: item.to })}
                className={cn(
                  'flex h-[30px] items-center gap-2.5 rounded-[10px] px-2.5 max-md:h-10 text-left text-[12.5px] transition-colors',
                  isActive(item.to)
                    ? 'bg-black/8 font-medium text-black'
                    : 'text-black/65 hover:bg-black/4 hover:text-black',
                )}
              >
                <Icon
                  className={cn(
                    'h-[15px] w-[15px] shrink-0',
                    isActive(item.to) ? 'text-accent' : 'text-black/40',
                  )}
                  strokeWidth={1.9}
                />
                {item.label}
              </button>
            )
          })}
        </nav>

        <div className="my-3 h-px bg-black/8" />

        {queue.length > 0 && (
          <button
            type="button"
            onClick={() => toggleNowPlaying(true)}
            className={cn(
              'mb-1 flex h-[30px] w-full items-center gap-2.5 rounded-[10px] px-2.5 max-md:h-10 text-left text-[12.5px] transition-colors',
              showNowPlaying
                ? 'bg-black/8 font-medium text-black'
                : 'text-black/65 hover:bg-black/4 hover:text-black',
            )}
          >
            <Disc3
              className={cn(
                'h-[15px] w-[15px] shrink-0',
                showNowPlaying ? 'text-accent' : 'text-black/40',
              )}
              strokeWidth={1.9}
            />
            正在播放
          </button>
        )}

        <p className="eyebrow px-2.5 pb-1.5 pt-2">我的音乐</p>

        {!isLogin ? (
          <div className="mt-1 rounded-[14px] border border-black/8 bg-white/55 p-3">
            <div className="flex items-center gap-2 text-[12px] text-black/45">
              <UserRound className="h-4 w-4" />
              登录后查看我的歌单
            </div>
            <Button
              size="sm"
              variant="primary"
              fullWidth
              className="mt-2.5 rounded-full"
              onClick={openLogin}
            >
              登录
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {likedPlaylist && (
              <button
                type="button"
                onClick={() => goPlaylist(likedPlaylist.id)}
                className={cn(
                  'flex h-[30px] items-center gap-2.5 rounded-[10px] px-2.5 max-md:h-10 text-left text-[12.5px] transition-colors',
                  playlistActive(likedPlaylist.id)
                    ? 'bg-black/8 font-medium text-black'
                    : 'text-black/65 hover:bg-black/4 hover:text-black',
                )}
              >
                <Heart className="h-[15px] w-[15px] shrink-0 text-[#ff2d55]" strokeWidth={2} />
                <span className="truncate">我喜欢的音乐</span>
              </button>
            )}

            {myPlaylists.length > 0 && (
              <p className="px-2.5 pb-1 pt-3 text-[11px] font-medium text-black/35">创建的歌单</p>
            )}
            {myPlaylists.map((playlist) => (
              <PlaylistRow
                key={playlist.id}
                playlist={playlist}
                active={playlistActive(playlist.id)}
                onClick={() => goPlaylist(playlist.id)}
              />
            ))}

            {collectedPlaylists.length > 0 && (
              <p className="px-2.5 pb-1 pt-3 text-[11px] font-medium text-black/35">收藏的歌单</p>
            )}
            {collectedPlaylists.map((playlist) => (
              <PlaylistRow
                key={playlist.id}
                playlist={playlist}
                active={playlistActive(playlist.id)}
                onClick={() => goPlaylist(playlist.id)}
                star
              />
            ))}

            {!createdPlaylists.length && !collectedPlaylists.length && profile && (
              <p className="px-2.5 py-2 text-[11px] text-black/30">暂无歌单</p>
            )}
          </div>
        )}
      </div>

      <div className="border-t border-black/8 px-3 py-3">
        <div className="flex items-center gap-2 text-[11px] text-black/35">
          <Plus className="h-3.5 w-3.5" />
          本地接口 · 网易云音乐
        </div>
      </div>
    </aside>
  )
}

function PlaylistRow({
  playlist,
  active,
  onClick,
  star,
}: {
  playlist: { id: number; name: string; coverImgUrl: string }
  active: boolean
  onClick: () => void
  star?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex h-[32px] items-center gap-2 rounded-[10px] px-2 text-left transition-colors max-md:h-10',
        active ? 'bg-black/8' : 'hover:bg-black/4',
      )}
    >
      <ImageWithFallback
        src={playlist.coverImgUrl}
        alt={playlist.name}
        rounded="rounded-[6px]"
        className="h-[22px] w-[22px] shrink-0"
        resize="64y64"
      />
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-[12px]',
          active ? 'font-medium text-black' : 'text-black/60',
        )}
      >
        {playlist.name}
      </span>
      {star ? <Star className="h-3 w-3 shrink-0 text-black/25" /> : null}
    </button>
  )
}
