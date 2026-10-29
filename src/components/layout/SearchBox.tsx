import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { Trans } from '@lingui/react/macro'
import {
  Clock3,
  Loader2,
  Music2,
  Play,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { Input } from '@pikoloo/darwin-ui'
import {
  fetchAlbumDetail,
  fetchDefaultSearchKeyword,
  fetchHotSearchList,
  fetchSearchSuggest,
} from '../../api'
import { useUserStore } from '../../store/user'
import { usePlayerStore } from '../../store/player'
import { cn } from '../../lib/format'
import { toast } from '../../lib/toast'
import type { Playlist, Song } from '../../types'

interface SuggestState {
  songs: Song[]
  playlists: Playlist[]
}

export function SearchBox() {
  const { i18n } = useLingui()
  const navigate = useNavigate()
  const [keyword, setKeyword] = useState('')
  const [open, setOpen] = useState(false)
  // Empty until the API answers; the placeholder falls back to a static hint.
  // `defaultKeyword` is the display copy, `defaultQuery` the actual search term.
  const [defaultKeyword, setDefaultKeyword] = useState('')
  const [defaultQuery, setDefaultQuery] = useState('')
  const [hotList, setHotList] = useState<Array<{ searchWord: string; score: number }>>([])
  const [suggest, setSuggest] = useState<SuggestState>({ songs: [], playlists: [] })
  const [loading, setLoading] = useState(false)
  const [hotLoading, setHotLoading] = useState(false)
  // Index into the flattened suggestion list: 0 = "search keyword",
  // 1..n = songs, then the playlists.
  const [activeIndex, setActiveIndex] = useState(-1)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const requestIdRef = useRef(0)

  const searchHistory = useUserStore((state) => state.searchHistory)
  const addSearchHistory = useUserStore((state) => state.addSearchHistory)
  const removeSearchHistory = useUserStore((state) => state.removeSearchHistory)
  const clearSearchHistory = useUserStore((state) => state.clearSearchHistory)
  const playSong = usePlayerStore((state) => state.playSong)

  useEffect(() => {
    fetchDefaultSearchKeyword()
      .then((value) => {
        setDefaultKeyword(value.showKeyword)
        setDefaultQuery(value.realKeyword)
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    if (!open || hotList.length) return
    setHotLoading(true)
    fetchHotSearchList()
      .then((list) => setHotList(list.slice(0, 10)))
      .catch(() => undefined)
      .finally(() => setHotLoading(false))
  }, [open, hotList.length])

  useEffect(() => {
    const value = keyword.trim()
    const requestId = ++requestIdRef.current
    const controller = new AbortController()
    if (!value) {
      setSuggest({ songs: [], playlists: [] })
      setLoading(false)
      return () => controller.abort()
    }
    setLoading(true)
    const timer = window.setTimeout(() => {
      fetchSearchSuggest(value, controller.signal)
        .then((result) => {
          if (requestIdRef.current !== requestId) return
          setSuggest(result)
        })
        .catch(() => undefined)
        .finally(() => {
          if (requestIdRef.current === requestId) setLoading(false)
        })
    }, 280)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [keyword])

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [])

  const goSearch = useCallback(
    (value?: string) => {
      const target = (value ?? keyword).trim()
      if (!target) return
      setKeyword(target)
      addSearchHistory(target)
      setOpen(false)
      // A new query starts on 单曲; returning to an existing search keeps the
      // tab stored in that page's URL.
      void navigate({ to: '/search', search: { keyword: target, tab: 'songs' } })
    },
    [addSearchHistory, keyword, navigate],
  )

  const handleSongClick = async (song: Song) => {
    try {
      let playable = song
      if (!song.al.picUrl && song.al.id) {
        const album = await fetchAlbumDetail(song.al.id)
        if (album?.picUrl) {
          playable = { ...song, al: { ...song.al, picUrl: album.picUrl } }
        }
      }
      await playSong(playable)
      setOpen(false)
    } catch {
      toast.error('播放失败')
    }
  }

  const handlePlaylistClick = (id: number) => {
    setOpen(false)
    void navigate({ to: '/songlists/$id', params: { id: String(id) } })
  }

  // Whitespace-only input counts as empty: no suggestions and no clear button.
  const hasQuery = keyword.trim().length > 0
  const songOffset = 1
  const playlistOffset = songOffset + suggest.songs.length
  const optionCount = hasQuery && !loading ? playlistOffset + suggest.playlists.length : 0

  // A new query (or a fresh response) invalidates the highlighted row.
  useEffect(() => {
    setActiveIndex(-1)
  }, [keyword, suggest, open])

  // Keep the keyboard-selected row inside the 480px-high suggestion viewport.
  useEffect(() => {
    if (activeIndex < 0) return
    document
      .getElementById(`search-option-${activeIndex}`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const activateOption = (index: number) => {
    if (index <= 0) {
      goSearch()
      return
    }
    const song = suggest.songs[index - songOffset]
    if (song) {
      void handleSongClick(song)
      return
    }
    const playlist = suggest.playlists[index - playlistOffset]
    if (playlist) handlePlaylistClick(playlist.id)
  }

  const optionProps = (index: number) => ({
    id: `search-option-${index}`,
    role: 'option' as const,
    'aria-selected': activeIndex === index,
    onMouseEnter: () => setActiveIndex(index),
  })

  return (
    <div ref={wrapperRef} className="relative w-full max-w-[420px]">
      <Input.Search
        value={keyword}
        size="sm"
        placeholder={
          (i18n.locale.startsWith('zh') ? defaultKeyword : '') ||
          i18n._(msg`搜索音乐、歌单`)
        }
        onChange={(event) => {
          setKeyword(event.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        // A lone space would otherwise keep the field looking empty while the
        // placeholder stays hidden; normalise it back to '' on blur.
        onBlur={() => {
          if (!keyword.trim()) setKeyword('')
        }}
        role="combobox"
        aria-label="搜索"
        aria-autocomplete="list"
        aria-expanded={hasQuery && open}
        aria-controls="search-suggest-list"
        aria-activedescendant={activeIndex >= 0 ? `search-option-${activeIndex}` : undefined}
        onKeyDown={(event) => {
          // Enter is also used to confirm IME candidates; ignore those keys.
          if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            if (!optionCount) return
            event.preventDefault()
            setActiveIndex((current) => {
              const next = event.key === 'ArrowDown' ? current + 1 : current - 1
              return (next + optionCount) % optionCount
            })
            return
          }
          if (event.key === 'Enter') {
            if (activeIndex >= 0) {
              event.preventDefault()
              activateOption(activeIndex)
              return
            }
            // Empty field: Enter searches the real default keyword (`realkeyword`,
            // e.g. "疑心病"), not the editorial placeholder copy
            // (`showKeyword`, e.g. "🔥 大家都在搜 疑心病").
            goSearch(keyword.trim() || defaultQuery || undefined)
            return
          }
          if (event.key === 'Escape') {
            setOpen(false)
            setActiveIndex(-1)
          }
        }}
        wrapperClassName="w-full"
        className="h-9 rounded-full bg-white/80 pl-9 pr-9 [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden"
      />

      {/* Own clear button: the slot provided by the input was not clickable and
          did not centre vertically, so it is positioned against the wrapper.
          Hidden for whitespace-only input, which is empty for search purposes. */}
      {hasQuery ? (
        <button
          type="button"
          aria-label="清空搜索"
          onClick={() => {
            setKeyword('')
            setActiveIndex(-1)
          }}
          // Keep the caret in the field while clearing, like a native search box.
          onMouseDown={(event) => event.preventDefault()}
          className="pressable absolute right-1.5 top-1/2 z-10 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-black/40 transition-colors hover:bg-black/10 hover:text-black/70 max-md:h-8 max-md:w-8"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}

      {open && (
        <div className="absolute left-0 top-full z-[80] mt-2 w-full min-w-[280px] overflow-hidden rounded-[18px] border border-black/10 bg-white/95 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.35)] backdrop-blur-xl fade-up">
          <div className="max-h-[480px] overflow-y-auto">
            {!hasQuery && (
              <>
                {searchHistory.length > 0 && (
                  <div className="px-4 pt-4">
                    <div className="flex items-center justify-between">
                      <p className="flex items-center gap-1.5 text-[12px] font-medium text-black/45">
                        <Clock3 className="h-3.5 w-3.5" />
                        <Trans>搜索历史</Trans>
                      </p>
                      <button
                        type="button"
                        className="pressable flex items-center gap-1 text-[11px] text-black/35 hover:text-black/70"
                        onClick={() => clearSearchHistory()}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        <Trans>清除</Trans>
                      </button>
                    </div>
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {searchHistory.map((item, index) => (
                        <span
                          key={`${item}-${index}`}
                          className="group inline-flex items-center gap-1 rounded-full border border-black/8 bg-[#f5f5f7] px-2.5 py-1 text-[12px] text-black/70 transition-colors hover:bg-[#ececf0]"
                        >
                          <button type="button" onClick={() => goSearch(item)}>
                            {item}
                          </button>
                          <button
                            type="button"
                            aria-label="移除"
                            className="text-black/25 hover:text-black/60"
                            onClick={() => removeSearchHistory(index)}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-3 px-4 pb-4">
                  <p className="text-[12px] font-medium text-black/45">
                    <Trans>热搜榜</Trans>
                  </p>
                  {hotLoading ? (
                    <div className="flex h-24 items-center justify-center">
                      <Loader2 className="h-4 w-4 animate-spin text-black/30" />
                    </div>
                  ) : (
                    <div className="mt-1">
                      {hotList.map((item, index) => (
                        <button
                          key={item.searchWord}
                          type="button"
                          onClick={() => goSearch(item.searchWord)}
                          className="flex w-full items-center gap-3 rounded-[10px] px-2 py-2 text-left transition-colors hover:bg-black/4"
                        >
                          <span
                            className={`w-4 text-[13px] font-semibold ${
                              index < 3 ? 'text-accent' : 'text-black/30'
                            }`}
                          >
                            {index + 1}
                          </span>
                          <span className="flex-1 truncate text-[13px] text-black/80">
                            {item.searchWord}
                          </span>
                          <span className="text-[11px] text-black/25">{item.score}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}

            {hasQuery && (
              <div id="search-suggest-list" role="listbox" aria-label="搜索建议" className="py-2">
                {loading ? (
                  <div className="flex h-28 items-center justify-center">
                    <Loader2 className="h-5 w-5 animate-spin text-black/30" />
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      {...optionProps(0)}
                      onClick={() => goSearch()}
                      className={cn(
                        'flex w-full items-center gap-2 px-4 py-2.5 text-left text-[13px] text-accent transition-colors hover:bg-black/4',
                        activeIndex === 0 && 'bg-black/6',
                      )}
                    >
                      <Search className="h-3.5 w-3.5" />
                      <Trans>搜索 “{keyword}”</Trans>
                    </button>

                    {suggest.songs.length > 0 && (
                      <p
                        role="presentation"
                        className="flex items-center gap-1.5 px-4 pb-1 pt-2 text-[11px] text-black/35"
                      >
                        <Music2 className="h-3 w-3" />
                        <Trans>单曲</Trans>
                      </p>
                    )}
                    {suggest.songs.map((song, songIndex) => {
                      const optionIndex = songOffset + songIndex
                      return (
                        <button
                          key={song.id}
                          type="button"
                          {...optionProps(optionIndex)}
                          onClick={() => void handleSongClick(song)}
                          className={cn(
                            'group flex w-full items-center gap-2 px-4 py-2 text-left transition-colors hover:bg-black/4',
                            activeIndex === optionIndex && 'bg-black/6',
                          )}
                        >
                          <Play className="h-3 w-3 shrink-0 text-accent opacity-0 transition-opacity group-hover:opacity-100" />
                          <span className="min-w-0 flex-1 truncate text-[13px] text-black/80">
                            {song.name}
                            {song.alia?.[0] ? (
                              <span className="text-black/35">（{song.alia[0]}）</span>
                            ) : null}
                          </span>
                          <span className="max-w-[140px] shrink-0 truncate text-[11px] text-black/35">
                            {song.ar.map((artist) => artist.name).join(' / ')}
                          </span>
                        </button>
                      )
                    })}

                    {suggest.playlists.length > 0 && (
                      <p
                        role="presentation"
                        className="flex items-center gap-1.5 px-4 pb-1 pt-2 text-[11px] text-black/35"
                      >
                        <Music2 className="h-3 w-3" />
                        <Trans>歌单</Trans>
                      </p>
                    )}
                    {suggest.playlists.map((playlist, playlistIndex) => {
                      const optionIndex = playlistOffset + playlistIndex
                      return (
                        <button
                          key={playlist.id}
                          type="button"
                          {...optionProps(optionIndex)}
                          onClick={() => handlePlaylistClick(playlist.id)}
                          className={cn(
                            'flex w-full items-center gap-2 px-4 py-2 text-left transition-colors hover:bg-black/4',
                            activeIndex === optionIndex && 'bg-black/6',
                          )}
                        >
                          <span className="min-w-0 flex-1 truncate text-[13px] text-black/80">
                            {playlist.name}
                          </span>
                          <span className="shrink-0 text-[11px] text-black/30">
                            <Trans>{playlist.trackCount} 首</Trans>
                          </span>
                        </button>
                      )
                    })}

                    {!suggest.songs.length && !suggest.playlists.length && (
                      <p className="px-4 py-8 text-center text-[12px] text-black/35">
                        <Trans>没有找到相关建议</Trans>
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
