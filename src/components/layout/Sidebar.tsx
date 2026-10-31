import { useState, type FormEvent } from 'react'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { Trans } from '@lingui/react/macro'
import {
  ChartNoAxesColumnIncreasing,
  Disc3,
  Film,
  Heart,
  History,
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
import { useLocalLibraryStore } from '../../store/localLibrary'
import { cn } from '../../lib/format'

const primaryNav = [
  { to: '/', label: msg`发现音乐`, icon: Sparkles },
  { to: '/songlists', label: msg`推荐歌单`, icon: ListMusic },
  { to: '/toplist', label: msg`排行榜`, icon: ChartNoAxesColumnIncreasing },
  { to: '/latest-music', label: msg`最新音乐`, icon: Music2 },
  { to: '/latest-mv', label: msg`最新MV`, icon: Film },
] as const

export function Sidebar() {
  const { i18n } = useLingui()
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
  const localPlaylists = useLocalLibraryStore((state) => state.playlists)
  const localSubscribedPlaylists = useLocalLibraryStore(
    (state) => state.subscribedPlaylists,
  )
  const localFavorites = useLocalLibraryStore((state) => state.favorites)
  const localRecent = useLocalLibraryStore((state) => state.recent)
  const createLocalPlaylist = useLocalLibraryStore((state) => state.createPlaylist)
  const [creatingPlaylist, setCreatingPlaylist] = useState(false)
  const [playlistName, setPlaylistName] = useState('')

  const submitPlaylist = async (event: FormEvent) => {
    event.preventDefault()
    const name = playlistName.trim()
    if (!name) return
    const playlist = await createLocalPlaylist(name)
    if (!playlist) return
    setPlaylistName('')
    setCreatingPlaylist(false)
    void navigate({
      to: '/local/playlists/$id',
      params: { id: playlist.id },
    })
  }

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
        <p className="eyebrow px-2.5 pb-1.5">
          <Trans>浏览</Trans>
        </p>
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
                    'h-4 w-4 shrink-0',
                    isActive(item.to) ? 'text-accent' : 'text-black/40',
                  )}
                  strokeWidth={1.75}
                />
                {i18n._(item.label)}
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
                'h-4 w-4 shrink-0',
                showNowPlaying ? 'text-accent' : 'text-black/40',
              )}
              strokeWidth={1.75}
            />
            <Trans>正在播放</Trans>
          </button>
        )}

        <p className="eyebrow px-2.5 pb-1.5 pt-2">
          <Trans>我的音乐</Trans>
        </p>

        {!isLogin ? (
          <div className="flex flex-col gap-0.5">
            <button
              type="button"
              onClick={() => void navigate({ to: '/local/favorites' })}
              className={cn(
                'flex h-[30px] items-center gap-2.5 rounded-[10px] px-2.5 max-md:h-10 text-left text-[12.5px] transition-colors',
                isActive('/local/favorites')
                  ? 'bg-black/8 font-medium text-black'
                  : 'text-black/65 hover:bg-black/4 hover:text-black',
              )}
            >
              <Heart
                className={cn(
                  'h-4 w-4 shrink-0',
                  isActive('/local/favorites') ? 'text-accent' : 'text-[#ff2d55]',
                )}
                strokeWidth={1.75}
              />
              <span className="min-w-0 flex-1 truncate">
                <Trans>我喜欢的音乐</Trans>
              </span>
              {localFavorites.length ? (
                <span className="text-[10px] text-black/25">{localFavorites.length}</span>
              ) : null}
            </button>

            <button
              type="button"
              onClick={() => void navigate({ to: '/recent' })}
              className={cn(
                'flex h-[30px] items-center gap-2.5 rounded-[10px] px-2.5 max-md:h-10 text-left text-[12.5px] transition-colors',
                isActive('/recent')
                  ? 'bg-black/8 font-medium text-black'
                  : 'text-black/65 hover:bg-black/4 hover:text-black',
              )}
            >
              <History
                className={cn(
                  'h-4 w-4 shrink-0',
                  isActive('/recent') ? 'text-accent' : 'text-black/40',
                )}
                strokeWidth={1.75}
              />
              <span className="min-w-0 flex-1 truncate">
                <Trans>最近播放</Trans>
              </span>
              {localRecent.length ? (
                <span className="text-[10px] text-black/25">{localRecent.length}</span>
              ) : null}
            </button>

            <div className="flex items-center justify-between px-2.5 pb-1 pt-3">
              <p className="text-[11px] font-medium text-black/35">
                <Trans>本地歌单</Trans>
              </p>
              <button
                type="button"
                aria-label={i18n._(msg`创建歌单`)}
                title={i18n._(msg`创建歌单`)}
                onClick={() => setCreatingPlaylist((value) => !value)}
                className="pressable flex h-4 w-4 items-center justify-center rounded-full text-black/35 hover:text-black/70"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>

            {creatingPlaylist ? (
              <form onSubmit={(event) => void submitPlaylist(event)} className="px-1 pb-1.5">
                <input
                  autoFocus
                  value={playlistName}
                  onChange={(event) => setPlaylistName(event.target.value)}
                  maxLength={60}
                  placeholder={i18n._(msg`歌单名称`)}
                  className="h-7 w-full rounded-[7px] border border-black/10 bg-white/70 px-2 text-[11px] outline-none focus:border-accent/50"
                />
                <div className="mt-1 flex justify-end gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setCreatingPlaylist(false)
                      setPlaylistName('')
                    }}
                    className="rounded-full px-2 py-1 text-[10px] text-black/35 hover:bg-black/5"
                  >
                    <Trans>取消</Trans>
                  </button>
                  <button
                    type="submit"
                    disabled={!playlistName.trim()}
                    className="rounded-full bg-accent px-2.5 py-1 text-[10px] text-white disabled:opacity-40"
                  >
                    <Trans>创建</Trans>
                  </button>
                </div>
              </form>
            ) : null}

            {localPlaylists.map((playlist) => (
              <button
                key={playlist.id}
                type="button"
                onClick={() =>
                  void navigate({
                    to: '/local/playlists/$id',
                    params: { id: playlist.id },
                  })
                }
                className={cn(
                  'flex h-[30px] items-center gap-2.5 rounded-[10px] px-2.5 max-md:h-10 text-left text-[12.5px] transition-colors',
                  pathname === `/local/playlists/${playlist.id}`
                    ? 'bg-black/8 font-medium text-black'
                    : 'text-black/65 hover:bg-black/4 hover:text-black',
                )}
              >
                <ListMusic className="h-4 w-4 shrink-0 text-black/40" strokeWidth={1.75} />
                <span className="min-w-0 flex-1 truncate">{playlist.name}</span>
                <span className="text-[10px] text-black/25">{playlist.songs.length}</span>
              </button>
            ))}

            {!localPlaylists.length && !creatingPlaylist ? (
              <p className="px-2.5 py-2 text-[11px] text-black/30">
                <Trans>暂无本地歌单</Trans>
              </p>
            ) : null}

            {localSubscribedPlaylists.length ? (
              <>
                <p className="px-2.5 pb-1 pt-3 text-[11px] font-medium text-black/35">
                  <Trans>收藏的歌单</Trans>
                </p>
                {localSubscribedPlaylists.map((playlist) => (
                  <button
                    key={playlist.id}
                    type="button"
                    onClick={() =>
                      void navigate({
                        to: '/songlists/$id',
                        params: { id: String(playlist.id) },
                      })
                    }
                    className={cn(
                      'flex h-[30px] items-center gap-2.5 rounded-[10px] px-2.5 max-md:h-10 text-left text-[12.5px] transition-colors',
                      pathname === `/songlists/${playlist.id}`
                        ? 'bg-black/8 font-medium text-black'
                        : 'text-black/65 hover:bg-black/4 hover:text-black',
                    )}
                  >
                    <ListMusic
                      className="h-4 w-4 shrink-0 text-black/40"
                      strokeWidth={1.75}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {playlist.name}
                    </span>
                  </button>
                ))}
              </>
            ) : null}

            <div className="mt-2 rounded-[14px] border border-black/8 bg-white/55 p-3">
              <div className="flex items-center gap-2 text-[12px] text-black/45">
                <UserRound className="h-4 w-4" />
                <Trans>登录后可同步网易云歌单</Trans>
              </div>
              <Button
                size="sm"
                variant="primary"
                fullWidth
                className="mt-2.5 rounded-full"
                onClick={openLogin}
              >
                <Trans>登录</Trans>
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            <button
              type="button"
              onClick={() => void navigate({ to: '/recent' })}
              className={cn(
                'flex h-[30px] items-center gap-2.5 rounded-[10px] px-2.5 max-md:h-10 text-left text-[12.5px] transition-colors',
                isActive('/recent')
                  ? 'bg-black/8 font-medium text-black'
                  : 'text-black/65 hover:bg-black/4 hover:text-black',
              )}
            >
              <History
                className={cn(
                  'h-4 w-4 shrink-0',
                  isActive('/recent') ? 'text-accent' : 'text-black/40',
                )}
                strokeWidth={1.75}
              />
              <Trans>最近播放</Trans>
            </button>

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
                <Heart className="h-4 w-4 shrink-0 text-[#ff2d55]" strokeWidth={1.75} />
                <span className="truncate">
                  <Trans>我喜欢的音乐</Trans>
                </span>
              </button>
            )}

            {myPlaylists.length > 0 && (
              <p className="px-2.5 pb-1 pt-3 text-[11px] font-medium text-black/35">
                <Trans>创建的歌单</Trans>
              </p>
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
              <p className="px-2.5 pb-1 pt-3 text-[11px] font-medium text-black/35">
                <Trans>收藏的歌单</Trans>
              </p>
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
              <p className="px-2.5 py-2 text-[11px] text-black/30">
                <Trans>暂无歌单</Trans>
              </p>
            )}
          </div>
        )}
      </div>

      <div className="border-t border-black/8 px-3 py-3">
        <div className="flex items-center gap-2 text-[11px] text-black/35">
          <Plus className="h-3.5 w-3.5" />
          <Trans>本地接口 · 网易云音乐</Trans>
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
