export interface FetchResult {
  status: number
  body: string | null
  error?: string
  tooBig?: boolean
}

export interface FetchOptions {
  fetchImpl?: typeof fetch
  headers?: Record<string, string>
  timeoutMs?: number
  maxBytes?: number
  userAgent: string
}

export async function fetchText(url: string, options: FetchOptions): Promise<FetchResult> {
  if (!/^https?:\/\//i.test(url)) {
    return { status: 0, body: null, error: `Refusing non-http URL ${url}` }
  }
  const fetchImpl = options.fetchImpl ?? fetch
  try {
    const response = await fetchImpl(url, {
      headers: {
        accept: 'application/json',
        'user-agent': options.userAgent,
        ...options.headers,
      },
      signal: AbortSignal.timeout(options.timeoutMs ?? 4000),
      redirect: 'follow',
    })
    const declared = Number(response.headers.get('content-length') ?? 0)
    if (options.maxBytes && declared > options.maxBytes) {
      await response.body?.cancel()
      return { status: response.status, body: null, tooBig: true }
    }
    const body = await response.text()
    if (options.maxBytes && body.length > options.maxBytes) {
      return { status: response.status, body: null, tooBig: true }
    }
    return { status: response.status, body }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { status: 0, body: null, error: message }
  }
}

export function parseJson(body: string | null): unknown {
  if (!body) return undefined
  try {
    return JSON.parse(body) as unknown
  } catch {
    return undefined
  }
}

export function ageDays(iso: string | undefined, now: number): number | undefined {
  if (!iso) return undefined
  const time = Date.parse(iso)
  if (Number.isNaN(time)) return undefined
  return Math.max(0, (now - time) / 86_400_000)
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function repoUrl(value: unknown): string | null {
  if (typeof value === 'string') return cleanRepo(value)
  const record = asRecord(value)
  const url = record ? asString(record.url) : undefined
  return url ? cleanRepo(url) : null
}

function cleanRepo(url: string): string {
  return url.replace(/^git\+/, '').replace(/\.git$/, '')
}

export function licenseName(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed || /^unknown$/i.test(trimmed) || trimmed === 'NOASSERTION') return null
    return trimmed
  }
  const record = asRecord(value)
  return record ? licenseName(record.type) : null
}
