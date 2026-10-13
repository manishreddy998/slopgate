import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { main } from '../src/cli.js'
import { installClaudeHook } from '../src/hook/install.js'
import { runHook } from '../src/hook/run.js'
import { DEFAULT_CONFIG } from '../src/config.js'
import { MemoryCache } from '../src/cache.js'

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
    body: {
      version: '1.0.0',
      description: 'Placeholder to prevent dependency confusion.',
      license: 'ISC',
    },
  },
  '/downloads/point/last-week/react-codeshift': { status: 200, body: { downloads: 0 } },
  '/registry.npmjs.org/react-codeshift': {
    status: 200,
    body: {
      time: { created: '2026-01-14T21:02:51.762Z' },
      versions: { '1.0.0': {} },
    },
  },
  '/react/latest': {
    status: 200,
    body: {
      version: '19.0.0',
      description: 'React',
      license: 'MIT',
      repository: { url: 'git+https://github.com/facebook/react.git' },
      scripts: {},
    },
  },
  '/downloads/point/last-week/react': { status: 200, body: { downloads: 20_000_000 } },
})

describe('Claude Code hook', () => {
  it('blocks npm install react-codeshift and allows npm install react', async () => {
    const shared = {
      client: 'claude',
      cwd: mkdtempSync(join(tmpdir(), 'slopgate-hook-')),
      env: { SLOPGATE_CACHE: join(tmpdir(), `slopgate-empty-${Date.now()}.json`) },
      ctx: { config: DEFAULT_CONFIG, cache: new MemoryCache(), fetchImpl: registry, now: () => NOW },
    }
    const blocked = await runHook({
      ...shared,
      stdin: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'npm install react-codeshift' } }),
    })
    expect(blocked.exitCode).toBe(0)
    const decision = JSON.parse(blocked.stdout) as {
      hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string }
    }
    expect(decision.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(decision.hookSpecificOutput.permissionDecisionReason).toContain('react-codeshift')
    expect(decision.hookSpecificOutput.permissionDecisionReason).toContain('jscodeshift')

    const allowed = await runHook({
      ...shared,
      stdin: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'npm install react' } }),
    })
    expect(allowed.exitCode).toBe(0)
    expect(allowed.stdout).toBe('')
  })

  it('stays quiet for commands that do not install packages', async () => {
    const result = await runHook({
      stdin: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'npm test' } }),
      client: 'claude',
      ctx: { config: DEFAULT_CONFIG, cache: new MemoryCache() },
    })
    expect(result.stdout).toBe('')
    expect(result.exitCode).toBe(0)
  })

  it('merges into an existing Claude settings file without dropping other hooks', () => {
    const dir = mkdtempSync(join(tmpdir(), 'slopgate-claude-'))
    const path = join(dir, '.claude', 'settings.json')
    mkdirSync(join(dir, '.claude'), { recursive: true })
    writeFileSync(
      path,
      JSON.stringify({
        hooks: {
          PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo keep-me' }] }],
        },
      }),
    )
    const first = installClaudeHook(path, 'node /opt/slopgate/cli.js hook --client claude')
    const second = installClaudeHook(path, 'node /opt/slopgate/cli.js hook --client claude')
    expect(first.changed).toBe(true)
    expect(second.changed).toBe(false)
    const saved = JSON.parse(readFileSync(path, 'utf8')) as {
      hooks: { PreToolUse: Array<{ hooks: Array<{ command: string }> }> }
    }
    expect(saved.hooks.PreToolUse[0]?.hooks.map((hook) => hook.command)).toEqual([
      'echo keep-me',
      'node /opt/slopgate/cli.js hook --client claude',
    ])
  })
})

describe('cli', () => {
  it('prints an allow line for react and exits 1 for a miss', async () => {
    const out: string[] = []
    const cacheDir = mkdtempSync(join(tmpdir(), 'slopgate-cli-cache-'))
    const allow = await main(['check', 'react'], {
      cwd: mkdtempSync(join(tmpdir(), 'slopgate-check-')),
      env: { SLOPGATE_CACHE: join(cacheDir, 'cache.json') },
      fetchImpl: registry,
      now: () => NOW,
      stdout: (chunk) => out.push(chunk),
    })
    expect(allow).toBe(0)
    expect(out.join('')).toContain('allow')

    out.length = 0
    const block = await main(['check', 'npm:does-not-exist-slopgate'], {
      cwd: mkdtempSync(join(tmpdir(), 'slopgate-check-')),
      env: { SLOPGATE_CACHE: join(cacheDir, 'cache.json') },
      fetchImpl: registry,
      now: () => NOW,
      stdout: (chunk) => out.push(chunk),
    })
    expect(block).toBe(1)
    expect(out.join('')).toContain('blocked')
  })
})
