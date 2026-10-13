import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../src/config.js'
import { evaluateCommand } from '../src/evaluate.js'
import { damerau } from '../src/risk/distance.js'
import { scorePackage } from '../src/risk/score.js'
import { analyzeName } from '../src/risk/typo.js'
import type { PackageFact } from '../src/types.js'

function fact(partial: Partial<PackageFact> & Pick<PackageFact, 'name' | 'exists'>): PackageFact {
  return {
    ecosystem: 'npm',
    installScripts: [],
    fromCache: false,
    stale: false,
    offline: partial.exists === null,
    ...partial,
  }
}

describe('damerau', () => {
  it('counts a transposition as one edit and gives up past the cap', () => {
    expect(damerau('react', 'react')).toBe(0)
    expect(damerau('react', 'recat')).toBe(1)
    expect(damerau('axios', 'axois')).toBe(1)
    expect(damerau('react', 'preact')).toBe(1)
    expect(damerau('react', 'react-dom', 2)).toBe(3)
  })
})

describe('analyzeName', () => {
  it('does not call a popular package a typo of its neighbor', () => {
    expect(analyzeName('npm', 'preact', 2).popular).toBe(true)
    expect(analyzeName('npm', 'react', 2).strong).toEqual([])
  })

  it('finds edits, homoglyphs, separators, and the react-codeshift blend', () => {
    expect(analyzeName('npm', 'recat', 2).strong[0]?.name).toBe('react')
    expect(analyzeName('npm', 'l0dash', 2).strong[0]?.name).toBe('lodash')
    expect(analyzeName('npm', 'react_dom', 2).strong.map((item) => item.name)).toContain('react-dom')
    const blend = analyzeName('npm', 'react-codeshift', 2)
    expect(blend.strong).toEqual([])
    expect(blend.weak.map((item) => item.name)).toEqual(expect.arrayContaining(['jscodeshift', 'react-codemod']))
    expect(analyzeName('go', 'github.com/gin-gonic/gn', 2).strong[0]?.name).toBe('github.com/gin-gonic/gin')
  })
})

describe('scorePackage', () => {
  it('blocks a confirmed miss and allows a known package', () => {
    const missing = scorePackage({
      ecosystem: 'npm',
      name: 'recat',
      config: DEFAULT_CONFIG,
      fact: fact({ name: 'recat', exists: false }),
    })
    expect(missing.verdict).toBe('block')
    expect(missing.score).toBe(100)
    expect(missing.suggestions[0]?.name).toBe('react')

    const react = scorePackage({
      ecosystem: 'npm',
      name: 'react',
      config: DEFAULT_CONFIG,
      fact: fact({
        name: 'react',
        exists: true,
        weeklyDownloads: 20_000_000,
        description: 'React',
        repository: 'https://github.com/facebook/react',
        license: 'MIT',
        versionCount: 100,
        ageDays: 4000,
      }),
    })
    expect(react.verdict).toBe('allow')
    expect(react.score).toBe(0)
  })

  it('blocks the react-codeshift placeholder on low use, missing repo, and its own description', () => {
    const result = scorePackage({
      ecosystem: 'npm',
      name: 'react-codeshift',
      config: DEFAULT_CONFIG,
      fact: fact({
        name: 'react-codeshift',
        exists: true,
        weeklyDownloads: 0,
        versionCount: 1,
        repository: null,
        description: 'Placeholder to prevent dependency confusion.',
        license: 'ISC',
        ageDays: 271,
        installScripts: [],
      }),
    })
    expect(result.verdict).toBe('block')
    expect(result.score).toBeGreaterThanOrEqual(60)
    expect(result.reasons.map((item) => item.code)).toEqual(
      expect.arrayContaining(['low-downloads', 'single-version', 'missing-repo', 'placeholder']),
    )
    expect(result.suggestions.map((item) => item.name)).toEqual(
      expect.arrayContaining(['jscodeshift', 'react-codemod']),
    )
  })

  it('blocks a brand-new package with an install script and honors the allow list', () => {
    const fresh = scorePackage({
      ecosystem: 'npm',
      name: 'totally-new-utils',
      config: DEFAULT_CONFIG,
      fact: fact({
        name: 'totally-new-utils',
        exists: true,
        ageDays: 0.5,
        weeklyDownloads: 0,
        versionCount: 1,
        repository: null,
        description: 'helpers',
        license: null,
        installScripts: ['postinstall'],
      }),
    })
    expect(fresh.verdict).toBe('block')
    expect(fresh.reasons.map((item) => item.code)).toContain('install-script')

    const allowed = scorePackage({
      ecosystem: 'npm',
      name: 'totally-new-utils',
      config: { ...DEFAULT_CONFIG, allow: ['totally-new-utils'] },
      fact: fact({ name: 'totally-new-utils', exists: false }),
    })
    expect(allowed.verdict).toBe('allow')

    const scoped = scorePackage({
      ecosystem: 'npm',
      name: '@acme/widget',
      config: { ...DEFAULT_CONFIG, trustedScopes: ['@acme'] },
      fact: fact({ name: '@acme/widget', exists: false }),
    })
    expect(scoped.verdict).toBe('allow')
  })

  it('fails open for a known name when the registry is down, and still blocks an offline typo', () => {
    const react = scorePackage({
      ecosystem: 'npm',
      name: 'react',
      config: DEFAULT_CONFIG,
      fact: fact({ name: 'react', exists: null, offline: true }),
    })
    expect(react.verdict).toBe('allow')

    const recat = scorePackage({
      ecosystem: 'npm',
      name: 'recat',
      config: DEFAULT_CONFIG,
      fact: fact({ name: 'recat', exists: null, offline: true }),
    })
    expect(recat.verdict).toBe('block')

    const unknown = scorePackage({
      ecosystem: 'npm',
      name: 'some-private-tool',
      config: DEFAULT_CONFIG,
      fact: fact({ name: 'some-private-tool', exists: null, offline: true }),
    })
    expect(unknown.verdict).toBe('warn')
  })
})

describe('evaluateCommand', () => {
  it('blocks a missing requirement and allows flask from the same file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'slopgate-req-'))
    writeFileSync(join(dir, 'requirements.txt'), 'flask\nnot-a-real-package-xyz\n')
    const fetchImpl = (async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input)
      if (url.includes('/pypi/flask/json')) {
        return new Response(
          JSON.stringify({
            info: { version: '3.0.0', summary: 'web', license: 'BSD-3-Clause', project_urls: { Source: 'https://github.com/pallets/flask' } },
            releases: { '3.0.0': [{ upload_time_iso_8601: '2023-01-01T00:00:00Z' }] },
          }),
          { status: 200 },
        )
      }
      if (url.includes('/pypi/not-a-real-package-xyz/json')) return new Response('{}', { status: 404 })
      if (url.includes('pypistats.org')) return new Response(JSON.stringify({ data: { last_week: 5_000_000 } }), { status: 200 })
      throw new Error(url)
    }) as typeof fetch

    const evaluated = await evaluateCommand('pip install -r requirements.txt', dir, {
      config: DEFAULT_CONFIG,
      fetchImpl,
      now: () => Date.parse('2026-10-13T00:00:00Z'),
    })
    expect(evaluated.relevant).toBe(true)
    expect(evaluated.verdict).toBe('block')
    expect(evaluated.text).toContain('not-a-real-package-xyz')
    expect(evaluated.text).toContain('slopgate blocked')
    expect(evaluated.results.find((result) => result.name === 'flask')?.verdict).toBe('allow')
  })

  it('ignores commands that do not install anything', async () => {
    const evaluated = await evaluateCommand('npm test', process.cwd(), { config: DEFAULT_CONFIG })
    expect(evaluated.relevant).toBe(false)
    expect(evaluated.verdict).toBe('allow')
  })
})
