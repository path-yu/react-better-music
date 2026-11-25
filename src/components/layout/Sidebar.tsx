import {
  Fragment,
  forwardRef,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react'
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
  Home,
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
  ContextMenu,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
} from '@pikoloo/darwin-ui'
import { ImageWithFallback } from '../common/ImageWithFallback'
import { useUserStore } from '../../store/user'
import { useUiStore } from '../../store/ui'
import { usePlayerStore } from '../../store/player'
import { useSidebarCollapsed } from '../../lib/useSidebarLayout'
import { useLocalLibraryStore } from '../../store/localLibrary'
import { useSearchStore } from '../../store/search'
import {
  createPlaylist,
  fetchAlbumDetail,
  fetchPlaylistTracks,
  fetchRemainingPlaylistTracks,
  subscribeAlbum,
  subscribeArtist,
  subscribeUser,
  updatePlaylistSubscribe,
} from '../../api'
import type {
  LocalPlaylist,
  LocalSubscribedAlbum,
  LocalSubscribedArtist,
  LocalSubscribedPlaylist,
  LocalSubscribedUser,
} from '../../api/local'
import { invalidateApiCache } from '../../lib/http'
import { composePlaylistCover } from '../../lib/playlistCover'
import { cn } from '../../lib/format'
import { toast } from '../../lib/toast'
import type { ArtistSummary, Playlist, Song, UserProfile } from '../../types'

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
  const collectedArtists = useUserStore((state) => state.collectedArtists)
  const loadCollectedArtists = useUserStore(
    (state) => state.loadCollectedArtists,
  )
  const followedUsers = useUserStore((state) => state.followedUsers)
  const loadFollowedUsers = useUserStore((state) => state.loadFollowedUsers)
  // Refresh the album collection here as well: the startup fetch can run
  // before the session cookie is rotated, and the album page can change the
  // list while this sidebar stays mounted.
  useEffect(() => {
    if (!isLogin) return
    void loadCollectedAlbums()
  }, [isLogin, loadCollectedAlbums])
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
  const localSubscribedArtists = useLocalLibraryStore(
    (state) => state.subscribedArtists,
  )
  const toggleLocalArtist = useLocalLibraryStore(
    (state) => state.toggleSubscribedArtist,
  )
  const localSubscribedUsers = useLocalLibraryStore(
    (state) => state.subscribedUsers,
  )
  const toggleLocalUser = useLocalLibraryStore(
    (state) => state.toggleSubscribedUser,
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
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const [deleting, setDeleting] = useState<LocalPlaylist | null>(null)
  const [loadingKey, setLoadingKey] = useState<string | null>(null)
  // Albums picked with Ctrl/Cmd-click (account or local), then merged through
  // the right-click menu into one local playlist.
  const [selectedAlbumIds, setSelectedAlbumIds] = useState<number[]>([])
  const [mergeAlbums, setMergeAlbums] = useState<LocalSubscribedAlbum[] | null>(
    null,
  )
  const [mergeName, setMergeName] = useState('')
  const [merging, setMerging] = useState(false)

  // One list for both sources: account albums first, then local ones that the
  // account does not have. `local` rows keep their Ctrl/Cmd multi-select merge
  // behaviour and are tagged in the sidebar while signed in.
  const mergedAlbums = useMemo(() => {
    const onlineIds = new Set(
      collectedAlbums.map((album) => Number(album.id)),
    )
    const entries: Array<{ album: LocalSubscribedAlbum; local: boolean }> = [
      ...collectedAlbums.map((album) => ({ album, local: false })),
      ...localSubscribedAlbums
        .filter((album) => !onlineIds.has(Number(album.id)))
        .map((album) => ({ album, local: true })),
    ]
    return entries
  }, [collectedAlbums, localSubscribedAlbums])

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

  const openArtist = (artistId: number) =>
    void navigate({ to: '/artist/$id', params: { id: String(artistId) } })

  const unsubscribeLocalArtist = async (artist: LocalSubscribedArtist) => {
    const next = await toggleLocalArtist(artist)
    if (next === false) toast.success(i18n._(msg`已取消关注`))
  }

  const unsubscribeOnlineArtist = async (artist: ArtistSummary) => {
    try {
      if (await subscribeArtist(artist.id, false)) {
        await loadCollectedArtists()
        toast.success(i18n._(msg`已取消关注`))
      }
    } catch {
      toast.error(i18n._(msg`取消关注失败`))
    }
  }

  const openUser = (userId: number) =>
    void navigate({ to: '/users/$id', params: { id: String(userId) } })

  const unsubscribeLocalUser = async (user: LocalSubscribedUser) => {
    const next = await toggleLocalUser(user)
    if (next === false) toast.success(i18n._(msg`已取消关注`))
  }

  const unsubscribeOnlineUser = async (user: UserProfile) => {
    try {
      if (await subscribeUser(user.userId, false)) {
        await loadFollowedUsers()
        toast.success(i18n._(msg`已取消关注`))
      }
    } catch {
      toast.error(i18n._(msg`取消关注失败`))
    }
  }

  /** Ctrl/Cmd-click toggles a guest album into the merge selection. */
  const toggleAlbumSelection = (album: LocalSubscribedAlbum) => {
    setSelectedAlbumIds((current) =>
      current.includes(album.id)
        ? current.filter((id) => id !== album.id)
        : [...current, album.id],
    )
  }

  const openMergeDialog = (albums: LocalSubscribedAlbum[]) => {
    if (!albums.length) return
    setMergeAlbums(albums)
    // Default name is the album titles joined; the local library caps names at
    // 60 characters, so trim here instead of failing on save.
    setMergeName(
      albums
        .map((album) => album.name.trim())
        .filter(Boolean)
        .join(' / ')
        .slice(0, 60),
    )
  }

  const confirmMerge = async () => {
    if (!mergeAlbums?.length || merging) return
    const name = mergeName.trim()
    if (!name) return
    setMerging(true)
    try {
      const details = await Promise.allSettled(
        mergeAlbums.map((album) => fetchAlbumDetail(album.id)),
      )
      const seen = new Set<number>()
      const songs: Song[] = []
      for (const result of details) {
        if (result.status !== 'fulfilled' || !result.value) continue
        for (const song of result.value.songs) {
          if (seen.has(song.id)) continue
          seen.add(song.id)
          songs.push(song)
        }
      }
      if (!songs.length) {
        toast.error(i18n._(msg`这些专辑里没有可合并的歌曲`))
        return
      }
      // Stitch the album covers into one square; the first cover is the
      // fallback when the canvas cannot export (no CORS from the CDN).
      const coverSources = mergeAlbums.flatMap((album) => [
        album.picUrl,
        album.blurPicUrl,
      ])
      const composed = await composePlaylistCover(coverSources)
      const cover = (composed ?? coverSources.find(Boolean)) || undefined
      const playlist = await createLocalPlaylist(name, songs, cover)
      if (!playlist) return
      setMergeAlbums(null)
      setSelectedAlbumIds([])
      toast.success(i18n._(msg`已创建歌单「${name}」`))
      void navigate({
        to: '/local/playlists/$id',
        params: { id: playlist.id },
      })
    } finally {
      setMerging(false)
    }
  }

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

  const icon = (Icon: LucideIcon) => <Icon className="h-3.5 w-3.5 text-ink-3" />

  const playItem = (onSelect: () => void): SidebarMenuAction => ({
    key: 'play',
    label: <Trans>播放全部</Trans>,
    icon: icon(Play),
    onSelect,
    disabled: Boolean(loadingKey),
  })

  const localMenu = (playlist: LocalPlaylist): SidebarMenuAction[] => [
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
      destructive: true,
      onSelect: () => setDeleting(playlist),
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
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={i18n._(msg`新建或导入歌单`)}
          title={i18n._(msg`新建或导入歌单`)}
          aria-haspopup="menu"
          className="pressable flex h-5 w-5 items-center justify-center rounded-full text-ink-4 hover:bg-black/5 hover:text-ink-2"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent glass align="start" side="bottom" sideOffset={6}>
        <DropdownMenuItem onSelect={() => startCreating(group)}>
          <span className="flex items-center gap-2">
            {icon(Plus)}
            <Trans>新建歌单</Trans>
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={openImportPlaylist}>
          <span className="flex items-center gap-2">
            {icon(Download)}
            <Trans>导入歌单</Trans>
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
          {/* Landing page for everything below: the groups further down get
              long, so this stays at the top with a compact overview. */}
          <SidebarRow
            active={isActive('/library')}
            icon={<RowIcon Icon={Home} active={isActive('/library')} />}
            label={<Trans>主页</Trans>}
            onClick={() => void navigate({ to: '/library' })}
          />
          {/* Same order and row style signed in or not. */}
          {isLogin ? (
            likedPlaylist ? (
              <RowContextMenu
                items={[
                  playItem(
                    () =>
                      void playSongs(String(likedPlaylist.id), () =>
                        loadOnlineSongs(likedPlaylist),
                      ),
                  ),
                ]}
              >
                <SidebarRow
                  active={playlistActive(likedPlaylist.id)}
                  icon={<RowIcon Icon={Heart} className="text-love" />}
                  label={<Trans>我喜欢的音乐</Trans>}
                  count={likedPlaylist.trackCount}
                  busy={loadingKey === String(likedPlaylist.id)}
                  onClick={() => goPlaylist(likedPlaylist.id)}
                />
              </RowContextMenu>
            ) : null
          ) : (
            <RowContextMenu
              items={[
                playItem(() =>
                  void playSongs('local-favorites', () => localFavorites),
                ),
              ]}
            >
              <SidebarRow
                active={isActive('/local/favorites')}
                icon={<RowIcon Icon={Heart} className="text-love" />}
                label={<Trans>我喜欢的音乐</Trans>}
                count={localFavorites.length}
                onClick={() => void navigate({ to: '/local/favorites' })}
              />
            </RowContextMenu>
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
                      <RowContextMenu
                        key={playlist.id}
                        items={localMenu(playlist)}
                      >
                        <SidebarRow
                          active={pathname === `/local/playlists/${playlist.id}`}
                          icon={
                            <RowCover
                              src={
                                playlist.coverUrl ??
                                playlist.songs[0]?.al?.picUrl
                              }
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
                        />
                      </RowContextMenu>
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
                        <RowContextMenu
                          key={playlist.id}
                          items={[
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
                              destructive: true,
                              onSelect: () => void unsubscribeLocal(playlist),
                            },
                          ]}
                        >
                          <SidebarRow
                            active={playlistActive(playlist.id)}
                            icon={<RowCover src={playlist.coverImgUrl} alt={playlist.name} />}
                            label={playlist.name}
                            count={playlist.songs?.length ?? playlist.trackCount}
                            busy={loadingKey === String(playlist.id)}
                            onClick={() => goPlaylist(playlist.id)}
                          />
                        </RowContextMenu>
                      ))
                    : null}
                </>
              ) : null}

              {localSubscribedArtists.length ? (
                <>
                  <GroupHeading
                    label={<Trans>关注的歌手</Trans>}
                    open={groupOpen('localArtists')}
                    onToggle={() => toggleGroup('localArtists')}
                  />
                  {groupOpen('localArtists')
                    ? localSubscribedArtists.map((artist) => (
                        <RowContextMenu
                          key={artist.id}
                          items={[
                            {
                              key: 'unfollow',
                              label: <Trans>取消关注</Trans>,
                              icon: icon(StarOff),
                              destructive: true,
                              onSelect: () =>
                                void unsubscribeLocalArtist(artist),
                            },
                          ]}
                        >
                          <SidebarRow
                            active={pathname === `/artist/${artist.id}`}
                            icon={
                              artist.picUrl ? (
                                <RowCover
                                  src={artist.picUrl}
                                  alt={artist.name}
                                />
                              ) : (
                                <RowIcon Icon={UserRound} />
                              )
                            }
                            label={artist.name}
                            count={artist.albumSize}
                            onClick={() => openArtist(artist.id)}
                          />
                        </RowContextMenu>
                      ))
                    : null}
                </>
              ) : null}

              {localSubscribedUsers.length ? (
                <>
                  <GroupHeading
                    label={<Trans>关注的用户</Trans>}
                    open={groupOpen('localUsers')}
                    onToggle={() => toggleGroup('localUsers')}
                  />
                  {groupOpen('localUsers')
                    ? localSubscribedUsers.map((user) => (
                        <RowContextMenu
                          key={user.userId}
                          items={[
                            {
                              key: 'unfollow',
                              label: <Trans>取消关注</Trans>,
                              icon: icon(StarOff),
                              destructive: true,
                              onSelect: () => void unsubscribeLocalUser(user),
                            },
                          ]}
                        >
                          <SidebarRow
                            active={pathname === `/users/${user.userId}`}
                            icon={
                              user.avatarUrl ? (
                                <RowCover
                                  src={user.avatarUrl}
                                  alt={user.nickname}
                                />
                              ) : (
                                <RowIcon Icon={UserRound} />
                              )
                            }
                            label={user.nickname}
                            onClick={() => openUser(user.userId)}
                          />
                        </RowContextMenu>
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
                    <RowContextMenu
                      key={playlist.id}
                      items={[
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
                      ]}
                    >
                      <SidebarRow
                        active={playlistActive(playlist.id)}
                        icon={<RowCover src={playlist.coverImgUrl} alt={playlist.name} />}
                        label={playlist.name}
                        count={playlist.trackCount}
                        busy={loadingKey === String(playlist.id)}
                        onClick={() => goPlaylist(playlist.id)}
                      />
                    </RowContextMenu>
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
                        <RowContextMenu
                          key={playlist.id}
                          items={[
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
                              destructive: true,
                              onSelect: () => void unsubscribeOnline(playlist),
                            },
                          ]}
                        >
                          <SidebarRow
                            active={playlistActive(playlist.id)}
                            icon={<RowCover src={playlist.coverImgUrl} alt={playlist.name} />}
                            label={playlist.name}
                            count={playlist.trackCount}
                            busy={loadingKey === String(playlist.id)}
                            onClick={() => goPlaylist(playlist.id)}
                          />
                        </RowContextMenu>
                      ))
                    : null}
                </>
              ) : null}

              {mergedAlbums.length ? (
                <>
                  <GroupHeading
                    label={<Trans>收藏的专辑</Trans>}
                    open={groupOpen('collectedAlbums')}
                    onToggle={() => toggleGroup('collectedAlbums')}
                  />
                  {groupOpen('collectedAlbums')
                    ? mergedAlbums.map(({ album, local }) => {
                        // Ctrl/Cmd selection works for both sources: merging
                        // only needs album ids, the songs are fetched per album.
                        const selected = selectedAlbumIds.includes(album.id)
                        const mergeTargets = selected
                          ? mergedAlbums
                              .filter((entry) =>
                                selectedAlbumIds.includes(entry.album.id),
                              )
                              .map((entry) => entry.album)
                          : [album]
                        const mergeItem: SidebarMenuAction = {
                          key: 'merge',
                          label:
                            mergeTargets.length > 1
                              ? i18n._(
                                  msg`合并 ${mergeTargets.length} 张专辑为新歌单`,
                                )
                              : i18n._(msg`用这张专辑新建歌单`),
                          onSelect: () => openMergeDialog(mergeTargets),
                        }
                        const unsubscribeItem: SidebarMenuAction = local
                          ? {
                              key: 'unsubscribe',
                              label: <Trans>取消收藏</Trans>,
                              icon: icon(StarOff),
                              destructive: true,
                              separatorBefore: true,
                              onSelect: () => void unsubscribeLocalAlbum(album),
                            }
                          : {
                              key: 'unsubscribe',
                              label: <Trans>取消收藏</Trans>,
                              icon: icon(StarOff),
                              destructive: true,
                              separatorBefore: true,
                              onSelect: () => void unsubscribeOnlineAlbum(album),
                            }
                        return (
                          <RowContextMenu
                            key={`${local ? 'local' : 'account'}-${album.id}`}
                            items={[mergeItem, unsubscribeItem]}
                          >
                            <SidebarRow
                              active={pathname === `/albums/${album.id}`}
                              selected={selected}
                              icon={
                                <RowCover
                                  src={album.picUrl ?? album.blurPicUrl}
                                  alt={album.name}
                                />
                              }
                              label={
                                local && isLogin ? (
                                  <span className="flex min-w-0 items-center gap-1.5">
                                    <span className="min-w-0 truncate">
                                      {album.name}
                                    </span>
                                    <span className="shrink-0 rounded-full bg-black/6 px-1.5 py-0.5 text-[11px] font-normal text-ink-4 dark:bg-white/10 dark:text-white/50">
                                      <Trans>本地</Trans>
                                    </span>
                                  </span>
                                ) : (
                                  album.name
                                )
                              }
                              count={album.size}
                              onClick={(event) => {
                                if (event.ctrlKey || event.metaKey) {
                                  toggleAlbumSelection(album)
                                  return
                                }
                                setSelectedAlbumIds([])
                                openAlbum(album.id)
                              }}
                            />
                          </RowContextMenu>
                        )
                      })
                    : null}
                </>
              ) : null}

              {collectedArtists.length ? (
                <>
                  <GroupHeading
                    label={<Trans>关注的歌手</Trans>}
                    open={groupOpen('collectedArtists')}
                    onToggle={() => toggleGroup('collectedArtists')}
                  />
                  {groupOpen('collectedArtists')
                    ? collectedArtists.map((artist) => (
                        <RowContextMenu
                          key={artist.id}
                          items={[
                            {
                              key: 'unfollow',
                              label: <Trans>取消关注</Trans>,
                              icon: icon(StarOff),
                              destructive: true,
                              onSelect: () =>
                                void unsubscribeOnlineArtist(artist),
                            },
                          ]}
                        >
                          <SidebarRow
                            active={pathname === `/artist/${artist.id}`}
                            icon={
                              artist.picUrl ? (
                                <RowCover
                                  src={artist.picUrl}
                                  alt={artist.name}
                                />
                              ) : (
                                <RowIcon Icon={UserRound} />
                              )
                            }
                            label={artist.name}
                            count={artist.albumSize}
                            onClick={() => openArtist(artist.id)}
                          />
                        </RowContextMenu>
                      ))
                    : null}
                </>
              ) : null}

              {followedUsers.length ? (
                <>
                  <GroupHeading
                    label={<Trans>关注的用户</Trans>}
                    open={groupOpen('followedUsers')}
                    onToggle={() => toggleGroup('followedUsers')}
                  />
                  {groupOpen('followedUsers')
                    ? followedUsers.map((user) => (
                        <RowContextMenu
                          key={user.userId}
                          items={[
                            {
                              key: 'unfollow',
                              label: <Trans>取消关注</Trans>,
                              icon: icon(StarOff),
                              destructive: true,
                              onSelect: () => void unsubscribeOnlineUser(user),
                            },
                          ]}
                        >
                          <SidebarRow
                            active={pathname === `/users/${user.userId}`}
                            icon={
                              user.avatarUrl ? (
                                <RowCover
                                  src={user.avatarUrl}
                                  alt={user.nickname}
                                />
                              ) : (
                                <RowIcon Icon={UserRound} />
                              )
                            }
                            label={user.nickname}
                            onClick={() => openUser(user.userId)}
                          />
                        </RowContextMenu>
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

      <Dialog
        open={Boolean(mergeAlbums)}
        onOpenChange={(open) => {
          if (!open && !merging) setMergeAlbums(null)
        }}
      >
        <DialogContent size="sm" glass>
          <DialogHeader>
            <DialogTitle>
              <Trans>合并为新歌单</Trans>
            </DialogTitle>
            <DialogDescription>
              <Trans>
                将 {mergeAlbums?.length ?? 0} 张专辑的歌曲合并到一个新的本地歌单。
              </Trans>
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Input
              value={mergeName}
              onChange={(event) => setMergeName(event.target.value)}
              placeholder={i18n._(msg`歌单名称`)}
              aria-label={i18n._(msg`歌单名称`)}
              size="sm"
              autoFocus
            />
          </DialogBody>
          <DialogFooter>
            <Button
              size="sm"
              variant="secondary"
              disabled={merging}
              onClick={() => setMergeAlbums(null)}
            >
              <Trans>取消</Trans>
            </Button>
            <Button
              size="sm"
              disabled={!mergeName.trim() || merging}
              onClick={() => void confirmMerge()}
            >
              {merging ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : null}
              <Trans>创建</Trans>
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
type SidebarMenuAction = {
  key: string
  label: ReactNode
  icon?: ReactNode
  disabled?: boolean
  destructive?: boolean
  separatorBefore?: boolean
  onSelect: () => void
}

/**
 * One right-click menu for every sidebar row, built from darwin's ContextMenu
 * so playlists, albums and the rail share the same surface, radius and
 * keyboard behaviour.
 */
function RowContextMenu({
  items,
  children,
}: {
  items: SidebarMenuAction[]
  children: ReactNode
}) {
  return (
    <ContextMenu>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Content glass>
        {items.map((item) => (
          <Fragment key={item.key}>
            {item.separatorBefore ? <ContextMenu.Separator /> : null}
            <ContextMenu.Item
              disabled={item.disabled}
              destructive={item.destructive}
              onSelect={item.onSelect}
            >
              <span className="flex items-center gap-2">
                {item.icon}
                {item.label}
              </span>
            </ContextMenu.Item>
          </Fragment>
        ))}
      </ContextMenu.Content>
    </ContextMenu>
  )
}

const SidebarRow = forwardRef<
  HTMLButtonElement,
  {
    active: boolean
    selected?: boolean
    icon: ReactNode
    label: ReactNode
    count?: number
    busy?: boolean
    onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void
    onContextMenu?: (event: ReactMouseEvent<HTMLButtonElement>) => void
  }
>(function SidebarRow(
  { active, selected = false, icon, label, count, busy, onClick, onContextMenu },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      onContextMenu={onContextMenu}
      aria-current={active ? 'page' : undefined}
      aria-pressed={selected || undefined}
      className={cn(
        'group flex h-[30px] items-center gap-2.5 rounded-[10px] px-2.5 text-left text-[13px] transition-colors max-md:h-10',
        selected
          ? 'bg-accent/12 font-medium text-accent'
          : active
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
            active || selected
              ? 'opacity-100'
              : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100',
          )}
        >
          {count}
        </span>
      ) : null}
    </button>
  )
})

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
