const fs = require('fs')
const path = require('path')

/**
 * Guest library persisted in the app-data directory (not in browser storage).
 * The packaged main process passes QIMIAO_DATA_DIR so dev rebuilds cannot wipe
 * it; API-only runs fall back to the install/current working directory.
 */
const INSTALL_DIR =
  process.env.QIMIAO_INSTALL_DIR && process.env.QIMIAO_INSTALL_DIR.trim()
    ? process.env.QIMIAO_INSTALL_DIR.trim()
    : process.cwd()
const DATA_DIR =
  process.env.QIMIAO_DATA_DIR && process.env.QIMIAO_DATA_DIR.trim()
    ? process.env.QIMIAO_DATA_DIR.trim()
    : path.join(INSTALL_DIR, 'local-data')
const DATA_FILE = path.join(DATA_DIR, 'library.json')

/**
 * Older builds stored the guest library inside the generated dev/install tree.
 * Copy the newest legacy file into the stable app-data directory once, before
 * the API starts serving requests.
 */
function migrateLegacyLibrary() {
  if (fs.existsSync(DATA_FILE)) return
  const candidates = [
    path.join(process.cwd(), 'local-data', 'library.json'),
    path.join(INSTALL_DIR, 'local-data', 'library.json'),
    process.env.LOCALAPPDATA
      ? path.join(
          process.env.LOCALAPPDATA,
          'com.qimiao.music',
          'stable',
          'app',
          'bin',
          'local-data',
          'library.json',
        )
      : null,
  ].filter(Boolean)

  let source = null
  let sourceTime = 0
  for (const candidate of candidates) {
    try {
      const stat = fs.statSync(candidate)
      if (stat.size <= 2 || stat.mtimeMs <= sourceTime) continue
      source = candidate
      sourceTime = stat.mtimeMs
    } catch {
      // Missing legacy path.
    }
  }
  if (!source) return
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.copyFileSync(source, DATA_FILE)
    console.log(`[local-library] migrated ${source} -> ${DATA_FILE}`)
  } catch {
    // A read-only data dir cannot be recovered here; the API still starts.
  }
}

migrateLegacyLibrary()
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
    version: 5,
    playlists: [],
    subscribedPlaylists: [],
    // Albums saved by a guest. Kept separate from the NetEase account library
    // so signing out never mixes the two.
    subscribedAlbums: [],
    // Same idea for artists the guest follows.
    subscribedArtists: [],
    // And for user accounts the guest follows.
    subscribedUsers: [],
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
  const songs = Array.isArray(playlist.songs)
    ? playlist.songs
    : Array.isArray(playlist.tracks)
      ? playlist.tracks
      : []
  return {
    id: Number(playlist.id),
    name: typeof playlist.name === 'string' ? playlist.name : '',
    coverImgUrl:
      typeof playlist.coverImgUrl === 'string' ? playlist.coverImgUrl : '',
    trackCount: Number(playlist.trackCount) || songs.length,
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
    songs: songs.map(normalizeSong),
  }
}

function load() {
  if (state) return state
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
    state = {
      ...emptyState(),
      ...parsed,
      version: Math.max(5, Number(parsed.version) || 0),
      playlists: Array.isArray(parsed.playlists) ? parsed.playlists : [],
      subscribedPlaylists: Array.isArray(parsed.subscribedPlaylists)
        ? parsed.subscribedPlaylists
        : [],
      subscribedAlbums: Array.isArray(parsed.subscribedAlbums)
        ? parsed.subscribedAlbums
        : [],
      subscribedArtists: Array.isArray(parsed.subscribedArtists)
        ? parsed.subscribedArtists
        : [],
      subscribedUsers: Array.isArray(parsed.subscribedUsers)
        ? parsed.subscribedUsers
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

/**
 * A composed cover is a data URL, and the whole library is one JSON file: cap
 * the length so a malformed client cannot bloat the file, and drop anything
 * that is not a string.
 */
function playlistCover(value) {
  if (typeof value !== 'string') return undefined
  const cover = value.trim()
  if (!cover || cover.length > 300_000) return undefined
  return cover
}

function getState() {
  return load()
}

function createPlaylist(name, songs, coverUrl) {
  const now = Date.now()
  const seen = new Set()
  const snapshots = []
  if (Array.isArray(songs)) {
    for (const song of songs) {
      try {
        const snapshot = normalizeSong(song)
        if (seen.has(snapshot.id)) continue
        seen.add(snapshot.id)
        snapshots.push(snapshot)
      } catch {
        // Ignore malformed queue entries; save the rest of the queue.
      }
    }
  }
  const cover = playlistCover(coverUrl)
  const playlist = {
    id: createId(),
    name: playlistName(name),
    songs: snapshots,
    ...(cover ? { coverUrl: cover } : {}),
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

/**
 * Album snapshot for the guest library. Only the fields the album card and the
 * detail header render are kept: no songs, no comment thread, nothing that
 * expires.
 */
function normalizeAlbum(album) {
  if (!album || typeof album !== 'object' || !Number.isFinite(Number(album.id))) {
    throw new LocalLibraryError('Invalid album')
  }
  const artist =
    album.artist && typeof album.artist === 'object'
      ? {
          id: Number(album.artist.id) || 0,
          name: typeof album.artist.name === 'string' ? album.artist.name : '',
        }
      : undefined
  const artists = Array.isArray(album.artists)
    ? album.artists
        .filter((item) => item && typeof item === 'object')
        .map((item) => ({
          id: Number(item.id) || 0,
          name: typeof item.name === 'string' ? item.name : '',
        }))
    : undefined
  return {
    id: Number(album.id),
    name: typeof album.name === 'string' ? album.name : '',
    picUrl:
      typeof album.picUrl === 'string'
        ? album.picUrl
        : typeof album.blurPicUrl === 'string'
          ? album.blurPicUrl
          : '',
    publishTime: Number(album.publishTime) || 0,
    size: Number(album.size) || 0,
    artist,
    artists,
    company: typeof album.company === 'string' ? album.company : undefined,
  }
}

/** Artist snapshot for the guest library: only what the sidebar row renders. */
function normalizeArtist(artist) {
  if (
    !artist ||
    typeof artist !== 'object' ||
    !Number.isFinite(Number(artist.id))
  ) {
    throw new LocalLibraryError('Invalid artist')
  }
  // `/artist/detail` leaves picUrl and img1v1Url empty for most artists and
  // only fills cover/avatar, so fall through every available field.
  const picUrl = [artist.picUrl, artist.img1v1Url, artist.avatar, artist.cover]
    .find((value) => typeof value === 'string' && value.trim())
    ?.trim()
  return {
    id: Number(artist.id),
    name: typeof artist.name === 'string' ? artist.name : '',
    picUrl: picUrl ?? '',
    albumSize: Number(artist.albumSize) || 0,
    mvSize: Number(artist.mvSize) || 0,
  }
}

function addSubscribedArtist(artist) {
  const snapshot = normalizeArtist(artist)
  const data = load()
  const existing = data.subscribedArtists.findIndex(
    (item) => Number(item.id) === snapshot.id,
  )
  if (existing >= 0) {
    // Re-following an artist refreshes the snapshot, which backfills avatars
    // saved before the cover/avatar fallback existed.
    data.subscribedArtists[existing] = snapshot
  } else {
    data.subscribedArtists.unshift(snapshot)
  }
  persist()
  return data.subscribedArtists
}

function removeSubscribedArtist(artistId) {
  const data = load()
  data.subscribedArtists = data.subscribedArtists.filter(
    (item) => Number(item.id) !== Number(artistId),
  )
  persist()
  return data.subscribedArtists
}

/** User snapshot for the guest library: avatar, nickname, signature only. */
function normalizeUser(user) {
  if (
    !user ||
    typeof user !== 'object' ||
    !Number.isFinite(Number(user.userId))
  ) {
    throw new LocalLibraryError('Invalid user')
  }
  return {
    userId: Number(user.userId),
    nickname: typeof user.nickname === 'string' ? user.nickname : '',
    avatarUrl: typeof user.avatarUrl === 'string' ? user.avatarUrl : '',
    signature: typeof user.signature === 'string' ? user.signature : undefined,
  }
}

function addSubscribedUser(user) {
  const snapshot = normalizeUser(user)
  const data = load()
  const existing = data.subscribedUsers.findIndex(
    (item) => Number(item.userId) === snapshot.userId,
  )
  if (existing >= 0) {
    // Re-following refreshes the snapshot (nickname / avatar may have changed).
    data.subscribedUsers[existing] = snapshot
  } else {
    data.subscribedUsers.unshift(snapshot)
  }
  persist()
  return data.subscribedUsers
}

function removeSubscribedUser(userId) {
  const data = load()
  data.subscribedUsers = data.subscribedUsers.filter(
    (item) => Number(item.userId) !== Number(userId),
  )
  persist()
  return data.subscribedUsers
}

function addSubscribedAlbum(album) {
  const snapshot = normalizeAlbum(album)
  const data = load()
  if (!data.subscribedAlbums.some((item) => Number(item.id) === snapshot.id)) {
    data.subscribedAlbums.unshift(snapshot)
    persist()
  }
  return data.subscribedAlbums
}

function removeSubscribedAlbum(albumId) {
  const data = load()
  data.subscribedAlbums = data.subscribedAlbums.filter(
    (item) => Number(item.id) !== Number(albumId),
  )
  persist()
  return data.subscribedAlbums
}

function addSubscribedPlaylist(playlist) {
  const snapshot = normalizePlaylist(playlist)
  const data = load()
  const existing = data.subscribedPlaylists.findIndex(
    (item) => Number(item.id) === snapshot.id,
  )
  if (existing >= 0) {
    // Opening a previously subscribed playlist can backfill songs that were
    // saved before track snapshots were part of the guest library.
    data.subscribedPlaylists[existing] = snapshot
  } else {
    data.subscribedPlaylists.unshift(snapshot)
  }
  persist()
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
  addSubscribedAlbum,
  removeSubscribedAlbum,
  addSubscribedArtist,
  removeSubscribedArtist,
  addSubscribedUser,
  removeSubscribedUser,
  addFavorite,
  removeFavorite,
  recordRecent,
  removeRecent,
  clearRecent,
}
