import { useRef, useState, type FormEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { Trans } from '@lingui/react/macro'
import {
  CalendarHeart,
  ChartNoAxesColumnIncreasing,
  ChevronDown,
  ChevronRight,
  Download,
  Film,
  Heart,
  History,
  ListMusic,
  Loader2,
  Music2,
  Pencil,
  Play,
  Plus,
  Search,
  Sparkles,
  StarOff,
  Trash2,
  UserRound,
  type LucideIcon,
} from 'lucide-react'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@pikoloo/darwin-ui'
import { ImageWithFallback } from '../common/ImageWithFallback'
import { SidebarMenu, type SidebarMenuItem } from './SidebarMenu'
import { useUserStore } from '../../store/user'
import { useUiStore } from '../../store/ui'
import { usePlayerStore } from '../../store/player'
import { useSidebarCollapsed } from '../../lib/useSidebarLayout'
import { useLocalLibraryStore } from '../../store/localLibrary'
import { useSearchStore } from '../../store/search'
import {
  createPlaylist,
  fetchPlaylistTracks,
  fetchRemainingPlaylistTracks,
  subscribeAlbum,
  updatePlaylistSubscribe,
} from '../../api'
import type {
  LocalPlaylist,
  LocalSubscribedAlbum,
  LocalSubscribedPlaylist,
} from '../../api/local'
import { invalidateApiCache } from '../../lib/http'
import { cn } from '../../lib/format'
import { toast } from '../../lib/toast'
import type { Playlist, Song } from '../../types'

const primaryNav = [
  { to: '/search', label: msg`搜索`, icon: Search },
  { to: '/', label: msg`发现音乐`, icon: Sparkles },
  { to: '/daily', label: msg`每日推荐`, icon: CalendarHeart },
  { to: '/songlists', label: msg`推荐歌单`, icon: ListMusic },
  { to: '/toplist', label: msg`排行榜`, icon: ChartNoAxesColumnIncreasing },
  { to: '/latest-music', label: msg`最新音乐`, icon: Music2 },
  { to: '/latest-mv', label: msg`最新 MV`, icon: Film },
] as const

export function Sidebar() {
  const { i18n } = useLingui()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const navigate = useNavigate()
  const openLogin = useUiStore((state) => state.openLogin)
  const openImportPlaylist = useUiStore((state) => state.openImportPlaylist)
  const collapsedGroups = useUiStore((state) => state.sidebarCollapsedGroups)
  const toggleGroup = useUiStore((state) => state.toggleSidebarGroup)
  const isLogin = useUserStore((state) => state.isLogin)
  const profile = useUserStore((state) => state.profile)
  const createdPlaylists = useUserStore((state) => state.createdPlaylists)
  const collectedPlaylists = useUserStore((state) => state.collectedPlaylists)
  const collectedAlbums = useUserStore((state) => state.collectedAlbums)
  const loadCollectedAlbums = useUserStore((state) => state.loadCollectedAlbums)
  const sidebarCollapsed = useSidebarCollapsed()
  const localPlaylists = useLocalLibraryStore((state) => state.playlists)
  const localSubscribedPlaylists = useLocalLibraryStore(
    (state) => state.subscribedPlaylists,
  )
  const localSubscribedAlbums = useLocalLibraryStore(
    (state) => state.subscribedAlbums,
  )
  const toggleLocalSubscribedAlbum = useLocalLibraryStore(
    (state) => state.toggleSubscribedAlbum,
  )
  const localFavorites = useLocalLibraryStore((state) => state.favorites)
  const localRecent = useLocalLibraryStore((state) => state.recent)
  const createLocalPlaylist = useLocalLibraryStore((state) => state.createPlaylist)
  const renameLocalPlaylist = useLocalLibraryStore((state) => state.renamePlaylist)
  const removeLocalPlaylist = useLocalLibraryStore((state) => state.removePlaylist)
  const toggleLocalSubscribed = useLocalLibraryStore(
    (state) => state.toggleSubscribedPlaylist,
  )
  const [creatingPlaylist, setCreatingPlaylist] = useState(false)
  const [creating, setCreating] = useState(false)
  const [playlistName, setPlaylistName] = useState('')
  const [menu, setMenu] = useState<{
    x: number
    y: number
    label: string
    items: SidebarMenuItem[]
  } | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const [deleting, setDeleting] = useState<LocalPlaylist | null>(null)
  const [loadingKey, setLoadingKey] = useState<string | null>(null)

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

  // Reopen the last search instead of resetting to an empty search page.
  const openSearch = () => {
    const { keyword, tab } = useSearchStore.getState()
    void navigate({ to: '/search', search: { keyword, tab } })
  }

  const playlistActive = (id: number) => pathname === `/songlists/${id}`

  const groupOpen = (group: string) => !collapsedGroups.includes(group)

  /* ------------------------------ actions ------------------------------ */

  const startCreating = (group: string) => {
    if (!groupOpen(group)) toggleGroup(group)
    setPlaylistName('')
    setCreatingPlaylist(true)
  }

  const submitPlaylist = async (event: FormEvent) => {
    event.preventDefault()
    const name = playlistName.trim()
    if (!name || creating) return
    setCreating(true)
    try {
      if (isLogin && profile) {
        const created = await createPlaylist(name)
        const id = created.id ?? created.playlist?.id
        if (!id) {
          toast.error(i18n._(msg`创建歌单失败`))
          return
        }
        // `/user/playlist` is cached; the new playlist must show up now.
        invalidateApiCache(['/user/playlist'])
        await useUserStore.getState().loadPlaylists(profile.userId)
        setCreatingPlaylist(false)
        setPlaylistName('')
        goPlaylist(id)
        return
      }
      const playlist = await createLocalPlaylist(name)
      if (!playlist) return
      setCreatingPlaylist(false)
      setPlaylistName('')
      void navigate({ to: '/local/playlists/$id', params: { id: playlist.id } })
    } finally {
      setCreating(false)
    }
  }

  const playSongs = async (key: string, load: () => Promise<Song[]> | Song[]) => {
    if (loadingKey) return
    setLoadingKey(key)
    try {
      const songs = await load()
      if (!songs.length) {
        toast.warning(i18n._(msg`暂无可播放歌曲`))
        return
      }
      void usePlayerStore.getState().initQueue(songs, 0, key)
    } catch {
      toast.error(i18n._(msg`歌单加载失败`))
    } finally {
      setLoadingKey(null)
    }
  }

  const loadOnlineSongs = async (playlist: Playlist) => {
    const first = await fetchPlaylistTracks(playlist.id)
    if (!playlist.trackCount || playlist.trackCount <= first.length) return first
    const rest = await fetchRemainingPlaylistTracks(playlist.id, playlist.trackCount)
    return [...first, ...rest.songs]
  }

  const unsubscribeOnline = async (playlist: Playlist) => {
    try {
      const res = await updatePlaylistSubscribe({ id: playlist.id, t: 2 })
      if (res.code !== 200) {
        toast.error(i18n._(msg`取消收藏失败`))
        return
      }
      toast.success(i18n._(msg`已取消收藏`))
      if (profile) {
        invalidateApiCache(['/user/playlist'])
        void useUserStore.getState().loadPlaylists(profile.userId)
      }
    } catch {
      toast.error(i18n._(msg`取消收藏失败`))
    }
  }

  const unsubscribeLocal = async (playlist: LocalSubscribedPlaylist) => {
    const next = await toggleLocalSubscribed(playlist)
    if (next === false) toast.success(i18n._(msg`已取消收藏`))
  }

  const unsubscribeLocalAlbum = async (album: LocalSubscribedAlbum) => {
    const next = await toggleLocalSubscribedAlbum(album)
    if (next === false) toast.success(i18n._(msg`已取消收藏`))
  }

  const unsubscribeOnlineAlbum = async (album: LocalSubscribedAlbum) => {
    try {
      if (await subscribeAlbum(album.id, false)) {
        await loadCollectedAlbums()
        toast.success(i18n._(msg`已取消收藏`))
      }
    } catch {
      toast.error(i18n._(msg`取消收藏失败`))
    }
  }

  const openAlbum = (albumId: number) =>
    void navigate({ to: '/albums/$id', params: { id: String(albumId) } })

  const saveRename = async () => {
    if (!renaming) return
    const current = localPlaylists.find((item) => item.id === renaming.id)
    const name = renaming.name.trim()
    setRenaming(null)
    if (!current || !name || name === current.name) return
    await renameLocalPlaylist(current.id, name)
  }

  const confirmDelete = async () => {
    if (!deleting) return
    const target = deleting
    if (await removeLocalPlaylist(target.id)) {
      setDeleting(null)
      if (pathname === `/local/playlists/${target.id}`) {
        void navigate({ to: '/local/favorites' })
      }
    }
  }

  const openMenu = (
    event: ReactMouseEvent<HTMLElement>,
    label: string,
    items: SidebarMenuItem[],
  ) => {
    event.preventDefault()
    const anchor =
      event.type === 'contextmenu'
        ? { x: event.clientX, y: event.clientY }
        : (() => {
            const rect = event.currentTarget.getBoundingClientRect()
            return { x: rect.left, y: rect.bottom + 4 }
          })()
    setMenu({ ...anchor, label, items })
  }

  const icon = (Icon: LucideIcon) => <Icon className="h-3.5 w-3.5 text-ink-3" />

  const playItem = (onSelect: () => void): SidebarMenuItem => ({
    key: 'play',
    label: <Trans>播放全部</Trans>,
    icon: icon(Play),
    onSelect,
    disabled: Boolean(loadingKey),
  })

  const localMenu = (playlist: LocalPlaylist): SidebarMenuItem[] => [
    playItem(() => void playSongs(`local-${playlist.id}`, () => playlist.songs)),
    {
      key: 'rename',
      label: <Trans>重命名</Trans>,
      icon: icon(Pencil),
      onSelect: () => setRenaming({ id: playlist.id, name: playlist.name }),
    },
    {
      key: 'delete',
      label: <Trans>删除歌单</Trans>,
      icon: <Trash2 className="h-3.5 w-3.5" />,
      danger: true,
      onSelect: () => setDeleting(playlist),
    },
  ]

  const createMenu = (group: string): SidebarMenuItem[] => [
    {
      key: 'new',
      label: <Trans>新建歌单</Trans>,
      icon: icon(Plus),
      onSelect: () => startCreating(group),
    },
    {
      key: 'import',
      label: <Trans>导入歌单</Trans>,
      icon: icon(Download),
      onSelect: openImportPlaylist,
    },
  ]

  // Icon rail: keep the primary destinations reachable after collapsing the
  // full sidebar. The top bar's expand button remains the way back.
  if (sidebarCollapsed) {
    return (
      <aside
        className="sidebar-glass sidebar-glass--rail select-none"
        aria-label={i18n._(msg`导航`)}
      >
        <div className="flex flex-1 flex-col items-center gap-1 py-4">
          {primaryNav.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.to}
                type="button"
                title={i18n._(item.label)}
                aria-label={i18n._(item.label)}
                aria-current={isActive(item.to) ? 'page' : undefined}
                onClick={() =>
                  item.to === '/search'
                    ? openSearch()
                    : void navigate({ to: item.to })
                }
                className={cn(
                  'pressable flex h-9 w-9 items-center justify-center rounded-[10px] transition-colors',
                  isActive(item.to)
                    ? 'bg-accent/12 text-accent'
                    : 'text-ink-3 hover:bg-black/6 hover:text-ink-2',
                )}
              >
                <Icon className="h-4 w-4" strokeWidth={1.75} />
              </button>
            )
          })}

          <div className="my-2 h-px w-7 bg-black/8" />

          <button
            type="button"
            title={i18n._(msg`我喜欢的音乐`)}
            aria-label={i18n._(msg`我喜欢的音乐`)}
            onClick={() => void navigate({ to: '/local/favorites' })}
            className={cn(
              'pressable flex h-9 w-9 items-center justify-center rounded-[10px] transition-colors',
              isActive('/local/favorites')
                ? 'bg-accent/12 text-accent'
                : 'text-ink-3 hover:bg-black/6 hover:text-ink-2',
            )}
          >
            <Heart className="h-4 w-4" strokeWidth={1.75} />
          </button>

          <button
            type="button"
            title={i18n._(msg`最近播放`)}
            aria-label={i18n._(msg`最近播放`)}
            onClick={() => void navigate({ to: '/recent' })}
            className={cn(
              'pressable flex h-9 w-9 items-center justify-center rounded-[10px] transition-colors',
              isActive('/recent')
                ? 'bg-accent/12 text-accent'
                : 'text-ink-3 hover:bg-black/6 hover:text-ink-2',
            )}
          >
            <History className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>
      </aside>
    )
  }

  const createForm = creatingPlaylist ? (
    <form onSubmit={(event) => void submitPlaylist(event)} className="px-1 pb-1.5">
      <input
        autoFocus
        value={playlistName}
        onChange={(event) => setPlaylistName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setCreatingPlaylist(false)
        }}
        maxLength={60}
        placeholder={i18n._(msg`歌单名称`)}
        className="h-7 w-full rounded-[6px] border border-black/10 bg-white/70 px-2 text-[11px] text-ink-1 outline-none placeholder:text-ink-4 focus:border-accent/50"
      />
      <div className="mt-1 flex justify-end gap-1">
        <button
          type="button"
          onClick={() => {
            setCreatingPlaylist(false)
            setPlaylistName('')
          }}
          className="rounded-full px-2 py-1 text-[11px] text-ink-4 hover:bg-black/5 dark:text-white/40 dark:hover:bg-white/10"
        >
          <Trans>取消</Trans>
        </button>
        <button
          type="submit"
          disabled={!playlistName.trim() || creating}
          className="rounded-full bg-accent px-2.5 py-1 text-[11px] text-white disabled:opacity-40"
        >
          <Trans>创建</Trans>
        </button>
      </div>
    </form>
  ) : null

  const addButton = (group: string) => (
    <button
      type="button"
      aria-label={i18n._(msg`新建或导入歌单`)}
      title={i18n._(msg`新建或导入歌单`)}
      aria-haspopup="menu"
      onClick={(event) => openMenu(event, i18n._(msg`新建或导入歌单`), createMenu(group))}
      className="pressable flex h-5 w-5 items-center justify-center rounded-full text-ink-4 hover:bg-black/5 hover:text-ink-2"
    >
      <Plus className="h-3.5 w-3.5" />
    </button>
  )

  return (
    <aside className="sidebar-glass select-none">
      <div className="flex-1 overflow-y-auto px-3 pb-4 pt-4">
        <p className="eyebrow px-2.5 pb-1.5">
          <Trans>浏览</Trans>
        </p>
        <nav className="flex flex-col gap-0.5">
          {primaryNav.map((item) => (
            <SidebarRow
              key={item.to}
              active={isActive(item.to)}
              icon={<RowIcon Icon={item.icon} active={isActive(item.to)} />}
              label={i18n._(item.label)}
              onClick={() =>
                item.to === '/search' ? openSearch() : void navigate({ to: item.to })
              }
            />
          ))}
        </nav>

        <div className="my-3 h-px bg-black/8" />

        <p className="eyebrow px-2.5 pb-1.5 pt-2">
          <Trans>我的音乐</Trans>
        </p>

        <div className="flex flex-col gap-0.5">
          {/* Same order and row style signed in or not. */}
          {isLogin ? (
            likedPlaylist ? (
              <SidebarRow
                active={playlistActive(likedPlaylist.id)}
                icon={<RowIcon Icon={Heart} className="text-love" />}
                label={<Trans>我喜欢的音乐</Trans>}
                count={likedPlaylist.trackCount}
                busy={loadingKey === String(likedPlaylist.id)}
                onClick={() => goPlaylist(likedPlaylist.id)}
                onContextMenu={(event) =>
                  openMenu(event, likedPlaylist.name, [
                    playItem(
                      () =>
                        void playSongs(String(likedPlaylist.id), () =>
                          loadOnlineSongs(likedPlaylist),
                        ),
                    ),
                  ])
                }
              />
            ) : null
          ) : (
            <SidebarRow
              active={isActive('/local/favorites')}
              icon={<RowIcon Icon={Heart} className="text-love" />}
              label={<Trans>我喜欢的音乐</Trans>}
              count={localFavorites.length}
              onClick={() => void navigate({ to: '/local/favorites' })}
              onContextMenu={(event) =>
                openMenu(event, i18n._(msg`我喜欢的音乐`), [
                  playItem(() => void playSongs('local-favorites', () => localFavorites)),
                ])
              }
            />
          )}
          <SidebarRow
            active={isActive('/recent')}
            icon={<RowIcon Icon={History} active={isActive('/recent')} />}
            label={<Trans>最近播放</Trans>}
            count={isLogin ? undefined : localRecent.length}
            onClick={() => void navigate({ to: '/recent' })}
          />

          {!isLogin ? (
            <>
              <GroupHeading
                label={<Trans>本地歌单</Trans>}
                open={groupOpen('local')}
                onToggle={() => toggleGroup('local')}
                action={addButton('local')}
              />
              {groupOpen('local') ? (
                <>
                  {createForm}
                  {localPlaylists.map((playlist) =>
                    renaming?.id === playlist.id ? (
                      <RenameField
                        key={playlist.id}
                        value={renaming.name}
                        onChange={(name) => setRenaming({ id: playlist.id, name })}
                        onSave={() => void saveRename()}
                        onCancel={() => setRenaming(null)}
                      />
                    ) : (
                      <SidebarRow
                        key={playlist.id}
                        active={pathname === `/local/playlists/${playlist.id}`}
                        icon={
                          <RowCover
                            src={playlist.songs[0]?.al?.picUrl}
                            alt={playlist.name}
                          />
                        }
                        label={playlist.name}
                        count={playlist.songs.length}
                        busy={loadingKey === `local-${playlist.id}`}
                        onClick={() =>
                          void navigate({
                            to: '/local/playlists/$id',
                            params: { id: playlist.id },
                          })
                        }
                        onContextMenu={(event) =>
                          openMenu(event, playlist.name, localMenu(playlist))
                        }
                      />
                    ),
                  )}
                  {!localPlaylists.length && !creatingPlaylist ? (
                    <p className="px-2.5 py-2 text-[11px] text-ink-4">
                      <Trans>暂无本地歌单</Trans>
                    </p>
                  ) : null}
                </>
              ) : null}

              {localSubscribedPlaylists.length ? (
                <>
                  <GroupHeading
                    label={<Trans>收藏的歌单</Trans>}
                    open={groupOpen('localSubscribed')}
                    onToggle={() => toggleGroup('localSubscribed')}
                  />
                  {groupOpen('localSubscribed')
                    ? localSubscribedPlaylists.map((playlist) => (
                        <SidebarRow
                          key={playlist.id}
                          active={playlistActive(playlist.id)}
                          icon={<RowCover src={playlist.coverImgUrl} alt={playlist.name} />}
                          label={playlist.name}
                          count={playlist.songs?.length ?? playlist.trackCount}
                          busy={loadingKey === String(playlist.id)}
                          onClick={() => goPlaylist(playlist.id)}
                          onContextMenu={(event) =>
                            openMenu(event, playlist.name, [
                              playItem(
                                () =>
                                  void playSongs(String(playlist.id), () =>
                                    playlist.songs?.length
                                      ? playlist.songs
                                      : loadOnlineSongs(playlist),
                                  ),
                              ),
                              {
                                key: 'unsubscribe',
                                label: <Trans>取消收藏</Trans>,
                                icon: icon(StarOff),
                                onSelect: () => void unsubscribeLocal(playlist),
                              },
                            ])
                          }
                        />
                      ))
                    : null}
                </>
              ) : null}

              {localSubscribedAlbums.length ? (
                <>
                  <GroupHeading
                    label={<Trans>收藏的专辑</Trans>}
                    open={groupOpen('localAlbums')}
                    onToggle={() => toggleGroup('localAlbums')}
                  />
                  {groupOpen('localAlbums')
                    ? localSubscribedAlbums.map((album) => (
                        <SidebarRow
                          key={album.id}
                          active={pathname === `/albums/${album.id}`}
                          icon={<RowCover src={album.picUrl} alt={album.name} />}
                          label={album.name}
                          count={album.size}
                          onClick={() => openAlbum(album.id)}
                          onContextMenu={(event) =>
                            openMenu(event, album.name, [
                              {
                                key: 'unsubscribe',
                                label: <Trans>取消收藏</Trans>,
                                icon: icon(StarOff),
                                onSelect: () => void unsubscribeLocalAlbum(album),
                              },
                            ])
                          }
                        />
                      ))
                    : null}
                </>
              ) : null}
            </>
          ) : (
            <>
              <GroupHeading
                label={<Trans>创建的歌单</Trans>}
                open={groupOpen('created')}
                onToggle={() => toggleGroup('created')}
                action={addButton('created')}
              />
              {groupOpen('created') ? (
                <>
                  {createForm}
                  {myPlaylists.map((playlist) => (
                    <SidebarRow
                      key={playlist.id}
                      active={playlistActive(playlist.id)}
                      icon={<RowCover src={playlist.coverImgUrl} alt={playlist.name} />}
                      label={playlist.name}
                      count={playlist.trackCount}
                      busy={loadingKey === String(playlist.id)}
                      onClick={() => goPlaylist(playlist.id)}
                      onContextMenu={(event) =>
                        openMenu(event, playlist.name, [
                          playItem(
                            () =>
                              void playSongs(String(playlist.id), () =>
                                loadOnlineSongs(playlist),
                              ),
                          ),
                          {
                            key: 'edit',
                            label: <Trans>编辑歌单</Trans>,
                            icon: icon(Pencil),
                            onSelect: () =>
                              void navigate({
                                to: '/songlists/$id/edit',
                                params: { id: String(playlist.id) },
                              }),
                          },
                        ])
                      }
                    />
                  ))}
                  {!myPlaylists.length && !creatingPlaylist && profile ? (
                    <p className="px-2.5 py-2 text-[11px] text-ink-4">
                      <Trans>暂无歌单</Trans>
                    </p>
                  ) : null}
                </>
              ) : null}

              {collectedPlaylists.length ? (
                <>
                  <GroupHeading
                    label={<Trans>收藏的歌单</Trans>}
                    open={groupOpen('collected')}
                    onToggle={() => toggleGroup('collected')}
                  />
                  {groupOpen('collected')
                    ? collectedPlaylists.map((playlist) => (
                        <SidebarRow
                          key={playlist.id}
                          active={playlistActive(playlist.id)}
                          icon={<RowCover src={playlist.coverImgUrl} alt={playlist.name} />}
                          label={playlist.name}
                          count={playlist.trackCount}
                          busy={loadingKey === String(playlist.id)}
                          onClick={() => goPlaylist(playlist.id)}
                          onContextMenu={(event) =>
                            openMenu(event, playlist.name, [
                              playItem(
                                () =>
                                  void playSongs(String(playlist.id), () =>
                                    loadOnlineSongs(playlist),
                                  ),
                              ),
                              {
                                key: 'unsubscribe',
                                label: <Trans>取消收藏</Trans>,
                                icon: icon(StarOff),
                                onSelect: () => void unsubscribeOnline(playlist),
                              },
                            ])
                          }
                        />
                      ))
                    : null}
                </>
              ) : null}

              {collectedAlbums.length ? (
                <>
                  <GroupHeading
                    label={<Trans>收藏的专辑</Trans>}
                    open={groupOpen('collectedAlbums')}
                    onToggle={() => toggleGroup('collectedAlbums')}
                  />
                  {groupOpen('collectedAlbums')
                    ? collectedAlbums.map((album) => (
                        <SidebarRow
                          key={album.id}
                          active={pathname === `/albums/${album.id}`}
                          icon={
                            <RowCover
                              src={album.picUrl ?? album.blurPicUrl}
                              alt={album.name}
                            />
                          }
                          label={album.name}
                          count={album.size}
                          onClick={() => openAlbum(album.id)}
                          onContextMenu={(event) =>
                            openMenu(event, album.name, [
                              {
                                key: 'unsubscribe',
                                label: <Trans>取消收藏</Trans>,
                                icon: icon(StarOff),
                                onSelect: () => void unsubscribeOnlineAlbum(album),
                              },
                            ])
                          }
                        />
                      ))
                    : null}
                </>
              ) : null}
            </>
          )}
        </div>
      </div>

      {/* Pinned under the scrolling list so it never drifts to the middle or
          the bottom of a long playlist list. */}
      {!isLogin ? (
        <div className="flex-none border-t border-[var(--app-border)] p-2">
          <button
            type="button"
            onClick={openLogin}
            className="group flex h-9 w-full items-center gap-2.5 rounded-[10px] px-2.5 text-left text-[12px] text-ink-2 transition-colors hover:bg-black/4 hover:text-ink-1 max-md:h-10"
          >
            <UserRound className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.75} />
            <span className="min-w-0 flex-1 truncate">
              <Trans>登录同步网易云歌单</Trans>
            </span>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
          </button>
        </div>
      ) : null}

      {menu ? (
        <SidebarMenu
          x={menu.x}
          y={menu.y}
          label={menu.label}
          items={menu.items}
          onClose={() => setMenu(null)}
        />
      ) : null}

      <Dialog open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent size="sm" glass>
          <DialogHeader>
            <DialogTitle>
              <Trans>删除歌单</Trans>
            </DialogTitle>
            <DialogDescription>
              <Trans>确定删除「{deleting?.name ?? ''}」吗？此操作无法撤销。</Trans>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button size="sm" variant="secondary" onClick={() => setDeleting(null)}>
              <Trans>取消</Trans>
            </Button>
            <Button size="sm" variant="destructive" onClick={() => void confirmDelete()}>
              <Trans>删除</Trans>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  )
}

/* ------------------------------ row parts ------------------------------ */

/**
 * One row style for every sidebar destination: 30px, 13px text, a 16px icon
 * slot (covers are 20px with negative margins so the text lines up), and the
 * song count only on hover / when selected.
 */
function SidebarRow({
  active,
  icon,
  label,
  count,
  busy,
  onClick,
  onContextMenu,
}: {
  active: boolean
  icon: ReactNode
  label: ReactNode
  count?: number
  busy?: boolean
  onClick: () => void
  onContextMenu?: (event: ReactMouseEvent<HTMLButtonElement>) => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={onContextMenu}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group flex h-[30px] items-center gap-2.5 rounded-[10px] px-2.5 text-left text-[13px] transition-colors max-md:h-10',
        active
          ? 'bg-black/8 font-medium text-ink-1'
          : 'text-ink-2 hover:bg-black/4 hover:text-ink-1',
      )}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" />
      ) : count ? (
        <span
          className={cn(
            'shrink-0 text-[11px] font-normal tabular-nums text-ink-4 transition-opacity',
            active
              ? 'opacity-100'
              : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100',
          )}
        >
          {count}
        </span>
      ) : null}
    </button>
  )
}

function RowIcon({
  Icon,
  active = false,
  className,
}: {
  Icon: LucideIcon
  active?: boolean
  className?: string
}) {
  return (
    <Icon
      className={cn('h-4 w-4 shrink-0', active ? 'text-accent' : 'text-ink-3', className)}
      strokeWidth={1.75}
    />
  )
}

function RowCover({ src, alt }: { src?: string; alt: string }) {
  if (!src) return <RowIcon Icon={ListMusic} />
  return (
    <ImageWithFallback
      src={src}
      alt={alt}
      rounded="rounded-[6px]"
      className="-mx-0.5 h-5 w-5 shrink-0"
      resize="64y64"
    />
  )
}

/** Foldable playlist group; the label stays aligned with the row icons. */
function GroupHeading({
  label,
  open,
  onToggle,
  action,
}: {
  label: ReactNode
  open: boolean
  onToggle: () => void
  action?: ReactNode
}) {
  return (
    <div className="flex items-center justify-between pb-1 pl-2.5 pr-1.5 pt-3">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="sidebar-subheading flex min-w-0 items-center gap-1 rounded-[6px] transition-colors hover:text-ink-2"
      >
        <span className="truncate">{label}</span>
        <ChevronDown
          className={cn(
            'h-3 w-3 shrink-0 transition-transform motion-reduce:transition-none',
            !open && '-rotate-90',
          )}
        />
      </button>
      {action}
    </div>
  )
}

function RenameField({
  value,
  onChange,
  onSave,
  onCancel,
}: {
  value: string
  onChange: (value: string) => void
  onSave: () => void
  onCancel: () => void
}) {
  const { i18n } = useLingui()
  // Escape unmounts the field; a blur fired on the way out must not save.
  const cancelled = useRef(false)
  return (
    <input
      autoFocus
      value={value}
      maxLength={60}
      aria-label={i18n._(msg`歌单名称`)}
      onChange={(event) => onChange(event.target.value)}
      onFocus={(event) => event.currentTarget.select()}
      onBlur={() => {
        if (!cancelled.current) onSave()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') {
          cancelled.current = true
          onCancel()
        }
      }}
      className="mx-1 h-[30px] rounded-[6px] border border-black/10 bg-white/70 px-2 text-[13px] text-ink-1 outline-none focus:border-accent/50 max-md:h-10"
    />
  )
}
