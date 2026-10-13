import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { PackageFact } from './types.js'

interface CacheEntry {
  savedAt: number
  ttlMs: number
  fact: PackageFact
}

interface CacheFile {
  version: 1
  entries: Record<string, CacheEntry>
}

export interface CacheHit {
  fact: PackageFact
  stale: boolean
}

export interface CacheStore {
  get(key: string, now: number): CacheHit | null
  set(key: string, fact: PackageFact, ttlMs: number, now: number): void
}

export class MemoryCache implements CacheStore {
  private readonly entries = new Map<string, CacheEntry>()

  get(key: string, now: number): CacheHit | null {
    const entry = this.entries.get(key)
    if (!entry) return null
    return { fact: entry.fact, stale: now - entry.savedAt > entry.ttlMs }
  }

  set(key: string, fact: PackageFact, ttlMs: number, now: number): void {
    this.entries.set(key, { savedAt: now, ttlMs, fact: { ...fact, fromCache: false, stale: false } })
  }
}

export class DiskCache implements CacheStore {
  private entries: Record<string, CacheEntry> = {}
  private loaded = false

  constructor(private readonly file: string) {}

  get(key: string, now: number): CacheHit | null {
    this.load()
    const entry = this.entries[key]
    if (!entry) return null
    return { fact: entry.fact, stale: now - entry.savedAt > entry.ttlMs }
  }

  set(key: string, fact: PackageFact, ttlMs: number, now: number): void {
    this.load()
    this.entries[key] = { savedAt: now, ttlMs, fact: { ...fact, fromCache: false, stale: false } }
    this.save()
  }

  private load(): void {
    if (this.loaded) return
    this.loaded = true
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<CacheFile>
      if (parsed.version === 1 && parsed.entries && typeof parsed.entries === 'object') {
        this.entries = parsed.entries
      }
    } catch {
      this.entries = {}
    }
  }

  private save(): void {
    const payload: CacheFile = { version: 1, entries: this.entries }
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(payload))
    renameSync(tmp, this.file)
  }
}

export function defaultCachePath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.SLOPGATE_CACHE) return env.SLOPGATE_CACHE
  const base = env.XDG_CACHE_HOME || join(homedir(), '.cache')
  return join(base, 'slopgate', 'cache.json')
}

export function cacheKey(ecosystem: string, name: string): string {
  return `${ecosystem}:${name}`
}
