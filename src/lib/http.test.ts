import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearApiCache, get, invalidateApiCache } from './http'

const calls: string[] = []
let bannerDelay = 0

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function requestPath(input: RequestInfo | URL) {
  const url = new URL(String(input), 'http://test.local')
  return { path: url.pathname.replace(/^\/api/, ''), url }
}

function installFetchMock() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const { path, url } = requestPath(input)
      calls.push(`${path}${url.search}`)

      if (path === '/banner') {
        await new Promise((resolve) => setTimeout(resolve, bannerDelay))
      }
      if (path === '/cloudsearch') {
        return new Promise<Response>((resolve, reject) => {
          const signal = init?.signal
          const onAbort = () => reject(new DOMException('Aborted', 'AbortError'))
          if (signal?.aborted) return onAbort()
          signal?.addEventListener('abort', onAbort, { once: true })
          setTimeout(() => {
            signal?.removeEventListener('abort', onAbort)
            resolve(json({ code: 200, result: {} }))
          }, 50)
        })
      }
      if (path === '/personalized' && url.searchParams.get('limit') === '99') {
        return json({ code: 400, msg: 'bad' })
      }
      return json({ code: 200, path })
    }),
  )
}

function count(path: string, query?: string) {
  return calls.filter(
    (call) => call.split('?')[0] === path && (!query || call.includes(query)),
  ).length
}

beforeEach(() => {
  calls.length = 0
  bannerDelay = 0
  clearApiCache()
  vi.stubGlobal('window', globalThis)
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  })
  installFetchMock()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('read cache', () => {
  it('merges concurrent identical reads and serves the cached result', async () => {
    const [a, b] = await Promise.all([
      get<{ path: string }>('/personalized', { limit: 15 }),
      get<{ path: string }>('/personalized', { limit: 15 }),
    ])
    expect(a.path).toBe('/personalized')
    expect(b.path).toBe('/personalized')
    expect(count('/personalized')).toBe(1)

    await get('/personalized', { limit: 15 })
    expect(count('/personalized')).toBe(1)
  })

  it('ignores timestamps and parameter order in the cache key', async () => {
    await get('/playlist/detail', { id: 7, timestamp: 1 })
    await get('/playlist/detail', { timestamp: 2, id: 7 })
    expect(count('/playlist/detail')).toBe(1)
  })

  it('does not cache failed payloads', async () => {
    const first = await get<{ code: number }>('/personalized', { limit: 99 })
    const second = await get<{ code: number }>('/personalized', { limit: 99 })
    expect(first.code).toBe(400)
    expect(second.code).toBe(400)
    expect(count('/personalized', 'limit=99')).toBe(2)
  })

  it('invalidates only the requested prefixes', async () => {
    await get('/playlist/detail', { id: 7 })
    await get('/banner')
    expect(count('/playlist/detail')).toBe(1)
    expect(count('/banner')).toBe(1)

    invalidateApiCache(['/playlist/detail'])
    await get('/playlist/detail', { id: 7 })
    await get('/banner')
    expect(count('/playlist/detail')).toBe(2)
    expect(count('/banner')).toBe(1)
  })

  it('does not write back results that started before clearApiCache', async () => {
    const pending = get('/mv/all', { limit: 10 })
    clearApiCache()
    await pending
    await get('/mv/all', { limit: 10 })
    expect(count('/mv/all')).toBe(2)
  })
})

describe('request cancellation', () => {
  it('keeps warming the shared request when one caller aborts', async () => {
    bannerDelay = 80
    const controller = new AbortController()
    const aborted = get('/banner', undefined, controller.signal)
    const shared = get<{ path: string }>('/banner')
    controller.abort()

    await expect(aborted).rejects.toMatchObject({ name: 'AbortError' })
    await expect(shared).resolves.toMatchObject({ path: '/banner' })
    expect(count('/banner')).toBe(1)

    const cachedController = new AbortController()
    cachedController.abort()
    await expect(
      get('/banner', undefined, cachedController.signal),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(count('/banner')).toBe(1)
  })

  it('does not merge search requests and forwards aborts to fetch', async () => {
    const controller = new AbortController()
    const first = get('/cloudsearch', { keywords: 'a' }, controller.signal)
    const second = get<{ code: number }>('/cloudsearch', { keywords: 'a' })
    setTimeout(() => controller.abort(), 10)

    await expect(first).rejects.toMatchObject({ name: 'AbortError' })
    await expect(second).resolves.toMatchObject({ code: 200 })
    expect(count('/cloudsearch')).toBe(2)
  })
})
