import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MemoryCache } from '../src/cache.js'
import { main } from '../src/cli.js'
import { DEFAULT_CONFIG } from '../src/config.js'
import { extractRefs } from '../src/scan/extract.js'
import { scanProject } from '../src/scan/scan.js'

const NOW = Date.parse('2026-10-13T00:00:00Z')

function fetchImplFor(routes: Record<string, { status: number; body: unknown }>): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input)
    const route = Object.entries(routes).find(([needle]) => url.includes(needle))
    if (!route) return new Response('{}', { status: 404 })
    return new Response(JSON.stringify(route[1].body), { status: route[1].status })
  }) as typeof fetch
}

const registry = fetchImplFor({
  '/react-codeshift/latest': {
    status: 200,
    body: { version: '1.0.0', description: 'Placeholder to prevent dependency confusion.', license: 'ISC' },
  },
  '/downloads/point/last-week/react-codeshift': { status: 200, body: { downloads: 0 } },
  '/registry.npmjs.org/react-codeshift': {
    status: 200,
    body: { time: { created: '2026-01-14T21:02:51.762Z' }, versions: { '1.0.0': {} } },
  },
  '/react/latest': {
    status: 200,
    body: {
      version: '19.0.0',
      description: 'React',
      license: 'MIT',
      repository: { url: 'git+https://github.com/facebook/react.git' },
    },
  },
  '/downloads/point/last-week/react': { status: 200, body: { downloads: 20_000_000 } },
})

describe('extract package names', () => {
  it('reads install commands, manifests, and stops before trailing prose', () => {
    const prose = extractRefs(
      'SKILL.md',
      'Run `npx react-codeshift` to migrate.\n```bash\nnpm install react && pip install flask\n```\n',
    )
    expect(prose.refs.map((ref) => `${ref.ecosystem}:${ref.name}`).sort()).toEqual([
      'npm:react',
      'npm:react-codeshift',
      'pypi:flask',
    ])

    const fenced = extractRefs(
      'README.md',
      '```bash\nnpm install react\nnpm run build\nnode dist/cli.js init\nnpx slopgate init\n```\n',
    )
    expect(fenced.refs.map((ref) => ref.name).sort()).toEqual(['react', 'slopgate'])

    const pkg = extractRefs(
      'package.json',
      JSON.stringify({
        dependencies: { react: '^19.0.0', alias: 'npm:left-pad@1.0.0', local: 'file:./local' },
      }),
    )
    expect(pkg.refs.map((ref) => ref.name).sort()).toEqual(['left-pad', 'react'])

    const py = extractRefs(
      'pyproject.toml',
      `
[project]
name = "demo"
dependencies = [
  "Requests>=2",
]
[project.optional-dependencies]
dev = ["pytest>=7"]
[tool.poetry.dependencies]
python = "^3.11"
httpx = "^0.27"
`,
    )
    expect(py.refs.map((ref) => ref.name).sort()).toEqual(['httpx', 'pytest', 'requests'])

    const cargo = extractRefs('Cargo.toml', '[dependencies]\nserde = "1"\ntokio = { git = "https://example.com/tokio" }\n')
    expect(cargo.refs.map((ref) => `${ref.name}:${ref.customRegistry}`)).toEqual(['serde:false', 'tokio:true'])

    const gomod = extractRefs(
      'go.mod',
      'module example.com/app\ngo 1.22\nrequire github.com/gin-gonic/gin v1.10.0\nreplace github.com/gin-gonic/gin => github.com/other/gin v0.0.1\n',
    )
    expect(gomod.refs.map((ref) => ref.name)).toEqual(['github.com/gin-gonic/gin'])
  })

  it('warns on a broken package.json instead of throwing', () => {
    const extracted = extractRefs('package.json', '{')
    expect(extracted.refs).toEqual([])
    expect(extracted.warnings[0]).toContain('package.json')
  })
})

describe('scan', () => {
  it('blocks a skill that tells an agent to install react-codeshift and skips ignored files', async () => {
    const root = mkdtempSync(join(tmpdir(), 'slopgate-scan-'))
    mkdirSync(join(root, 'skills', 'migrate'), { recursive: true })
    mkdirSync(join(root, 'node_modules', 'evil'), { recursive: true })
    mkdirSync(join(root, 'notes'), { recursive: true })
    writeFileSync(join(root, 'skills', 'migrate', 'SKILL.md'), 'npx react-codeshift\n')
    writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: { react: '^19.0.0' } }))
    writeFileSync(join(root, 'README.md'), 'npm install react-codeshift\n')
    writeFileSync(join(root, 'node_modules', 'evil', 'package.json'), JSON.stringify({ dependencies: { 'left-pad': '1.0.0' } }))
    writeFileSync(join(root, 'notes', 'random.md'), 'npm install totally-unrelated-package\n')

    const report = await scanProject(root, {
      ignore: ['README.md'],
      ctx: { config: DEFAULT_CONFIG, cache: new MemoryCache(), fetchImpl: registry, now: () => NOW },
    })
    expect(report.filesScanned).toBe(2)
    const blocked = report.findings.find((finding) => finding.result.name === 'react-codeshift')
    expect(blocked?.result.verdict).toBe('block')
    expect(blocked?.files).toEqual(['skills/migrate/SKILL.md'])
    expect(report.findings.some((finding) => finding.result.name === 'react' && finding.result.verdict === 'allow')).toBe(true)
    expect(report.findings.some((finding) => finding.result.name === 'left-pad')).toBe(false)
    expect(report.verdict).toBe('block')

    const out: string[] = []
    const code = await main(['scan', root, '--ignore', 'README.md', '--ignore', 'skills'], {
      cwd: root,
      env: { SLOPGATE_CACHE: join(mkdtempSync(join(tmpdir(), 'slopgate-scan-cache-')), 'cache.json') },
      fetchImpl: registry,
      now: () => NOW,
      stdout: (chunk) => out.push(chunk),
    })
    expect(code).toBe(0)
    expect(out.join('')).toContain('react')
    expect(out.join('')).not.toContain('react-codeshift')
  })
})
