import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { Trans } from '@lingui/react/macro'
import { LayoutGrid, List, Music2 } from 'lucide-react'
import {
  Button,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@pikoloo/darwin-ui'
import { PageHeader } from '../components/common/PageHeader'
import { EmptyState } from '../components/common/EmptyState'
import { ImageWithFallback } from '../components/common/ImageWithFallback'
import { ViewToggle } from '../components/common/ViewToggle'
import { ReorderableList } from '../components/common/ReorderableList'
import { PlaylistCard } from '../components/cards/PlaylistCard'
import { AlbumCard } from '../components/cards/AlbumCard'
import { useUserStore } from '../store/user'
import { useLocalLibraryStore } from '../store/localLibrary'
import { useDocumentTitle } from '../lib/title'
import type { Album, ArtistSummary, Playlist } from '../types'
import type { LocalPlaylist } from '../api/local'

/** Tab ids double as the `?tab=` value so returning restores the same tab. */
const LIBRARY_TABS = ['created', 'saved', 'albums', 'follows'] as const
type LibraryTab = (typeof LIBRARY_TABS)[number]

/**
 * The sidebar link to `/library` cannot carry a search param, so the last tab
 * is kept for the session. Without it the page always reopened on "创建" and
 * every visit looked like a fresh mount.
 */
const LIBRARY_TAB_KEY = 'library:tab'
/** Grid / list preference, shared by every tab. */
const LIBRARY_VIEW_KEY = 'library:view'
type LibraryView = 'grid' | 'list'

function readStoredTab(): LibraryTab {
  try {
    const raw = sessionStorage.getItem(LIBRARY_TAB_KEY)
    if (raw && (LIBRARY_TABS as readonly string[]).includes(raw)) {
      return raw as LibraryTab
    }
  } catch {
    // storage may be unavailable
  }
  return 'created'
}

function readStoredView(): LibraryView {
  try {
    return localStorage.getItem(LIBRARY_VIEW_KEY) === 'list' ? 'list' : 'grid'
  } catch {
    return 'grid'
  }
}

export const Route = createFileRoute('/library')({
  validateSearch: (search: Record<string, unknown>): { tab?: LibraryTab } => {
    const tab = search.tab
    return {
      tab: LIBRARY_TABS.includes(tab as LibraryTab)
        ? (tab as LibraryTab)
        : undefined,
    }
  },
  component: LibraryPage,
})

type MyPlaylistEntry =
  | { kind: 'online'; playlist: Playlist }
  | { kind: 'local'; playlist: LocalPlaylist }
type AlbumEntry = { album: Album; local: boolean }

interface UserTile {
  userId: number
  nickname: string
  avatarUrl: string
  signature?: string
}

/** Count shown next to a tab label; hidden when the tab is empty. */
function TabCount({ value }: { value: number }) {
  if (!value) return null
  return (
    <span className="ml-1.5 text-[11px] font-normal tabular-nums opacity-60">
      {value}
    </span>
  )
}

function PlaylistGrid({ entries }: { entries: MyPlaylistEntry[] }) {
  return (
    <div className="grid grid-cols-2 gap-x-5 gap-y-7 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {entries.map((entry) =>
        entry.kind === 'local' ? (
          <LocalPlaylistCard
            key={`local-${entry.playlist.id}`}
            playlist={entry.playlist}
          />
        ) : (
          <PlaylistCard
            key={`online-${entry.playlist.id}`}
            playlist={entry.playlist}
          />
        ),
      )}
    </div>
  )
}

/** Local playlists have no artwork of their own: use the stored/composed one. */
function LocalPlaylistCard({ playlist }: { playlist: LocalPlaylist }) {
  const navigate = useNavigate()
  const cover = playlist.coverUrl ?? playlist.songs[0]?.al?.picUrl
  return (
    <button
      type="button"
      onClick={() =>
        void navigate({
          to: '/local/playlists/$id',
          params: { id: playlist.id },
        })
      }
      className="apple-card group p-2.5 text-left"
    >
      <div className="relative aspect-square w-full overflow-hidden rounded-[10px] bg-[var(--app-chip)]">
        {cover ? (
          <ImageWithFallback
            src={cover}
            alt={playlist.name}
            rounded="rounded-[10px]"
            className="h-full w-full"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Music2 className="h-8 w-8 text-ink-4" strokeWidth={1.6} />
          </div>
        )}
        <span className="absolute right-1.5 top-1.5 rounded-full bg-black/45 px-1.5 py-0.5 text-[11px] leading-none text-white backdrop-blur-sm">
          <Trans>本地</Trans>
        </span>
      </div>
      <span className="mt-2 line-clamp-2 block min-h-[34px] text-[12px] leading-[1.4] text-ink-2 transition-colors group-hover:text-accent">
        {playlist.name}
      </span>
      <span className="mt-0.5 block truncate text-[11px] text-ink-4">
        <Trans>{playlist.songs.length} 首</Trans>
      </span>
    </button>
  )
}

function ArtistTile({ artist }: { artist: ArtistSummary }) {
  const navigate = useNavigate()
  return (
    <button
      type="button"
      onClick={() =>
        void navigate({ to: '/artist/$id', params: { id: String(artist.id) } })
      }
      className="group flex min-w-0 flex-col items-center gap-2 text-center"
    >
      <ImageWithFallback
        src={artist.picUrl}
        alt={artist.name}
        rounded="rounded-full"
        resize="200y200"
        className="h-[92px] w-[92px]"
      />
      <span className="line-clamp-2 text-[12px] leading-[1.35] text-ink-2 transition-colors group-hover:text-accent">
        {artist.name}
      </span>
    </button>
  )
}

function UserCard({ user }: { user: UserTile }) {
  const navigate = useNavigate()
  return (
    <button
      type="button"
      onClick={() =>
        void navigate({ to: '/users/$id', params: { id: String(user.userId) } })
      }
      className="apple-card group flex min-w-0 items-center gap-3 p-3 text-left"
    >
      <ImageWithFallback
        src={user.avatarUrl}
        alt={user.nickname}
        rounded="rounded-full"
        resize="100y100"
        className="h-10 w-10 shrink-0"
      />
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-medium text-ink-1 transition-colors group-hover:text-accent">
          {user.nickname}
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-ink-4">
          {user.signature || ''}
        </span>
      </span>
    </button>
  )
}

/** Shared row layout for the list mode. */
function MediaRow({
  cover,
  rounded = 'rounded-[10px]',
  title,
  subtitle,
  badge,
  trailing,
  onClick,
}: {
  cover: ReactNode
  rounded?: string
  title: string
  subtitle?: string
  badge?: ReactNode
  trailing?: ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full min-w-0 items-center gap-3 rounded-[10px] px-2 py-1.5 text-left transition-colors hover:bg-black/4 dark:hover:bg-white/6"
    >
      <span
        className={`h-11 w-11 shrink-0 overflow-hidden ${rounded}`}
      >
        {cover}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-ink-1">
          {title}
        </span>
        {subtitle ? (
          <span className="mt-0.5 block truncate text-[11px] text-ink-4">
            {subtitle}
          </span>
        ) : null}
      </span>
      {badge}
      {trailing ? (
        <span className="shrink-0 text-[11px] tabular-nums text-ink-4">
          {trailing}
        </span>
      ) : null}
    </button>
  )
}

function PlaylistListRow({ entry }: { entry: MyPlaylistEntry }) {
  const navigate = useNavigate()
  const { i18n } = useLingui()
  if (entry.kind === 'local') {
    const playlist = entry.playlist
    return (
      <MediaRow
        cover={
          playlist.coverUrl ?? playlist.songs[0]?.al?.picUrl ? (
            <ImageWithFallback
              src={playlist.coverUrl ?? playlist.songs[0]?.al?.picUrl}
              alt={playlist.name}
              rounded="rounded-[10px]"
              className="h-full w-full"
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center bg-[var(--app-chip)]">
              <Music2 className="h-5 w-5 text-ink-4" strokeWidth={1.6} />
            </span>
          )
        }
        title={playlist.name}
        subtitle={i18n._(msg`本地歌单`)}
        badge={
          <span className="shrink-0 rounded-full bg-black/6 px-1.5 py-0.5 text-[11px] text-ink-4 dark:bg-white/10 dark:text-white/50">
            <Trans>本地</Trans>
          </span>
        }
        trailing={i18n._(msg`${playlist.songs.length} 首`)}
        onClick={() =>
          void navigate({
            to: '/local/playlists/$id',
            params: { id: playlist.id },
          })
        }
      />
    )
  }
  const playlist = entry.playlist
  return (
    <MediaRow
      cover={
        <ImageWithFallback
          src={playlist.coverImgUrl}
          alt={playlist.name}
          rounded="rounded-[10px]"
          className="h-full w-full"
        />
      }
      title={playlist.name}
      subtitle={playlist.creator?.nickname}
      trailing={i18n._(msg`${playlist.trackCount} 首`)}
      onClick={() =>
        void navigate({
          to: '/songlists/$id',
          params: { id: String(playlist.id) },
        })
      }
    />
  )
}

function AlbumListRow({
  entry,
  showBadge,
}: {
  entry: AlbumEntry
  showBadge: boolean
}) {
  const navigate = useNavigate()
  const { i18n } = useLingui()
  return (
    <MediaRow
      cover={
        <ImageWithFallback
          src={entry.album.picUrl ?? entry.album.blurPicUrl}
          alt={entry.album.name}
          rounded="rounded-[10px]"
          resize="100y100"
          className="h-full w-full"
        />
      }
      title={entry.album.name}
      subtitle={entry.album.artist?.name}
      badge={
        showBadge && entry.local ? (
          <span className="shrink-0 rounded-full bg-black/6 px-1.5 py-0.5 text-[11px] text-ink-4 dark:bg-white/10 dark:text-white/50">
            <Trans>本地</Trans>
          </span>
        ) : null
      }
      trailing={
        entry.album.size ? i18n._(msg`${entry.album.size} 首`) : undefined
      }
      onClick={() =>
        void navigate({
          to: '/albums/$id',
          params: { id: String(entry.album.id) },
        })
      }
    />
  )
}

/**
 * One place for everything under "我的音乐": the sidebar groups get long, so
 * this page collects playlists, saved playlists, albums and follows behind the
 * same tab pattern the artist page uses.
 */
function LibraryPage() {
  const { i18n } = useLingui()
  const navigate = useNavigate()
  const { tab: tabParam } = Route.useSearch()
  const tab = tabParam ?? readStoredTab()
  const [view, setView] = useState<LibraryView>(readStoredView)

  // Persist whichever tab is showing, so leaving the page and coming back
  // through the sidebar lands on the same category.
  useEffect(() => {
    try {
      sessionStorage.setItem(LIBRARY_TAB_KEY, tab)
    } catch {
      // storage may be unavailable
    }
  }, [tab])

  const isLogin = useUserStore((state) => state.isLogin)
  const createdPlaylists = useUserStore((state) => state.createdPlaylists)
  const collectedPlaylists = useUserStore((state) => state.collectedPlaylists)
  const collectedAlbums = useUserStore((state) => state.collectedAlbums)
  const collectedArtists = useUserStore((state) => state.collectedArtists)
  const followedUsers = useUserStore((state) => state.followedUsers)

  const localPlaylists = useLocalLibraryStore((state) => state.playlists)
  const localSubscribedPlaylists = useLocalLibraryStore(
    (state) => state.subscribedPlaylists,
  )
  const localSubscribedAlbums = useLocalLibraryStore(
    (state) => state.subscribedAlbums,
  )
  const localSubscribedArtists = useLocalLibraryStore(
    (state) => state.subscribedArtists,
  )
  const localSubscribedUsers = useLocalLibraryStore(
    (state) => state.subscribedUsers,
  )

  useDocumentTitle(i18n._(msg`主页`))

  // Opening this page directly must not depend on AppShell having loaded the
  // local library first; `load()` is a no-op once it is cached.
  const loadLocalLibrary = useLocalLibraryStore((state) => state.load)
  useEffect(() => {
    void loadLocalLibrary()
  }, [loadLocalLibrary])

  const changeView = (next: LibraryView) => {
    setView(next)
    try {
      localStorage.setItem(LIBRARY_VIEW_KEY, next)
    } catch {
      // storage may be unavailable
    }
  }

  // Account data wins when the same item exists in both places.
  const myPlaylists = useMemo<MyPlaylistEntry[]>(
    () => [
      ...createdPlaylists.map((playlist) => ({
        kind: 'online' as const,
        playlist,
      })),
      ...localPlaylists.map((playlist) => ({
        kind: 'local' as const,
        playlist,
      })),
    ],
    [createdPlaylists, localPlaylists],
  )

  const savedPlaylists = useMemo<Playlist[]>(() => {
    const onlineIds = new Set(collectedPlaylists.map((item) => Number(item.id)))
    return [
      ...collectedPlaylists,
      ...localSubscribedPlaylists.filter(
        (playlist) => !onlineIds.has(Number(playlist.id)),
      ),
    ]
  }, [collectedPlaylists, localSubscribedPlaylists])

  const albums = useMemo<AlbumEntry[]>(() => {
    const onlineIds = new Set(collectedAlbums.map((item) => Number(item.id)))
    return [
      ...collectedAlbums.map((album) => ({ album, local: false })),
      ...localSubscribedAlbums
        .filter((album) => !onlineIds.has(Number(album.id)))
        .map((album) => ({ album, local: true })),
    ]
  }, [collectedAlbums, localSubscribedAlbums])

  const artists = useMemo(() => {
    const onlineIds = new Set(collectedArtists.map((item) => Number(item.id)))
    return [
      ...collectedArtists,
      ...localSubscribedArtists.filter(
        (artist) => !onlineIds.has(Number(artist.id)),
      ),
    ]
  }, [collectedArtists, localSubscribedArtists])

  const users = useMemo<UserTile[]>(() => {
    const onlineIds = new Set(followedUsers.map((item) => Number(item.userId)))
    return [
      ...followedUsers.map((user) => ({
        userId: user.userId,
        nickname: user.nickname,
        avatarUrl: user.avatarUrl,
        signature: user.signature,
      })),
      ...localSubscribedUsers.filter(
        (user) => !onlineIds.has(Number(user.userId)),
      ),
    ]
  }, [followedUsers, localSubscribedUsers])

  const total =
    myPlaylists.length +
    savedPlaylists.length +
    albums.length +
    artists.length +
    users.length

  const changeTab = (value: string) => {
    void navigate({
      to: '/library',
      search: { tab: value as LibraryTab },
      replace: true,
    })
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow={<Trans>我的音乐</Trans>}
        title={<Trans>主页</Trans>}
        description={
          isLogin
            ? i18n._(msg`歌单、专辑、歌手与关注，一处查看`)
            : i18n._(msg`未登录时展示本机收藏，登录后自动合并账号数据`)
        }
      />

      {total === 0 ? (
        <EmptyState
          title={i18n._(msg`这里还什么都没有`)}
          description={i18n._(msg`去发现音乐收藏一些歌单或专辑吧`)}
          action={
            <Button
              variant="primary"
              size="sm"
              className="pressable rounded-full px-4 text-[12px]"
              onClick={() => void navigate({ to: '/' })}
            >
              <Trans>去发现音乐</Trans>
            </Button>
          }
        />
      ) : (
        <Tabs value={tab} onValueChange={changeTab} className="mt-6">
          {/* Sticky across the whole page: the grids get long, and switching
              tabs should not require scrolling back up. */}
          <div className="page-bleed sticky-bar sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 py-3">
            <TabsList>
              <TabsTrigger value="created">
                <Trans>创建</Trans>
                <TabCount value={myPlaylists.length} />
              </TabsTrigger>
              <TabsTrigger value="saved">
                <Trans>收藏</Trans>
                <TabCount value={savedPlaylists.length} />
              </TabsTrigger>
              <TabsTrigger value="albums">
                <Trans>专辑</Trans>
                <TabCount value={albums.length} />
              </TabsTrigger>
              <TabsTrigger value="follows">
                <Trans>关注</Trans>
                <TabCount value={artists.length + users.length} />
              </TabsTrigger>
            </TabsList>
            {/* Follows is a fixed card grid: no list mode, no drag order. */}
            {tab === 'follows' ? null : (
              <ViewToggle
                label={i18n._(msg`显示方式`)}
                value={view}
                onChange={changeView}
                options={[
                  {
                    value: 'list',
                    label: i18n._(msg`列表视图`),
                    icon: <List className="h-3.5 w-3.5" />,
                  },
                  {
                    value: 'grid',
                    label: i18n._(msg`网格视图`),
                    icon: <LayoutGrid className="h-3.5 w-3.5" />,
                  },
                ]}
              />
            )}
          </div>

          <TabsContent value="created" className="mt-6">
            {!myPlaylists.length ? (
              <EmptyState title={i18n._(msg`还没有创建歌单`)} />
            ) : view === 'grid' ? (
              <PlaylistGrid entries={myPlaylists} />
            ) : (
              <ReorderableList
                storageKey="library:order:created"
                items={myPlaylists}
                getId={(entry) => `${entry.kind}-${entry.playlist.id}`}
                renderItem={(entry) => <PlaylistListRow entry={entry} />}
              />
            )}
          </TabsContent>

          <TabsContent value="saved" className="mt-6">
            {!savedPlaylists.length ? (
              <EmptyState title={i18n._(msg`还没有收藏歌单`)} />
            ) : view === 'grid' ? (
              <div className="grid grid-cols-2 gap-x-5 gap-y-7 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {savedPlaylists.map((playlist) => (
                  <PlaylistCard key={playlist.id} playlist={playlist} />
                ))}
              </div>
            ) : (
              <ReorderableList
                storageKey="library:order:saved"
                items={savedPlaylists}
                getId={(playlist) => String(playlist.id)}
                renderItem={(playlist) => (
                  <MediaRow
                    cover={
                      <ImageWithFallback
                        src={playlist.coverImgUrl}
                        alt={playlist.name}
                        rounded="rounded-[10px]"
                        className="h-full w-full"
                      />
                    }
                    title={playlist.name}
                    subtitle={playlist.creator?.nickname}
                    trailing={i18n._(msg`${playlist.trackCount} 首`)}
                    onClick={() =>
                      void navigate({
                        to: '/songlists/$id',
                        params: { id: String(playlist.id) },
                      })
                    }
                  />
                )}
              />
            )}
          </TabsContent>

          <TabsContent value="albums" className="mt-6">
            {!albums.length ? (
              <EmptyState title={i18n._(msg`还没有收藏专辑`)} />
            ) : view === 'grid' ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {albums.map(({ album, local }) => (
                  <AlbumCard
                    key={album.id}
                    album={album}
                    // Signed out, every album is local by definition.
                    badge={isLogin && local ? <Trans>本地</Trans> : undefined}
                  />
                ))}
              </div>
            ) : (
              <ReorderableList
                storageKey="library:order:albums"
                items={albums}
                getId={(entry) => String(entry.album.id)}
                renderItem={(entry) => (
                  <AlbumListRow entry={entry} showBadge={isLogin} />
                )}
              />
            )}
          </TabsContent>

          {/* Follows is always a card grid: no list mode, no drag reorder. */}
          <TabsContent value="follows" className="mt-6">
            {artists.length ? (
              <section>
                <div className="mb-3.5 flex items-baseline gap-2">
                  <h2 className="section-title">
                    <Trans>关注的歌手</Trans>
                  </h2>
                  <span className="text-[12px] tabular-nums text-ink-4">
                    {artists.length}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-x-4 gap-y-6 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
                  {artists.map((artist) => (
                    <ArtistTile key={artist.id} artist={artist} />
                  ))}
                </div>
              </section>
            ) : null}

            {users.length ? (
              <section className={artists.length ? 'mt-8' : undefined}>
                <div className="mb-3.5 flex items-baseline gap-2">
                  <h2 className="section-title">
                    <Trans>关注的用户</Trans>
                  </h2>
                  <span className="text-[12px] tabular-nums text-ink-4">
                    {users.length}
                  </span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {users.map((user) => (
                    <UserCard key={user.userId} user={user} />
                  ))}
                </div>
              </section>
            ) : null}

            {!artists.length && !users.length ? (
              <EmptyState title={i18n._(msg`还没有关注的歌手或用户`)} />
            ) : null}
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}
