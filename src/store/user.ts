import { create } from 'zustand'
import { msg } from '@lingui/core/macro'
import { persist } from 'zustand/middleware'
import {
  fetchAccount,
  fetchCollectedAlbums,
  fetchLikedIds,
  fetchLoginStatus,
  fetchUserDetail,
  fetchUserPlaylists,
  likeMusic,
  logout as logoutApi,
  signIn as signInApi,
} from '../api'
import { toast } from '../lib/toast'
import { ApiError, clearApiCache, invalidateApiCache } from '../lib/http'
import { isNetworkFailure } from '../lib/networkStatus'
import {
  clearLoginCookie,
  fetchGuestCookie,
  getLoginCookie,
  onLoginExpired,
  refreshLogin,
} from '../lib/session'
import { usePlayerStore } from './player'
import { i18n } from '../i18n'
import type { Album, Playlist, UserProfile } from '../types'

interface UserState {
  isLogin: boolean
  initialized: boolean
  profile: UserProfile | null
  level: number
  pcSign: boolean
  likedIds: number[]
  createdPlaylists: Playlist[]
  collectedPlaylists: Playlist[]
  /** Albums collected by the signed-in account (album/sublist). */
  collectedAlbums: Album[]
  searchHistory: string[]
  initSession: () => Promise<void>
  refreshProfile: () => Promise<void>
  loadPlaylists: (uid: number) => Promise<void>
  loadCollectedAlbums: () => Promise<void>
  refreshLiked: (uid: number) => Promise<void>
  setProfile: (profile: UserProfile, level?: number) => void
  signIn: () => Promise<void>
  logout: () => Promise<void>
  likeSong: (id: number, like: boolean) => Promise<boolean>
  updateLiked: (id: number, like: boolean) => void
  addSearchHistory: (keyword: string) => void
  removeSearchHistory: (index: number) => void
  clearSearchHistory: () => void
}

function splitPlaylists(uid: number, playlists: Playlist[]) {
  const created: Playlist[] = []
  const collected: Playlist[] = []
  playlists.forEach((playlist, index) => {
    if (index === 0) {
      // NetEase always lists the account's liked playlist first. Mark it so
      // pickers can exclude it without comparing the (now translated) name.
      playlist = { ...playlist, name: i18n._(msg`我喜欢的音乐`), isMyLike: true }
    }
    if (playlist.creator?.userId === uid) created.push(playlist)
    else collected.push(playlist)
  })
  return { created, collected }
}

/**
 * The local API injects an anonymous account (type 1000) when no valid login
 * cookie is sent, so a non-null account id alone does not mean "logged in".
 */
function isAnonymousAccount(
  account?: { id?: number; type?: number; anonimousUser?: boolean } | null,
) {
  if (!account?.id) return true
  return account.anonimousUser === true || account.type === 1000
}

/**
 * The API could not be reached (offline, request timeout, the desktop API
 * still booting, upstream 5xx). That says nothing about the login itself.
 */
function isTransientFailure(error: unknown) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  // initSession passes no caller signal, so an abort here is the request timeout.
  if (error instanceof DOMException && error.name === 'AbortError') return true
  if (isNetworkFailure(error)) return true
  return error instanceof ApiError && error.status >= 500
}

/** Back-off for re-checking the session after an offline launch. */
const SESSION_RETRY_DELAYS = [5_000, 15_000, 30_000, 60_000]
let sessionRetryTimer: number | undefined
let sessionRetryAttempt = 0
let removeOnlineRetry: (() => void) | null = null
let sessionInit: Promise<void> | null = null

function cancelSessionRetry(resetBackoff = true) {
  if (sessionRetryTimer !== undefined) {
    window.clearTimeout(sessionRetryTimer)
    sessionRetryTimer = undefined
  }
  removeOnlineRetry?.()
  removeOnlineRetry = null
  if (resetBackoff) sessionRetryAttempt = 0
}

/** Retry on the next `online` event or after the back-off, whichever is first. */
function scheduleSessionRetry(run: () => void) {
  cancelSessionRetry(false)
  const delay =
    SESSION_RETRY_DELAYS[Math.min(sessionRetryAttempt, SESSION_RETRY_DELAYS.length - 1)]
  sessionRetryAttempt += 1
  const retry = () => {
    cancelSessionRetry(false)
    run()
  }
  sessionRetryTimer = window.setTimeout(retry, delay)
  window.addEventListener('online', retry, { once: true })
  removeOnlineRetry = () => window.removeEventListener('online', retry)
}

/** Songs with a like/unlike request in flight; repeated clicks are ignored. */
const likePending = new Set<number>()

export const useUserStore = create<UserState>()(
  persist(
    (set, get) => ({
      isLogin: false,
      initialized: false,
      profile: null,
      level: 0,
      pcSign: false,
      likedIds: [],
      createdPlaylists: [],
      collectedPlaylists: [],
      collectedAlbums: [],
      searchHistory: [],

      initSession() {
        // AppShell, the online listener and the retry timer may overlap.
        if (sessionInit) return sessionInit
        sessionInit = runInitSession().finally(() => {
          sessionInit = null
        })
        return sessionInit

        async function runInitSession() {
        try {
          const hadLoginCookie = Boolean(getLoginCookie())
          if (!hadLoginCookie) await fetchGuestCookie()

          const wasLoggedIn = get().isLogin || Boolean(get().profile)
          let status = await fetchLoginStatus()
          let account = status.data?.account

          // Restore the persisted cookie: refresh it once when it has expired.
          if (isAnonymousAccount(account) && hadLoginCookie) {
            if (await refreshLogin()) {
              status = await fetchLoginStatus()
              account = status.data?.account
            }
          }

          // The API answered: whatever it said, offline retries are over.
          cancelSessionRetry()
          const uid = account?.id
          if (uid && !isAnonymousAccount(account)) {
            set({ isLogin: true })
            // Profile and library only need the uid, so fetch them together
            // instead of two sequential upstream round-trips.
            await Promise.all([
              get().refreshProfile(),
              get().loadPlaylists(uid),
              get().refreshLiked(uid),
            ])
            // Sidebar-only data; do not hold up the session on it.
            void get().loadCollectedAlbums()
            // Rotate the cookie after each launch so the persisted session
            // never goes stale as long as the app is opened regularly.
            void refreshLogin()
            return
          }

          // Keep an anonymous cookie so public endpoints do not fail with 400.
          if (wasLoggedIn) clearApiCache()
          await fetchGuestCookie()
          set({
            isLogin: false,
            profile: null,
            level: 0,
            pcSign: false,
            likedIds: [],
            createdPlaylists: [],
            collectedPlaylists: [],
          })
          // A rejected cookie already surfaces a toast from refreshLogin;
          // here we only cover the "cookie vanished but profile remained" case.
          if (wasLoggedIn && !hadLoginCookie)
            toast.warning(i18n._(msg`登录状态已失效，请重新登录`))
        } catch (error) {
          // Launching offline (or before the desktop API is up) is not a
          // logout: keep the persisted profile and likes, and check the
          // session again once the network is back. The network toast already
          // tells the user what is going on.
          if (getLoginCookie() && isTransientFailure(error)) {
            scheduleSessionRetry(() => void get().initSession())
            return
          }
          set({
            isLogin: false,
            profile: null,
            level: 0,
            pcSign: false,
            likedIds: [],
            createdPlaylists: [],
            collectedPlaylists: [],
          })
        } finally {
          set({ initialized: true })
        }
        }
      },

      async refreshProfile() {
        const profile = get().profile
        try {
          let uid = profile?.userId
          if (!uid) {
            const account = await fetchAccount()
            uid = account.account?.id
          }
          if (!uid) return
          const detail = await fetchUserDetail(uid)
          if (detail?.profile) {
            set({
              profile: detail.profile,
              level: detail.level ?? 0,
              pcSign: Boolean(detail.pcSign),
            })
          }
        } catch {
          // silent
        }
      },

      async loadPlaylists(uid) {
        try {
          const playlists = await fetchUserPlaylists(uid)
          const { created, collected } = splitPlaylists(uid, playlists)
          set({ createdPlaylists: created, collectedPlaylists: collected })
        } catch {
          if (get().isLogin)
            toast.warning(i18n._(msg`歌单加载失败，请稍后重试`))
        }
      },

      async loadCollectedAlbums() {
        try {
          const { albums } = await fetchCollectedAlbums(100, 0)
          set({ collectedAlbums: albums })
        } catch {
          // A sidebar nicety: a failed album list must not toast on startup.
        }
      },

      async refreshLiked(uid) {
        try {
          const ids = await fetchLikedIds(uid)
          set({ likedIds: ids })
        } catch {
          // silent
        }
      },

      setProfile(profile, level) {
        cancelSessionRetry()
        set((state) => ({ profile, level: level ?? state.level, isLogin: true }))
      },

      async signIn() {
        try {
          const res = await signInApi()
          if (res.code === 200) {
            set({ pcSign: true })
            toast.success(i18n._(msg`签到成功`))
          } else {
            toast.warning(i18n._(msg`今天已经签到过了`))
          }
        } catch {
          toast.error(i18n._(msg`签到失败`))
        }
      },

      async logout() {
        cancelSessionRetry()
        try {
          await logoutApi()
        } catch {
          // ignore
        }
        clearLoginCookie()
        clearApiCache()
        set({
          isLogin: false,
          profile: null,
          level: 0,
          pcSign: false,
          likedIds: [],
          createdPlaylists: [],
          collectedPlaylists: [],
        })
        // Logging out must not stop the music. The queue is local state and
        // stays (removing its storage key never stuck anyway: the next state
        // change wrote it back). Only drop the per-account bits: like flags
        // and 心动模式, which needs a login to refill. Search history is local
        // too and is kept.
        usePlayerStore.setState((state) => ({
          heartMode: false,
          queue: state.queue.some((song) => song.like !== undefined)
            ? state.queue.map((song) =>
                song.like === undefined ? song : { ...song, like: undefined },
              )
            : state.queue,
        }))
        toast.success(i18n._(msg`已退出登录`))
      },

      async likeSong(id, like) {
        if (!get().isLogin) {
          toast.warning(i18n._(msg`请先登录`))
          return false
        }
        if (likePending.has(id)) return false
        likePending.add(id)
        // Update the heart right away; roll back if the request fails.
        const previous = get().likedIds.includes(id)
        get().updateLiked(id, like)
        usePlayerStore.getState().markSongLike(id, like)
        try {
          const res = await likeMusic(id, like)
          if (res.code !== 200) throw new Error(String(res.code))
          // 我喜欢的音乐 is cached as a playlist for five minutes.
          invalidateApiCache(['/playlist/detail', '/playlist/track/all'])
          toast.success(
            like
              ? i18n._(msg`已添加到我喜欢的音乐`)
              : i18n._(msg`已取消喜欢`),
          )
          return true
        } catch {
          get().updateLiked(id, previous)
          usePlayerStore.getState().markSongLike(id, previous)
          toast.error(i18n._(msg`操作失败`))
          return false
        } finally {
          likePending.delete(id)
        }
      },

      updateLiked(id, like) {
        set((state) => ({
          likedIds: like
            ? state.likedIds.includes(id)
              ? state.likedIds
              : [...state.likedIds, id]
            : state.likedIds.filter((item) => item !== id),
        }))
      },

      addSearchHistory(keyword) {
        const value = keyword.trim()
        if (!value) return
        set((state) => ({
          searchHistory: [value, ...state.searchHistory.filter((item) => item !== value)].slice(
            0,
            12,
          ),
        }))
      },

      removeSearchHistory(index) {
        set((state) => ({
          searchHistory: state.searchHistory.filter((_, i) => i !== index),
        }))
      },

      clearSearchHistory() {
        set({ searchHistory: [] })
      },
    }),
    {
      name: 'react-music-user',
      partialize: (state) => ({
        isLogin: state.isLogin,
        profile: state.profile,
        level: state.level,
        pcSign: state.pcSign,
        likedIds: state.likedIds,
        searchHistory: state.searchHistory,
      }),
    },
  ),
)

// The HTTP layer falls back to a guest cookie when /login/refresh fails; make
// sure the UI stops showing the stale profile as if it were still signed in.
onLoginExpired(() => {
  cancelSessionRetry()
  // The session may have expired during the periodic cookie refresh, not just
  // while a request was in flight; never keep serving the previous account's
  // cached reads.
  clearApiCache()
  useUserStore.setState({
    isLogin: false,
    profile: null,
    level: 0,
    pcSign: false,
    likedIds: [],
    createdPlaylists: [],
    collectedPlaylists: [],
  })
  toast.warning(i18n._(msg`登录已过期，请重新登录`))
})
