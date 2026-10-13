import { normalizePypi } from '../parse/command.js'
import type { PackageFact } from '../types.js'
import { ageDays, asRecord, asString, fetchText, licenseName, parseJson, type FetchOptions } from './http.js'

const MAX_BYTES = 3_000_000

export interface RegistryRequest {
  name: string
  registry: string
  now: number
  fetch: FetchOptions
}

export async function lookupPypi(request: RegistryRequest): Promise<PackageFact> {
  const name = normalizePypi(request.name)
  const base = request.registry.replace(/\/$/, '')
  const publicPypi = /pypi\.org/i.test(request.registry)
  const [docRes, statsRes] = await Promise.all([
    fetchText(`${base}/pypi/${encodeURIComponent(name)}/json`, { ...request.fetch, maxBytes: MAX_BYTES }),
    publicPypi
      ? fetchText(`https://pypistats.org/api/packages/${encodeURIComponent(name)}/recent`, request.fetch)
      : Promise.resolve(null),
  ])

  if (docRes.status === 404) return missing(name)
  if (docRes.tooBig) {
    return {
      ecosystem: 'pypi',
      name,
      exists: true,
      ...(statsRes ? { weeklyDownloads: readWeekly(statsRes) } : {}),
      installScripts: [],
      fromCache: false,
      stale: false,
      offline: false,
      error: 'PyPI metadata was too large to inspect fully',
    }
  }
  if (docRes.status !== 200 || !docRes.body) return offline(name, docRes.error ?? `PyPI status ${docRes.status}`)
  const doc = asRecord(parseJson(docRes.body))
  const info = doc ? asRecord(doc.info) : null
  if (!info) return offline(name, 'PyPI returned invalid JSON')

  const releases = asRecord(doc?.releases)
  const createdAt = releases ? earliestUpload(releases) : undefined
  const versionCount = releases ? Object.keys(releases).length : undefined
  const projectUrls = asRecord(info.project_urls)
  const repository = projectRepository(projectUrls) ?? asString(info.home_page) ?? null

  return {
    ecosystem: 'pypi',
    name,
    exists: true,
    ...(createdAt ? { createdAt, ageDays: ageDays(createdAt, request.now) } : {}),
    ...(statsRes ? { weeklyDownloads: readWeekly(statsRes) } : {}),
    description: asString(info.summary) ?? null,
    repository,
    license: licenseName(info.license_expression) ?? licenseName(info.license),
    installScripts: [],
    ...(versionCount !== undefined ? { versionCount } : {}),
    ...(asString(info.version) ? { latestVersion: asString(info.version) } : {}),
    fromCache: false,
    stale: false,
    offline: false,
  }
}

function projectRepository(urls: Record<string, unknown> | null): string | null {
  if (!urls) return null
  const preferred = Object.entries(urls).sort(([a], [b]) => rankUrlKey(a) - rankUrlKey(b))
  for (const [, value] of preferred) {
    const url = asString(value)
    if (url) return url
  }
  return null
}

function rankUrlKey(key: string): number {
  if (/source|repo/i.test(key)) return 0
  if (/home/i.test(key)) return 1
  return 2
}

function earliestUpload(releases: Record<string, unknown>): string | undefined {
  let earliest: string | undefined
  let earliestMs = Number.POSITIVE_INFINITY
  for (const files of Object.values(releases)) {
    if (!Array.isArray(files)) continue
    for (const file of files) {
      const record = asRecord(file)
      const iso = record ? asString(record.upload_time_iso_8601) : undefined
      if (!iso) continue
      const time = Date.parse(iso)
      if (!Number.isNaN(time) && time < earliestMs) {
        earliestMs = time
        earliest = iso
      }
    }
  }
  return earliest
}

function readWeekly(result: { status: number; body: string | null }): number | null {
  if (result.status !== 200 || !result.body) return null
  const doc = asRecord(parseJson(result.body))
  const data = doc ? asRecord(doc.data) : null
  const weekly = data?.last_week
  return typeof weekly === 'number' && Number.isFinite(weekly) ? weekly : null
}

function missing(name: string): PackageFact {
  return {
    ecosystem: 'pypi',
    name,
    exists: false,
    installScripts: [],
    fromCache: false,
    stale: false,
    offline: false,
  }
}

function offline(name: string, error: string): PackageFact {
  return {
    ecosystem: 'pypi',
    name,
    exists: null,
    installScripts: [],
    fromCache: false,
    stale: false,
    offline: true,
    error,
  }
}
