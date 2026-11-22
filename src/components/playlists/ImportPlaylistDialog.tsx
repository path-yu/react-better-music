import { useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { Trans } from '@lingui/react/macro'
import { Check, Link2, Loader2 } from 'lucide-react'
import { Button, Modal } from '@pikoloo/darwin-ui'
import {
  addTracksToPlaylist,
  createPlaylist,
  fetchApplePlaylist,
  fetchPlaylistDetail,
  fetchPlaylistTracks,
  fetchQqPlaylist,
  fetchYoutubePlaylist,
  resolvePlaylistLink,
  searchAll,
  type ApplePlaylistTrack,
} from '../../api'
import { ImageWithFallback } from '../common/ImageWithFallback'
import { useLocalLibraryStore } from '../../store/localLibrary'
import { useUserStore } from '../../store/user'
import { toast } from '../../lib/toast'
import { cn } from '../../lib/format'
import type { Song } from '../../types'

const TRACK_PAGE = 1000
const ADD_BATCH = 500

type ResolvedPlaylist = {
  id: string
  name: string
  coverUrl: string
  songs: Song[]
}

function normalizeTitle(value: string) {
  return value
    .toLowerCase()
    .replace(/[\s()（）[\]【】\-_'"’.,，。·&/:：!！?？]+/g, '')
}

/**
 * Pick the search result that really is this track. The first hit is often a
 * cover, a live take or an accompaniment; prefer the same artist, the same
 * title and a similar length.
 */
function pickBestMatch(track: ApplePlaylistTrack, songs: Song[]): Song | null {
  const title = normalizeTitle(track.name)
  const artist = normalizeTitle(track.artist ?? '')
  // Sources report the duration in seconds or milliseconds.
  const trackMs =
    track.duration > 0 && track.duration < 10_000 ? track.duration * 1000 : track.duration
  let best: Song | null = null
  let bestScore = Number.NEGATIVE_INFINITY
  for (let index = 0; index < songs.length; index += 1) {
    const song = songs[index]
    let score = -index * 0.5
    const name = normalizeTitle(song.name)
    if (name && name === title) score += 3
    else if (name && title && (name.includes(title) || title.includes(name))) score += 1.5
    const artists = song.ar.map((item) => normalizeTitle(item.name)).filter(Boolean)
    if (artist && artists.some((item) => artist.includes(item) || item.includes(artist))) {
      score += 4
    }
    if (trackMs > 0 && song.dt > 0) {
      const diff = Math.abs(song.dt - trackMs)
      if (diff < 3_000) score += 2
      else if (diff > 30_000) score -= 2
    }
    if (score > bestScore) {
      bestScore = score
      best = song
    }
  }
  return best
}

function playlistIdFromUrl(value: string) {
  const input = value.trim()
  if (/^\d+$/.test(input)) return input
  const patterns = [
    /[?&#]id=(\d+)/,
    /\/playlist\/(\d+)/,
    /playlist\?id=(\d+)/,
  ]
  for (const pattern of patterns) {
    const match = input.match(pattern)
    if (match?.[1]) return match[1]
  }
  return ''
}

function urlFromShareText(value: string) {
  const match = value.match(/https?:\/\/[^\s<>"']+/i)
  return match?.[0].replace(/[),.。]+$/, '') ?? ''
}

type ExternalPlaylistSource = {
  url: string
  label: string
  load: () => Promise<{
    title?: string
    coverUrl?: string
    tracks?: ApplePlaylistTrack[]
  }>
}

function externalPlaylistSource(value: string): ExternalPlaylistSource | null {
  const candidate = urlFromShareText(value) || value.trim()
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return null
  }
  const host = url.hostname
  if (
    (host === 'music.apple.com' || host.endsWith('.music.apple.com')) &&
    url.pathname.includes('/playlist/') &&
    /\/pl\.[A-Za-z0-9.-]+/.test(url.pathname)
  ) {
    return {
      url: candidate,
      label: 'Apple Music',
      load: () => fetchApplePlaylist(candidate),
    }
  }
  if (
    (host === 'y.qq.com' || host.endsWith('.y.qq.com')) &&
    /^\d+$/.test(url.searchParams.get('id') ?? '')
  ) {
    return {
      url: candidate,
      label: 'QQ 音乐',
      load: () => fetchQqPlaylist(candidate),
    }
  }
  if (host === 'music.youtube.com' && url.searchParams.get('list')) {
    return {
      url: candidate,
      label: 'YouTube Music',
      load: () => fetchYoutubePlaylist(candidate),
    }
  }
  return null
}

async function resolvePlaylistInput(
  value: string,
  resolveError: string,
) {
  const direct = playlistIdFromUrl(value)
  if (direct) return direct
  const sharedUrl = urlFromShareText(value)
  if (!sharedUrl) return ''
  const embedded = playlistIdFromUrl(sharedUrl)
  if (embedded) return embedded
  let host: string
  try {
    host = new URL(sharedUrl).hostname
  } catch {
    return ''
  }
  if (host !== '163cn.tv' && !host.endsWith('.163cn.tv')) return ''
  const resolved = await resolvePlaylistLink(sharedUrl)
  const finalUrl = resolved.url ?? ''
  const resolvedId = playlistIdFromUrl(finalUrl)
  if (!resolvedId) throw new Error(resolveError)
  return resolvedId
}

export function ImportPlaylistDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { i18n } = useLingui()
  const navigate = useNavigate()
  const isLogin = useUserStore((state) => state.isLogin)
  const profile = useUserStore((state) => state.profile)
  const createLocalPlaylist = useLocalLibraryStore(
    (state) => state.createPlaylist,
  )
  const [url, setUrl] = useState('')
  const [collection, setCollection] = useState<ResolvedPlaylist | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [playlistName, setPlaylistName] = useState('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  // Reading/matching a link only reads, so it can be cancelled by closing the
  // dialog; creating the playlist writes and must finish.
  const [phase, setPhase] = useState<'resolve' | 'import' | null>(null)
  const resolveTokenRef = useRef(0)
  /** Source tracks that had no NetEase match ("title - artist"). */
  const [unmatched, setUnmatched] = useState<string[]>([])

  const close = () => {
    if (loading && phase === 'import') return
    resolveTokenRef.current += 1
    setLoading(false)
    setPhase(null)
    setError('')
    setStatus('')
    onOpenChange(false)
  }

  const reset = () => {
    if (loading) return
    setCollection(null)
    setSelected(new Set())
    setPlaylistName('')
    setUnmatched([])
    setError('')
  }

  const resolvePlaylist = async () => {
    if (loading) return
    setError('')
    setLoading(true)
    setPhase('resolve')
    setUnmatched([])
    const token = ++resolveTokenRef.current
    const cancelled = () => token !== resolveTokenRef.current
    setStatus(i18n._(msg`正在解析歌单链接…`))
    try {
      const external = externalPlaylistSource(url)
      if (external) {
        setStatus(
          i18n._(msg`正在读取 ${external.label} 歌单…`),
        )
        const source = await external.load()
        if (cancelled()) return
        const sourceTracks = source.tracks ?? []
        if (!sourceTracks.length) {
          throw new Error(
            i18n._(msg`${external.label} 歌单没有歌曲`),
          )
        }
        const matched: Song[] = []
        const seen = new Set<number>()
        const missing: string[] = []
        const batchSize = 5
        for (let index = 0; index < sourceTracks.length; index += batchSize) {
          const batch = sourceTracks.slice(index, index + batchSize)
          const results = await Promise.all(
            batch.map(async (track) => {
              try {
                const result = await searchAll({
                  keywords: `${track.name} ${track.artist}`.trim(),
                  type: '1',
                  limit: 5,
                })
                return pickBestMatch(track, result.songs ?? [])
              } catch {
                return null
              }
            }),
          )
          if (cancelled()) return
          results.forEach((song, offset) => {
            if (!song) {
              const track = batch[offset]
              missing.push(track.artist ? `${track.name} - ${track.artist}` : track.name)
              return
            }
            if (seen.has(song.id)) return
            seen.add(song.id)
            matched.push(song)
          })
          setStatus(
            i18n._(
              msg`正在匹配歌曲 ${Math.min(index + batch.length, sourceTracks.length)}/${sourceTracks.length}…`,
            ),
          )
        }
        if (!matched.length) {
          throw new Error(i18n._(msg`没有匹配到可导入的歌曲`))
        }
        const title =
          source.title?.trim() || i18n._(msg`导入的歌单`)
        setCollection({
          id: external.url,
          name: title,
          coverUrl: source.coverUrl ?? '',
          songs: matched,
        })
        setSelected(new Set(matched.map((song) => song.id)))
        setUnmatched(missing)
        setPlaylistName(title)
        return
      }

      const playlistId = await resolvePlaylistInput(
        url,
        i18n._(msg`短链接解析失败或歌单不存在`),
      )
      if (!playlistId) {
        setError(i18n._(msg`请输入网易云歌单链接或歌单 ID`))
        return
      }
      setStatus(i18n._(msg`正在读取歌单…`))
      const detail = await fetchPlaylistDetail(playlistId)
      if (cancelled()) return
      const songs: Song[] = []
      let offset = 0
      while (songs.length < 10000) {
        const page = await fetchPlaylistTracks(playlistId, TRACK_PAGE, offset)
        if (cancelled()) return
        if (!page.length) break
        songs.push(...page)
        offset += page.length
        if (page.length < TRACK_PAGE) break
        if (detail.trackCount > 0 && songs.length >= detail.trackCount) break
      }
      const unique = [...new Map(songs.map((song) => [song.id, song])).values()]
      if (!unique.length) throw new Error(i18n._(msg`歌单没有可导入的歌曲`))
      setCollection({
        id: playlistId,
        name: detail.name.trim() || i18n._(msg`导入的歌单`),
        coverUrl: detail.coverImgUrl,
        songs: unique,
      })
      setSelected(new Set(unique.map((song) => song.id)))
      setPlaylistName(detail.name.trim() || i18n._(msg`导入的歌单`))
    } catch (reason) {
      if (cancelled()) return
      setError(
        reason instanceof Error
          ? reason.message
          : i18n._(msg`歌单解析失败`),
      )
    } finally {
      if (!cancelled()) {
        setLoading(false)
        setPhase(null)
        setStatus('')
      }
    }
  }

  const toggleSong = (id: number) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allSelected = Boolean(
    collection &&
      collection.songs.length > 0 &&
      collection.songs.every((song) => selected.has(song.id)),
  )

  const toggleAll = () => {
    if (!collection) return
    setSelected(
      allSelected
        ? new Set()
        : new Set(collection.songs.map((song) => song.id)),
    )
  }

  const selectedSongs = collection
    ? collection.songs.filter((song) => selected.has(song.id))
    : []

  const importSelected = async () => {
    if (loading || !collection || !selectedSongs.length) return
    const name = playlistName.trim() || collection.name
    setError('')
    setLoading(true)
    setPhase('import')
    try {
      if (isLogin && profile) {
        setStatus(i18n._(msg`正在创建网易云歌单…`))
        const created = await createPlaylist(name)
        const newId = created.id ?? created.playlist?.id
        if (!newId) throw new Error(i18n._(msg`创建歌单失败`))
        for (let index = 0; index < selectedSongs.length; index += ADD_BATCH) {
          const chunk = selectedSongs
            .slice(index, index + ADD_BATCH)
            .map((song) => song.id)
          setStatus(
            i18n._(
              msg`正在导入歌曲 ${Math.min(index + chunk.length, selectedSongs.length)}/${selectedSongs.length}…`,
            ),
          )
          const added = await addTracksToPlaylist(newId, chunk)
          const code = added.code ?? added.body?.code ?? added.status
          if (code !== 200) {
            // The playlist exists by now; say how far the import got.
            throw new Error(
              added.body?.message ||
                i18n._(msg`导入中断：已导入 ${index} 首，其余歌曲添加失败`),
            )
          }
        }
        await useUserStore.getState().loadPlaylists(profile.userId)
        toast.success(
          i18n._(msg`已导入 ${selectedSongs.length} 首到“${name}”`),
        )
        onOpenChange(false)
        void navigate({
          to: '/songlists/$id',
          params: { id: String(newId) },
        })
        return
      }

      setStatus(i18n._(msg`正在创建本地歌单…`))
      const playlist = await createLocalPlaylist(name, selectedSongs)
      if (!playlist) throw new Error(i18n._(msg`创建本地歌单失败`))
      toast.success(
        i18n._(msg`已导入 ${selectedSongs.length} 首到“${name}”`),
      )
      onOpenChange(false)
      void navigate({
        to: '/local/playlists/$id',
        params: { id: playlist.id },
      })
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : i18n._(msg`歌单导入失败`),
      )
    } finally {
      setLoading(false)
      setPhase(null)
      setStatus('')
    }
  }

  return (
    <Modal
      isOpen={open}
      onClose={close}
      title={i18n._(msg`导入歌单`)}
      size={collection ? 'md' : 'sm'}
      glass
    >
      {collection ? (
        <div className="flex max-h-[72vh] flex-col gap-3 pb-1">
          <div className="flex items-center gap-3">
            <ImageWithFallback
              src={collection.coverUrl}
              alt={collection.name}
              rounded="rounded-[8px]"
              className="h-11 w-11 shrink-0"
              resize="128y128"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-black/80 dark:text-white/85">
                {collection.name}
              </p>
              <p className="mt-0.5 text-[11px] text-black/35 dark:text-white/40">
                <Trans>共 {collection.songs.length} 首歌曲</Trans>
                {unmatched.length ? (
                  <span
                    className="text-[#b36b00]"
                    title={unmatched.slice(0, 40).join('\n')}
                  >
                    {' · '}
                    <Trans>{unmatched.length} 首未匹配</Trans>
                  </span>
                ) : null}
              </p>
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={reset}
              disabled={loading}
            >
              <Trans>重新解析</Trans>
            </Button>
          </div>

          <div className="flex items-center justify-between text-[11px] text-black/40 dark:text-white/45">
            <span>
              <Trans>
                已选择 {selectedSongs.length} / {collection.songs.length} 首
              </Trans>
            </span>
            <button
              type="button"
              onClick={toggleAll}
              disabled={loading}
              className="pressable text-accent hover:underline"
            >
              {allSelected ? <Trans>取消全选</Trans> : <Trans>全选</Trans>}
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto rounded-[10px] border border-black/8 dark:border-white/10">
            {collection.songs.map((song, index) => {
              const checked = selected.has(song.id)
              return (
                <button
                  key={song.id}
                  type="button"
                  disabled={loading}
                  onClick={() => toggleSong(song.id)}
                  className={cn(
                    'flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors',
                    index > 0 && 'border-t border-black/5 dark:border-white/8',
                    checked
                      ? 'bg-accent/5'
                      : 'hover:bg-black/3 dark:hover:bg-white/5',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors',
                      checked
                        ? 'border-accent bg-accent text-white'
                        : 'border-black/20 text-transparent dark:border-white/25',
                    )}
                  >
                    <Check className="h-2.5 w-2.5" strokeWidth={3} />
                  </span>
                  <span className="w-6 shrink-0 text-right text-[10px] tabular-nums text-black/25 dark:text-white/30">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] text-black/75 dark:text-white/80">
                      {song.name}
                    </span>
                    <span className="mt-0.5 block truncate text-[10.5px] text-black/35 dark:text-white/40">
                      {song.ar.map((artist) => artist.name).join(' / ')}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>

          <label className="flex items-center gap-2 text-[11px] text-black/40 dark:text-white/45">
            <span className="shrink-0">
              <Trans>歌单名称</Trans>
            </span>
            <input
              value={playlistName}
              disabled={loading}
              onChange={(event) => setPlaylistName(event.target.value)}
              maxLength={60}
              className="h-8 min-w-0 flex-1 rounded-[7px] border border-black/10 bg-white/70 px-2 text-[12px] text-black/80 outline-none focus:border-accent/50 dark:border-white/10 dark:bg-white/10 dark:text-white/85"
            />
          </label>

          {error ? (
            <p className="rounded-[8px] bg-red-500/8 px-3 py-2 text-[11px] leading-relaxed text-red-500/90">
              {error}
            </p>
          ) : null}
          {loading && status ? (
            <p className="flex items-center gap-2 text-[11px] text-black/40 dark:text-white/45">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {status}
            </p>
          ) : null}

          <div className="flex items-center justify-between gap-3">
            <p className="text-[10.5px] text-black/30 dark:text-white/35">
              {isLogin && profile ? (
                <Trans>将导入到网易云歌单</Trans>
              ) : (
                <Trans>将导入到本地歌单</Trans>
              )}
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={close}
                disabled={loading}
              >
                <Trans>取消</Trans>
              </Button>
              <Button
                size="sm"
                variant="primary"
                loading={loading}
                disabled={!selectedSongs.length || !playlistName.trim() || loading}
                onClick={() => void importSelected()}
              >
                <Trans>导入 {selectedSongs.length} 首</Trans>
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3 pb-1">
          <p className="text-[12px] leading-relaxed text-black/45 dark:text-white/50">
            <Trans>
              粘贴网易云、QQ 音乐、Apple Music 或 YouTube Music 歌单链接。解析后可以选择需要导入的歌曲。登录后会创建网易云歌单；未登录时创建本地歌单。
            </Trans>
          </p>
          <label className="flex h-9 items-center gap-2 rounded-[9px] border border-black/10 bg-white/70 px-3 dark:border-white/10 dark:bg-white/10">
            <Link2 className="h-3.5 w-3.5 shrink-0 text-black/30 dark:text-white/35" />
            <input
              autoFocus
              value={url}
              disabled={loading}
              onChange={(event) => {
                setUrl(event.target.value)
                setError('')
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void resolvePlaylist()
              }}
              placeholder={i18n._(msg`粘贴歌单链接`)}
              className="min-w-0 flex-1 bg-transparent text-[12px] text-black/80 outline-none placeholder:text-black/25 disabled:opacity-60 dark:text-white/85 dark:placeholder:text-white/25"
            />
          </label>
          {error ? (
            <p className="rounded-[8px] bg-red-500/8 px-3 py-2 text-[11px] leading-relaxed text-red-500/90">
              {error}
            </p>
          ) : null}
          {loading && status ? (
            <p className="flex items-center gap-2 text-[11px] text-black/40 dark:text-white/45">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {status}
            </p>
          ) : null}
          <div className="mt-1 flex justify-end gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={close}
              disabled={loading}
            >
              <Trans>取消</Trans>
            </Button>
            <Button
              size="sm"
              variant="primary"
              loading={loading}
              disabled={!url.trim() || loading}
              onClick={() => void resolvePlaylist()}
            >
              <Trans>解析</Trans>
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
