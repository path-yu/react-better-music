const API_BASE = (import.meta.env.VITE_API_BASE || '/api').replace(/\/$/, '')

type Query = Record<string, string | number | boolean | undefined | null>

function buildQuery(params?: Query) {
  if (!params) return ''
  const search = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return
    search.append(key, String(value))
  })
  const query = search.toString()
  return query ? `?${query}` : ''
}

function buildUrl(path: string, params?: Query) {
  const normalized = path.startsWith('/') ? path : `/${path}`
  return `${API_BASE}${normalized}${buildQuery(params)}`
}

export function apiUrl(path: string, params?: Query) {
  return buildUrl(path, params)
}

export class ApiError extends Error {
  status: number
  payload: unknown

  constructor(message: string, status: number, payload: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.payload = payload
  }
}

async function parse<T>(response: Response): Promise<T> {
  const text = await response.text()
  let payload: unknown = text
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    // keep raw text
  }
  if (!response.ok) {
    const message =
      (payload as { message?: string; msg?: string })?.message ??
      (payload as { msg?: string })?.msg ??
      `请求失败 (${response.status})`
    throw new ApiError(message, response.status, payload)
  }
  return payload as T
}

export function get<T>(path: string, params?: Query, signal?: AbortSignal) {
  return fetch(buildUrl(path, params), {
    method: 'GET',
    credentials: 'include',
    signal,
  }).then((response) => parse<T>(response))
}

export function post<T>(path: string, body?: BodyInit | null, params?: Query, signal?: AbortSignal) {
  return fetch(buildUrl(path, params), {
    method: 'POST',
    credentials: 'include',
    body,
    signal,
  }).then((response) => parse<T>(response))
}

export function postForm<T>(path: string, params: Query, signal?: AbortSignal) {
  const body = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null) return
    body.append(key, String(value))
  })
  return fetch(`${API_BASE}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal,
  }).then((response) => parse<T>(response))
}

export function uploadFile<T>(path: string, file: File, params?: Query) {
  const formData = new FormData()
  formData.append('imgFile', file)
  return fetch(buildUrl(path, params), {
    method: 'POST',
    credentials: 'include',
    body: formData,
  }).then((response) => parse<T>(response))
}
