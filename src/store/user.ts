import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  fetchAccount,
  fetchLikedIds,
  fetchLoginStatus,
  fetchUserDetail,
  fetchUserPlaylists,
  likeMusic,
  logout as logoutApi,
  signIn as signInApi,
} from '../api'
import { toast } from '../lib/toast'
import {
  clearLoginCookie,
  fetchGuestCookie,
  getLoginCookie,
  refreshLogin,
} from '../lib/session'
import { usePlayerStore } from './player'
import type { Playlist, UserProfile } from '../types'

interface UserState {
  isLogin: boolean
  initialized: boolean
  profile: UserProfile | null
  level: number
  pcSign: boolean
  likedIds: number[]
  createdPlaylists: Playlist[]
  collectedPlaylists: Playlist[]
  searchHistory: string[]
  initSession: () => Promise<void>
  refreshProfile: () => Promise<void>
  loadPlaylists: (uid: number) => Promise<void>
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
      playlist = { ...playlist, name: '我喜欢的音乐' }
    }
    if (playlist.creator?.userId === uid) created.push(playlist)
    else collected.push(playlist)
  })
  return { created, collected }
}

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
      searchHistory: [],

      async initSession() {
        try {
          if (!getLoginCookie()) await fetchGuestCookie()

          let status = await fetchLoginStatus()
          let account = status.data?.account

          // Restore the persisted cookie: refresh it once when it has expired.
          if (!account?.id && getLoginCookie()) {
            if (await refreshLogin()) {
              status = await fetchLoginStatus()
              account = status.data?.account
            }
          }

          if (account?.id) {
            set({ isLogin: true })
            await get().refreshProfile()
            await Promise.all([get().loadPlaylists(account.id), get().refreshLiked(account.id)])
          } else {
            // Keep an anonymous cookie so public endpoints do not fail with 400.
            await fetchGuestCookie()
            const accountRes = await fetchAccount()
            if (accountRes.account?.id) {
              set({ isLogin: true })
              await get().refreshProfile()
              await Promise.all([
                get().loadPlaylists(accountRes.account.id),
                get().refreshLiked(accountRes.account.id),
              ])
            } else {
              set({ isLogin: false, profile: null, createdPlaylists: [], collectedPlaylists: [] })
            }
          }
        } catch {
          set({ isLogin: false })
        } finally {
          set({ initialized: true })
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
              isLogin: true,
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
          // silent
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
        set((state) => ({ profile, level: level ?? state.level, isLogin: true }))
      },

      async signIn() {
        try {
          const res = await signInApi()
          if (res.code === 200) {
            set({ pcSign: true })
            toast.success('签到成功')
          } else {
            toast.warning('今天已经签到过了')
          }
        } catch {
          toast.error('签到失败')
        }
      },

      async logout() {
        try {
          await logoutApi()
        } catch {
          // ignore
        }
        clearLoginCookie()
        set({
          isLogin: false,
          profile: null,
          level: 0,
          pcSign: false,
          likedIds: [],
          createdPlaylists: [],
          collectedPlaylists: [],
        })
        localStorage.removeItem('react-music-player')
        localStorage.removeItem('react-music-user')
        toast.success('已退出登录')
      },

      async likeSong(id, like) {
        if (!get().isLogin) {
          toast.warning('请先登录')
          return false
        }
        try {
          const res = await likeMusic(id, like)
          if (res.code !== 200) {
            toast.error('操作失败')
            return false
          }
          get().updateLiked(id, like)
          usePlayerStore.getState().markSongLike(id, like)
          toast.success(like ? '已添加到我喜欢的音乐' : '已取消喜欢')
          return true
        } catch {
          toast.error('操作失败')
          return false
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
