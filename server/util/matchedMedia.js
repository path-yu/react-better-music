/**
 * Third-party media URLs produced by the unblock matcher.
 *
 * `/audio/proxy` is deliberately limited to the NetEase CDN, so the renderer
 * cannot download a matched URL itself (the providers send no CORS headers)
 * and the offline cache could never transcode those tracks. Remembering the
 * exact URLs this server just returned keeps the proxy closed to arbitrary
 * input while still letting the cache fetch what the matcher resolved.
 *
 * Entries age out with the signed URLs themselves (~20 minutes).
 */
const TTL = 30 * 60 * 1000
const MAX_ENTRIES = 500

const entries = new Map()

function touch(url) {
  entries.delete(url)
  entries.set(url, Date.now())
  while (entries.size > MAX_ENTRIES) {
    entries.delete(entries.keys().next().value)
  }
}

function remember(url) {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return
  touch(url)
  // The renderer upgrades plain-http media URLs before handing them to the
  // WebView, so the https form has to be accepted as well.
  if (/^http:\/\//i.test(url)) touch(url.replace(/^http:\/\//i, 'https://'))
}

function has(url) {
  const at = entries.get(url)
  if (!at) return false
  if (Date.now() - at > TTL) {
    entries.delete(url)
    return false
  }
  return true
}

module.exports = { remember, has }
