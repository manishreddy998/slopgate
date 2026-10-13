import type { PackageFact } from '../types.js'
import { ageDays, asRecord, asString, fetchText, licenseName, parseJson, repoUrl, type FetchOptions } from './http.js'

const FULL_DOC_MAX_BYTES = 1_500_000
const DOWNLOADS_SKIP_OVER = 10_000

export interface RegistryRequest {
  name: string
  registry: string
  now: number
  fetch: FetchOptions
}

export async function lookupNpm(request: RegistryRequest): Promise<PackageFact> {
  const name = request.name.toLowerCase()
  const latestUrl = npmPackageUrl(request.registry, name, '/latest')
  const publicNpm = /registry\.npmjs\.org/i.test(request.registry)
  const downloadsUrl = publicNpm
    ? `https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(name)}`
    : null

  const [latest, downloads] = await Promise.all([
    fetchText(latestUrl, request.fetch),
    downloadsUrl ? fetchText(downloadsUrl, request.fetch) : Promise.resolve(null),
  ])

  if (latest.status === 404) return missing(name)
  if (latest.status !== 200 || !latest.body) return offline(name, latest.error ?? `npm registry status ${latest.status}`)

  const doc = asRecord(parseJson(latest.body))
  if (!doc) return offline(name, 'npm registry returned invalid JSON')

  const weekly = downloads ? readDownloads(downloads) : undefined
  const version = asString(doc.version) ?? ''
  let createdAt: string | undefined
  let versionCount: number | undefined
  if (weekly == null || weekly < DOWNLOADS_SKIP_OVER) {
    const full = await fetchText(npmPackageUrl(request.registry, name), {
      ...request.fetch,
      maxBytes: FULL_DOC_MAX_BYTES,
    })
    if (full.status === 200 && full.body) {
      const packument = asRecord(parseJson(full.body))
      const time = packument ? asRecord(packument.time) : null
      createdAt = time ? asString(time.created) : undefined
      const versions = packument ? asRecord(packument.versions) : null
      if (versions) versionCount = Object.keys(versions).length
    }
  }

  const scripts = asRecord(doc.scripts)
  const installScripts = scripts
    ? ['preinstall', 'install', 'postinstall'].filter((key) => Boolean(asString(scripts[key])))
    : []

  return {
    ecosystem: 'npm',
    name,
    exists: true,
    ...(createdAt ? { createdAt, ageDays: ageDays(createdAt, request.now) } : {}),
    ...(weekly !== undefined ? { weeklyDownloads: weekly } : {}),
    description: asString(doc.description) ?? null,
    repository: repoUrl(doc.repository),
    license: licenseName(doc.license),
    installScripts,
    ...(versionCount !== undefined ? { versionCount } : {}),
    ...(version ? { latestVersion: version } : {}),
    fromCache: false,
    stale: false,
    offline: false,
  }
}

export function npmPackageUrl(registry: string, name: string, suffix = ''): string {
  const base = registry.replace(/\/$/, '')
  return `${base}/${name.replace('/', '%2F')}${suffix}`
}

function readDownloads(result: { status: number; body: string | null }): number | null {
  if (result.status !== 200 || !result.body) return null
  const doc = asRecord(parseJson(result.body))
  const downloads = doc?.downloads
  return typeof downloads === 'number' && Number.isFinite(downloads) ? downloads : null
}

function missing(name: string): PackageFact {
  return {
    ecosystem: 'npm',
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
    ecosystem: 'npm',
    name,
    exists: null,
    installScripts: [],
    fromCache: false,
    stale: false,
    offline: true,
    error,
  }
}
