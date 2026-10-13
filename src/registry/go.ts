import type { PackageFact } from '../types.js'
import { ageDays, asRecord, asString, fetchText, parseJson, type FetchOptions } from './http.js'

export interface RegistryRequest {
  name: string
  registry: string
  now: number
  fetch: FetchOptions
}

export function goModuleCandidates(spec: string): string[] {
  const parts = spec.split('/').filter(Boolean)
  const out: string[] = []
  for (let length = parts.length; length >= 2 && out.length < 4; length--) {
    out.push(parts.slice(0, length).join('/'))
  }
  return out.length > 0 ? out : [spec]
}

export function encodeGoModule(mod: string): string {
  return mod
    .split('/')
    .map((segment) => {
      let escaped = ''
      for (const char of segment) {
        escaped += char >= 'A' && char <= 'Z' ? `!${char.toLowerCase()}` : char
      }
      return encodeURIComponent(escaped)
    })
    .join('/')
}

export async function lookupGo(request: RegistryRequest): Promise<PackageFact> {
  let lastMissing: PackageFact | null = null
  for (const candidate of goModuleCandidates(request.name)) {
    const fact = await fetchModule(candidate, request)
    if (fact.exists === true) return { ...fact, name: request.name }
    if (fact.exists === null) return { ...fact, name: request.name }
    lastMissing = fact
  }
  return lastMissing ? { ...lastMissing, name: request.name } : missing(request.name)
}

async function fetchModule(name: string, request: RegistryRequest): Promise<PackageFact> {
  const base = request.registry.replace(/\/$/, '')
  const encoded = encodeGoModule(name)
  const [latest, list] = await Promise.all([
    fetchText(`${base}/${encoded}/@latest`, request.fetch),
    fetchText(`${base}/${encoded}/@v/list`, request.fetch),
  ])
  if (latest.status === 404 || latest.status === 410) return missing(name)
  if (latest.status !== 200 || !latest.body) return offline(name, latest.error ?? `Go proxy status ${latest.status}`)
  const doc = asRecord(parseJson(latest.body))
  if (!doc) return offline(name, 'Go proxy returned invalid JSON')

  const listOk = list.status === 200 && list.body !== null
  const versions = listOk
    ? list.body!
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
    : []
  const versionCount = listOk ? Math.max(versions.length, 1) : undefined
  const published = asString(doc.Time)
  const origin = asRecord(doc.Origin)
  const repository = origin ? (asString(origin.URL) ?? null) : null
  const useAge = versionCount !== undefined && versionCount <= 1 && published

  return {
    ecosystem: 'go',
    name,
    exists: true,
    ...(useAge && published ? { createdAt: published, ageDays: ageDays(published, request.now) } : {}),
    repository,
    installScripts: [],
    ...(versionCount !== undefined ? { versionCount } : {}),
    ...(asString(doc.Version) ? { latestVersion: asString(doc.Version) } : {}),
    fromCache: false,
    stale: false,
    offline: false,
  }
}

function missing(name: string): PackageFact {
  return {
    ecosystem: 'go',
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
    ecosystem: 'go',
    name,
    exists: null,
    installScripts: [],
    fromCache: false,
    stale: false,
    offline: true,
    error,
  }
}
