import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DiskCache, MemoryCache } from '../src/cache.js'
import { ConfigError, DEFAULT_CONFIG, loadConfig } from '../src/config.js'
import { encodeGoModule, goModuleCandidates } from '../src/registry/go.js'
import { lookupPackage } from '../src/registry/lookup.js'

const NOW = Date.parse('2026-10-13T00:00:00Z')

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function mockFetch(handler: (url: string) => Response | 'throw'): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0]) => {
    const result = handler(String(input))
    if (result === 'throw') throw new Error('network down')
    return result
  }) as typeof fetch
}

describe('lookupPackage', () => {
  it('reports a confirmed npm miss without treating a transport error as a miss', async () => {
    const missing = await lookupPackage(
      'npm',
      'React-CodeShift-No-Such',
      {
        config: DEFAULT_CONFIG,
        now: () => NOW,
        fetchImpl: mockFetch((url) => (url.endsWith('/latest') ? jsonResponse(404, {}) : jsonResponse(404, {}))),
      },
    )
    expect(missing.exists).toBe(false)
    expect(missing.name).toBe('react-codeshift-no-such')

    const offline = await lookupPackage('npm', 'left-pad', {
      config: DEFAULT_CONFIG,
      now: () => NOW,
      fetchImpl: mockFetch(() => 'throw'),
    })
    expect(offline.exists).toBeNull()
    expect(offline.offline).toBe(true)
  })

  it('reads npm age, downloads, repo, and install scripts, and skips the fat manifest when downloads are high', async () => {
    const calls: string[] = []
    const fetchImpl = mockFetch((url) => {
      calls.push(url)
      if (url.endsWith('/react-codeshift/latest')) {
        return jsonResponse(200, {
          version: '1.0.0',
          description: 'Placeholder to prevent dependency confusion.',
          license: 'ISC',
          scripts: { preinstall: 'node evil.js' },
        })
      }
      if (url.includes('/downloads/point/last-week/react-codeshift')) return jsonResponse(200, { downloads: 0 })
      if (url.endsWith('/react-codeshift')) {
        return jsonResponse(200, {
          time: { created: '2026-01-14T21:02:51.762Z', modified: '2026-01-14T21:02:52.176Z' },
          versions: { '1.0.0': {} },
        })
      }
      if (url.endsWith('/react/latest')) {
        return jsonResponse(200, {
          version: '19.0.0',
          description: 'React',
          license: 'MIT',
          repository: { type: 'git', url: 'git+https://github.com/facebook/react.git' },
          scripts: { test: 'jest' },
        })
      }
      if (url.includes('/downloads/point/last-week/react')) return jsonResponse(200, { downloads: 20_000_000 })
      throw new Error(`unexpected ${url}`)
    })

    const suspicious = await lookupPackage('npm', 'react-codeshift', {
      config: DEFAULT_CONFIG,
      now: () => NOW,
      fetchImpl,
    })
    expect(suspicious.exists).toBe(true)
    expect(suspicious.weeklyDownloads).toBe(0)
    expect(suspicious.versionCount).toBe(1)
    expect(suspicious.repository).toBeNull()
    expect(suspicious.installScripts).toEqual(['preinstall'])
    expect(suspicious.ageDays).toBeGreaterThan(200)

    calls.length = 0
    const popular = await lookupPackage('npm', 'react', {
      config: DEFAULT_CONFIG,
      now: () => NOW,
      fetchImpl,
    })
    expect(popular.weeklyDownloads).toBe(20_000_000)
    expect(popular.repository).toContain('github.com/facebook/react')
    expect(popular.installScripts).toEqual([])
    expect(popular.versionCount).toBeUndefined()
    expect(calls.includes('https://registry.npmjs.org/react')).toBe(false)
  })

  it('serves fresh cache hits and falls back to a stale hit when the registry is down', async () => {
    const cache = new MemoryCache()
    let online = true
    const fetchImpl = mockFetch((url) => {
      if (!online) return 'throw'
      if (url.endsWith('/left-pad/latest')) {
        return jsonResponse(200, { version: '1.3.0', description: 'pad', license: 'WTFPL', repository: 'git://github.com/stevemao/left-pad' })
      }
      if (url.includes('downloads')) return jsonResponse(200, { downloads: 50_000 })
      return jsonResponse(404, {})
    })
    let now = NOW
    const first = await lookupPackage('npm', 'left-pad', {
      config: { ...DEFAULT_CONFIG, cacheTtlHours: 1 },
      cache,
      now: () => now,
      fetchImpl,
    })
    expect(first.fromCache).toBe(false)
    const second = await lookupPackage('npm', 'left-pad', {
      config: { ...DEFAULT_CONFIG, cacheTtlHours: 1 },
      cache,
      now: () => now,
      fetchImpl: mockFetch(() => 'throw'),
    })
    expect(second.fromCache).toBe(true)
    expect(second.offline).toBe(false)

    now += 2 * 60 * 60 * 1000
    online = false
    const stale = await lookupPackage('npm', 'left-pad', {
      config: { ...DEFAULT_CONFIG, cacheTtlHours: 1 },
      cache,
      now: () => now,
      fetchImpl,
    })
    expect(stale.stale).toBe(true)
    expect(stale.exists).toBe(true)
    expect(stale.description).toBe('pad')
  })

  it('reads PyPI, crates.io, and the Go module proxy', async () => {
    const fetchImpl = mockFetch((url) => {
      if (url.includes('/pypi/nope/json')) return jsonResponse(404, { message: 'Not Found' })
      if (url.includes('/pypi/requests/json')) {
        return jsonResponse(200, {
          info: {
            version: '2.32.0',
            summary: 'HTTP for Humans',
            license: 'Apache-2.0',
            project_urls: { Source: 'https://github.com/psf/requests' },
          },
          releases: {
            '0.0.1': [{ upload_time_iso_8601: '2011-02-14T00:00:00Z' }],
            '2.32.0': [{ upload_time_iso_8601: '2024-05-01T00:00:00Z' }],
          },
        })
      }
      if (url.includes('pypistats.org')) return jsonResponse(200, { data: { last_week: 1000 } })
      if (url.includes('/api/v1/crates/missing-crate')) return jsonResponse(404, {})
      if (url.includes('/api/v1/crates/serde')) {
        return jsonResponse(200, {
          crate: {
            name: 'serde',
            created_at: '2014-12-05T20:20:39Z',
            downloads: 1_000_000,
            recent_downloads: 50_000,
            description: 'serialization',
            repository: 'https://github.com/serde-rs/serde',
            num_versions: 10,
            newest_version: '1.0.0',
          },
        })
      }
      if (url.includes('@v/list')) return new Response('v1.0.0\nv1.1.0\n', { status: 200 })
      if (url.endsWith('@latest')) {
        if (url.includes('/cmd/')) return jsonResponse(404, {})
        return jsonResponse(200, {
          Version: 'v1.1.0',
          Time: '2020-01-01T00:00:00Z',
          Origin: { URL: 'https://github.com/gin-gonic/gin' },
        })
      }
      throw new Error(`unexpected ${url}`)
    })

    const missing = await lookupPackage('pypi', 'Nope', { config: DEFAULT_CONFIG, now: () => NOW, fetchImpl })
    expect(missing.exists).toBe(false)
    expect(missing.name).toBe('nope')

    const requests = await lookupPackage('pypi', 'Requests', { config: DEFAULT_CONFIG, now: () => NOW, fetchImpl })
    expect(requests.exists).toBe(true)
    expect(requests.name).toBe('requests')
    expect(requests.weeklyDownloads).toBe(1000)
    expect(requests.repository).toContain('github.com/psf/requests')
    expect(requests.createdAt).toBe('2011-02-14T00:00:00Z')

    const serde = await lookupPackage('cargo', 'serde', { config: DEFAULT_CONFIG, now: () => NOW, fetchImpl })
    expect(serde.totalDownloads).toBe(1_000_000)
    expect(serde.recentDownloads).toBe(50_000)
    expect(serde.license).toBeUndefined()

    const gone = await lookupPackage('cargo', 'missing-crate', { config: DEFAULT_CONFIG, now: () => NOW, fetchImpl })
    expect(gone.exists).toBe(false)

    const nested = await lookupPackage('go', 'github.com/gin-gonic/gin/cmd/foo', {
      config: DEFAULT_CONFIG,
      now: () => NOW,
      fetchImpl,
    })
    expect(nested.exists).toBe(true)
    expect(nested.repository).toBe('https://github.com/gin-gonic/gin')
    expect(nested.versionCount).toBe(2)
    expect(nested.ageDays).toBeUndefined()
  })
})

describe('go module paths', () => {
  it('escapes uppercase segments and walks toward the module root', () => {
    expect(encodeGoModule('github.com/Azure/go-autorest')).toBe('github.com/!azure/go-autorest')
    expect(goModuleCandidates('github.com/gin-gonic/gin/cmd/foo')).toEqual([
      'github.com/gin-gonic/gin/cmd/foo',
      'github.com/gin-gonic/gin/cmd',
      'github.com/gin-gonic/gin',
      'github.com/gin-gonic',
    ])
  })
})

describe('cache and config', () => {
  it('round-trips the disk cache and ignores a corrupt file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'slopgate-cache-'))
    const file = join(dir, 'cache.json')
    writeFileSync(file, '{not json')
    const cache = new DiskCache(file)
    expect(cache.get('npm:react', NOW)).toBeNull()
    cache.set(
      'npm:react',
      {
        ecosystem: 'npm',
        name: 'react',
        exists: true,
        installScripts: [],
        fromCache: false,
        stale: false,
        offline: false,
      },
      1000,
      NOW,
    )
    const again = new DiskCache(file)
    expect(again.get('npm:react', NOW)?.fact.exists).toBe(true)
    expect(again.get('npm:react', NOW + 5000)?.stale).toBe(true)
  })

  it('merges project and explicit config, and can ignore the project file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'slopgate-cfg-'))
    writeFileSync(
      join(dir, 'slopgate.config.json'),
      JSON.stringify({
        allow: ['left-pad'],
        warnScore: 10,
        registries: { npm: 'https://npm.example.com' },
      }),
    )
    const userDir = mkdtempSync(join(tmpdir(), 'slopgate-user-'))
    const userFile = join(userDir, 'config.json')
    writeFileSync(userFile, JSON.stringify({ allow: ['@private/tool'], offline: 'block' }))
    const viaEnv = loadConfig(dir, { SLOPGATE_CONFIG: userFile })
    expect(viaEnv.allow).toEqual(['left-pad', '@private/tool'])
    expect(viaEnv.offline).toBe('block')
    expect(viaEnv.warnScore).toBe(10)
    expect(viaEnv.registries.npm).toBe('https://npm.example.com')
    expect(viaEnv.blockScore).toBe(DEFAULT_CONFIG.blockScore)

    const pkgDir = mkdtempSync(join(tmpdir(), 'slopgate-pkg-'))
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: 'app', slopgate: { blockScore: 70 } }))
    expect(loadConfig(pkgDir, { SLOPGATE_IGNORE_PROJECT_CONFIG: '1' }).blockScore).toBe(DEFAULT_CONFIG.blockScore)
    expect(loadConfig(pkgDir, {}).blockScore).toBe(70)

    const broken = join(pkgDir, 'broken.json')
    writeFileSync(broken, '{')
    expect(() => loadConfig(pkgDir, { SLOPGATE_CONFIG: broken })).toThrow(ConfigError)
  })
})
