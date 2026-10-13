import { version } from '../version.js'
import type { CacheStore } from '../cache.js'
import { cacheKey } from '../cache.js'
import { DEFAULT_REGISTRIES } from '../config.js'
import type { Ecosystem, PackageFact, SlopgateConfig } from '../types.js'
import type { FetchOptions } from './http.js'
import { lookupCrates } from './crates.js'
import { lookupGo } from './go.js'
import { lookupNpm } from './npm.js'
import { lookupPypi } from './pypi.js'

export interface LookupContext {
  config: SlopgateConfig
  cache?: CacheStore
  fetchImpl?: typeof fetch
  now?: () => number
}

export function userAgent(): string {
  return `slopgate/${version} (+https://github.com/manishreddy998/slopgate)`
}

export async function lookupPackage(
  ecosystem: Ecosystem,
  name: string,
  ctx: LookupContext,
): Promise<PackageFact> {
  const now = (ctx.now ?? Date.now)()
  const key = cacheKey(ecosystem, cacheName(ecosystem, name))
  const hit = ctx.cache?.get(key, now)
  if (hit && !hit.stale) {
    return { ...hit.fact, fromCache: true, stale: false, offline: false }
  }

  const fetchOptions: FetchOptions = { userAgent: userAgent(), ...(ctx.fetchImpl ? { fetchImpl: ctx.fetchImpl } : {}) }
  const fact = await dispatch(ecosystem, name, ctx.config, now, fetchOptions)
  if (fact.exists === null && hit) {
    return { ...hit.fact, fromCache: true, stale: true, offline: true, error: fact.error }
  }
  if (fact.exists !== null && ctx.cache) {
    const ttlMs =
      fact.exists === true
        ? ctx.config.cacheTtlHours * 60 * 60 * 1000
        : ctx.config.missingTtlMinutes * 60 * 1000
    ctx.cache.set(key, fact, ttlMs, now)
  }
  return fact
}

async function dispatch(
  ecosystem: Ecosystem,
  name: string,
  config: SlopgateConfig,
  now: number,
  fetchOptions: FetchOptions,
): Promise<PackageFact> {
  const request = {
    name,
    now,
    fetch: fetchOptions,
    registry: registryFor(ecosystem, config),
  }
  switch (ecosystem) {
    case 'npm':
      return lookupNpm(request)
    case 'pypi':
      return lookupPypi(request)
    case 'cargo':
      return lookupCrates(request)
    case 'go':
      return lookupGo(request)
  }
}

function registryFor(ecosystem: Ecosystem, config: SlopgateConfig): string {
  switch (ecosystem) {
    case 'npm':
      return config.registries.npm || DEFAULT_REGISTRIES.npm
    case 'pypi':
      return config.registries.pypi || DEFAULT_REGISTRIES.pypi
    case 'cargo':
      return config.registries.crates || DEFAULT_REGISTRIES.crates
    case 'go':
      return config.registries.go || DEFAULT_REGISTRIES.go
  }
}

function cacheName(ecosystem: Ecosystem, name: string): string {
  if (ecosystem === 'npm' || ecosystem === 'cargo') return name.toLowerCase()
  if (ecosystem === 'pypi') return name.toLowerCase().replace(/[-_.]+/g, '-')
  return name
}
