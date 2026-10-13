import type { PackageFact } from '../types.js'
import { ageDays, asRecord, asString, fetchText, parseJson, type FetchOptions } from './http.js'

export interface RegistryRequest {
  name: string
  registry: string
  now: number
  fetch: FetchOptions
}

export async function lookupCrates(request: RegistryRequest): Promise<PackageFact> {
  const name = request.name.toLowerCase()
  const base = request.registry.replace(/\/$/, '')
  const response = await fetchText(`${base}/api/v1/crates/${encodeURIComponent(name)}`, request.fetch)
  if (response.status === 404) return missing(name)
  if (response.status !== 200 || !response.body) {
    return offline(name, response.error ?? `crates.io status ${response.status}`)
  }
  const doc = asRecord(parseJson(response.body))
  const crate = doc ? asRecord(doc.crate) : null
  if (!crate) return offline(name, 'crates.io returned invalid JSON')

  const createdAt = asString(crate.created_at)
  const recent = numberOrNull(crate.recent_downloads)
  const total = numberOrNull(crate.downloads)
  const versionCount = numberOrNull(crate.num_versions)

  return {
    ecosystem: 'cargo',
    name: asString(crate.name) ?? name,
    exists: true,
    ...(createdAt ? { createdAt, ageDays: ageDays(createdAt, request.now) } : {}),
    ...(recent !== null ? { recentDownloads: recent } : {}),
    ...(total !== null ? { totalDownloads: total } : {}),
    description: asString(crate.description) ?? null,
    repository: asString(crate.repository) ?? asString(crate.homepage) ?? null,
    installScripts: [],
    ...(versionCount !== null ? { versionCount } : {}),
    ...(asString(crate.newest_version) ? { latestVersion: asString(crate.newest_version) } : {}),
    fromCache: false,
    stale: false,
    offline: false,
  }
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function missing(name: string): PackageFact {
  return {
    ecosystem: 'cargo',
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
    ecosystem: 'cargo',
    name,
    exists: null,
    installScripts: [],
    fromCache: false,
    stale: false,
    offline: true,
    error,
  }
}
