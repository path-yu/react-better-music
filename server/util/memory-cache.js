class MemoryCache {
  constructor(options = {}) {
    this.cache = new Map()
    this.size = 0
    this.bytes = 0
    this.maxEntries =
      Number(options.maxEntries || process.env.QIMIAO_CACHE_MAX_ENTRIES) || 120
    this.maxBytes =
      Number(options.maxBytes || process.env.QIMIAO_CACHE_MAX_BYTES) ||
      24 * 1024 * 1024
  }

  static estimateBytes(entry) {
    const data = entry && entry.value && entry.value.data
    if (Buffer.isBuffer(data)) return data.length
    if (typeof data === 'string') return Buffer.byteLength(data) * 2
    // Small metadata-only entries still need a bounded cost.
    return 512
  }

  add(key, value, time, timeoutCallback) {
    // 移除旧的条目（如果存在）
    const old = this.cache.get(key)
    if (old) {
      clearTimeout(old.timeout)
      this.delete(key)
    }

    // 创建新的缓存条目
    const entry = {
      value,
      expire: time + Date.now(),
      timeout: setTimeout(() => {
        this.delete(key)
        if (typeof timeoutCallback === 'function') {
          timeoutCallback(value, key)
        }
      }, time),
    }
    entry.bytes = MemoryCache.estimateBytes(entry)

    this.cache.set(key, entry)
    this.size = this.cache.size
    this.bytes += entry.bytes
    this.trim()

    return entry
  }

  trim() {
    while (
      this.size > this.maxEntries ||
      (this.bytes > this.maxBytes && this.size > 1)
    ) {
      const oldest = this.cache.keys().next().value
      if (oldest === undefined) break
      this.delete(oldest)
    }
  }

  delete(key) {
    const entry = this.cache.get(key)
    if (entry) {
      clearTimeout(entry.timeout)
      this.cache.delete(key)
      this.size = this.cache.size
      this.bytes = Math.max(0, this.bytes - (entry.bytes || 0))
    }
    return null
  }

  get(key) {
    return this.cache.get(key) || null
  }

  getValue(key) {
    const entry = this.cache.get(key)
    return entry ? entry.value : undefined
  }

  clear() {
    this.cache.forEach((entry) => clearTimeout(entry.timeout))
    this.cache.clear()
    this.size = 0
    this.bytes = 0
    return true
  }

  has(key) {
    const entry = this.cache.get(key)
    if (!entry) return false

    if (Date.now() > entry.expire) {
      this.delete(key)
      return false
    }

    return true
  }
}

module.exports = MemoryCache
