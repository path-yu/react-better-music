const fs = require('fs')
const path = require('path')

/**
 * Guest library persisted next to the installed app (not in browser storage).
 * The packaged main process passes QIMIAO_INSTALL_DIR; dev/API-only runs fall
 * back to the current working directory.
 */
const INSTALL_DIR =
  process.env.QIMIAO_INSTALL_DIR && process.env.QIMIAO_INSTALL_DIR.trim()
    ? process.env.QIMIAO_INSTALL_DIR.trim()
    : process.cwd()
const DATA_DIR = path.join(INSTALL_DIR, 'local-data')
const DATA_FILE = path.join(DATA_DIR, 'library.json')
const MAX_RECENT = 200

class LocalLibraryError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.name = 'LocalLibraryError'
    this.status = status
  }
}

function emptyState() {
  return {
    version: 2,
    playlists: [],
    subscribedPlaylists: [],
    favorites: [],
    recent: [],
  }
}

let state = null

function normalizeSong(song) {
  if (!song || typeof song !== 'object' || !Number.isFinite(Number(song.id))) {
    throw new LocalLibraryError('Invalid song')
  }
  // Never persist signed media URLs or fetched lyrics: they are large and
  // expire; the player resolves them again when a track is opened.
  const snapshot = {
    id: Number(song.id),
    name: typeof song.name === 'string' ? song.name : '',
    ar: Array.isArray(song.ar) ? song.ar : [],
    al: song.al && typeof song.al === 'object' ? song.al : {},
    dt: Number(song.dt) || 0,
    fee: Number(song.fee) || 0,
  }
  for (const key of ['noCopyrightRcmd', 'mv', 'mvid', 'alia', 'tns', 'pc']) {
    if (song[key] !== undefined && song[key] !== null) snapshot[key] = song[key]
  }
  return snapshot
}

function normalizePlaylist(playlist) {
  if (
    !playlist ||
    typeof playlist !== 'object' ||
    !Number.isFinite(Number(playlist.id))
  ) {
    throw new LocalLibraryError('Invalid playlist')
  }
  return {
    id: Number(playlist.id),
    name: typeof playlist.name === 'string' ? playlist.name : '',
    coverImgUrl:
      typeof playlist.coverImgUrl === 'string' ? playlist.coverImgUrl : '',
    trackCount: Number(playlist.trackCount) || 0,
    playCount: Number(playlist.playCount) || 0,
    creator:
      playlist.creator && typeof playlist.creator === 'object'
        ? {
            userId: Number(playlist.creator.userId) || 0,
            nickname:
              typeof playlist.creator.nickname === 'string'
                ? playlist.creator.nickname
                : '',
            avatarUrl:
              typeof playlist.creator.avatarUrl === 'string'
                ? playlist.creator.avatarUrl
                : '',
          }
        : undefined,
  }
}

function load() {
  if (state) return state
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
    state = {
      ...emptyState(),
      ...parsed,
      version: Math.max(2, Number(parsed.version) || 0),
      playlists: Array.isArray(parsed.playlists) ? parsed.playlists : [],
      subscribedPlaylists: Array.isArray(parsed.subscribedPlaylists)
        ? parsed.subscribedPlaylists
        : [],
      favorites: Array.isArray(parsed.favorites) ? parsed.favorites : [],
      recent: Array.isArray(parsed.recent) ? parsed.recent : [],
    }
  } catch {
    state = emptyState()
  }
  return state
}

function persist() {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  const tempFile = `${DATA_FILE}.tmp`
  fs.writeFileSync(tempFile, JSON.stringify(state, null, 2), 'utf8')
  try {
    fs.renameSync(tempFile, DATA_FILE)
  } catch {
    // Windows can reject replacing an existing file if another process has a
    // handle open; fall back to an in-place write so the update is not lost.
    fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), 'utf8')
    try {
      fs.unlinkSync(tempFile)
    } catch {
      // ignore
    }
  }
}

function requirePlaylist(id) {
  const playlist = load().playlists.find((item) => item.id === id)
  if (!playlist) throw new LocalLibraryError('Playlist not found', 404)
  return playlist
}

function playlistName(value) {
  const name = typeof value === 'string' ? value.trim() : ''
  if (!name) throw new LocalLibraryError('Playlist name is required')
  if (name.length > 60) throw new LocalLibraryError('Playlist name is too long')
  return name
}

function createId() {
  return `pl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function getState() {
  return load()
}

function createPlaylist(name) {
  const now = Date.now()
  const playlist = {
    id: createId(),
    name: playlistName(name),
    songs: [],
    createdAt: now,
    updatedAt: now,
  }
  load().playlists.unshift(playlist)
  persist()
  return playlist
}

function updatePlaylist(id, updates) {
  const playlist = requirePlaylist(id)
  if (updates && updates.name !== undefined) {
    playlist.name = playlistName(updates.name)
  }
  playlist.updatedAt = Date.now()
  persist()
  return playlist
}

function deletePlaylist(id) {
  const data = load()
  const index = data.playlists.findIndex((item) => item.id === id)
  if (index < 0) throw new LocalLibraryError('Playlist not found', 404)
  data.playlists.splice(index, 1)
  persist()
  return { id }
}

function addSongToPlaylist(id, song) {
  const playlist = requirePlaylist(id)
  const snapshot = normalizeSong(song)
  if (!playlist.songs.some((item) => Number(item.id) === snapshot.id)) {
    playlist.songs.push(snapshot)
    playlist.updatedAt = Date.now()
    persist()
  }
  return playlist
}

function removeSongFromPlaylist(id, songId) {
  const playlist = requirePlaylist(id)
  const next = playlist.songs.filter(
    (item) => Number(item.id) !== Number(songId),
  )
  if (next.length !== playlist.songs.length) {
    playlist.songs = next
    playlist.updatedAt = Date.now()
    persist()
  }
  return playlist
}

function addSubscribedPlaylist(playlist) {
  const snapshot = normalizePlaylist(playlist)
  const data = load()
  if (
    !data.subscribedPlaylists.some(
      (item) => Number(item.id) === snapshot.id,
    )
  ) {
    data.subscribedPlaylists.unshift(snapshot)
    persist()
  }
  return data.subscribedPlaylists
}

function removeSubscribedPlaylist(playlistId) {
  const data = load()
  data.subscribedPlaylists = data.subscribedPlaylists.filter(
    (item) => Number(item.id) !== Number(playlistId),
  )
  persist()
  return data.subscribedPlaylists
}

function addFavorite(song) {
  const snapshot = normalizeSong(song)
  const data = load()
  if (!data.favorites.some((item) => Number(item.id) === snapshot.id)) {
    data.favorites.unshift(snapshot)
    persist()
  }
  return data.favorites
}

function removeFavorite(songId) {
  const data = load()
  data.favorites = data.favorites.filter(
    (item) => Number(item.id) !== Number(songId),
  )
  persist()
  return data.favorites
}

function recordRecent(song) {
  const snapshot = normalizeSong(song)
  const data = load()
  data.recent = [
    { song: snapshot, playedAt: Date.now() },
    ...data.recent.filter((item) => Number(item.song?.id) !== snapshot.id),
  ].slice(0, MAX_RECENT)
  persist()
  return data.recent
}

function removeRecent(songId) {
  const data = load()
  data.recent = data.recent.filter(
    (item) => Number(item.song?.id) !== Number(songId),
  )
  persist()
  return data.recent
}

function clearRecent() {
  const data = load()
  data.recent = []
  persist()
  return data.recent
}

module.exports = {
  LocalLibraryError,
  DATA_FILE,
  getState,
  createPlaylist,
  updatePlaylist,
  deletePlaylist,
  addSongToPlaylist,
  removeSongFromPlaylist,
  addSubscribedPlaylist,
  removeSubscribedPlaylist,
  addFavorite,
  removeFavorite,
  recordRecent,
  removeRecent,
  clearRecent,
}
