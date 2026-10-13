import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { main } from '../src/cli.js'
import { installClaudeHook, installCursorHook, installGeminiHook } from '../src/hook/install.js'
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

  it('fails open on broken input unless fail-closed is set', async () => {
    const open = await runHook({ stdin: '{', client: 'claude', ctx: { config: DEFAULT_CONFIG, cache: new MemoryCache() } })
    expect(open.exitCode).toBe(0)
    expect(open.stderr).toContain('ignoring unreadable hook input')

    const closed = await runHook({
      stdin: '{',
      client: 'claude',
      env: { SLOPGATE_FAIL_CLOSED: '1' },
      ctx: { config: DEFAULT_CONFIG, cache: new MemoryCache() },
    })
    expect(closed.exitCode).toBe(2)
  })

  it('speaks Gemini deny and Cursor allow', async () => {
    const denied = await runHook({
      stdin: JSON.stringify({
        hook_event_name: 'BeforeTool',
        tool_name: 'run_shell_command',
        tool_input: { command: 'npm install react-codeshift' },
      }),
      cwd: mkdtempSync(join(tmpdir(), 'slopgate-gemini-')),
      ctx: { config: DEFAULT_CONFIG, cache: new MemoryCache(), fetchImpl: registry, now: () => NOW },
    })
    expect(JSON.parse(denied.stdout)).toMatchObject({ decision: 'deny' })
    expect(denied.stdout).toContain('react-codeshift')

    const allowed = await runHook({
      stdin: JSON.stringify({ command: 'npm test' }),
      client: 'cursor',
      ctx: { config: DEFAULT_CONFIG, cache: new MemoryCache() },
    })
    expect(JSON.parse(allowed.stdout)).toEqual({ permission: 'allow' })
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

  it('denies a Cursor shell install with the reason in both messages', async () => {
    const blocked = await runHook({
      stdin: JSON.stringify({ command: 'npm install react-codeshift', cwd: '/tmp/app' }),
      client: 'cursor',
      cwd: mkdtempSync(join(tmpdir(), 'slopgate-cursor-')),
      ctx: { config: DEFAULT_CONFIG, cache: new MemoryCache(), fetchImpl: registry, now: () => NOW },
    })
    const payload = JSON.parse(blocked.stdout) as { permission: string; user_message: string; agent_message: string }
    expect(payload.permission).toBe('deny')
    expect(payload.user_message).toContain('react-codeshift')
    expect(payload.agent_message).toBe(payload.user_message)
  })
})

describe('other agent hooks', () => {
  it('keeps an existing Cursor hook and skips a second Gemini install', () => {
    const dir = mkdtempSync(join(tmpdir(), 'slopgate-agents-'))
    const cursorPath = join(dir, '.cursor', 'hooks.json')
    mkdirSync(join(dir, '.cursor'), { recursive: true })
    writeFileSync(
      cursorPath,
      JSON.stringify({ version: 1, hooks: { beforeShellExecution: [{ command: 'echo keep-me' }] } }),
    )
    const cursor = installCursorHook(cursorPath, 'node /opt/slopgate/cli.js hook --client cursor')
    expect(cursor.changed).toBe(true)
    const saved = JSON.parse(readFileSync(cursorPath, 'utf8')) as {
      hooks: { beforeShellExecution: Array<{ command: string; timeout?: number }> }
    }
    expect(saved.hooks.beforeShellExecution.map((hook) => hook.command)).toEqual([
      'echo keep-me',
      'node /opt/slopgate/cli.js hook --client cursor',
    ])
    expect(saved.hooks.beforeShellExecution[1]?.timeout).toBe(25)

    const geminiPath = join(dir, '.gemini', 'settings.json')
    const command = 'node /opt/slopgate/cli.js hook --client gemini'
    expect(installGeminiHook(geminiPath, command).changed).toBe(true)
    expect(installGeminiHook(geminiPath, command).changed).toBe(false)
    const gemini = JSON.parse(readFileSync(geminiPath, 'utf8')) as {
      hooks: { BeforeTool: Array<{ matcher: string; hooks: Array<{ name: string; timeout: number }> }> }
    }
    expect(gemini.hooks.BeforeTool[0]?.matcher).toBe('run_shell_command')
    expect(gemini.hooks.BeforeTool[0]?.hooks[0]?.timeout).toBe(25000)
  })

  it('init writes project hooks for every client and leaves a broken file alone', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'slopgate-init-'))
    const out: string[] = []
    const code = await main(['init', '--no-install'], {
      cwd,
      homeDir: mkdtempSync(join(tmpdir(), 'slopgate-home-')),
      stdout: (chunk) => out.push(chunk),
    })
    expect(code).toBe(0)
    const text = out.join('')
    expect(text).toContain('Claude Code')
    expect(text).toContain('Cursor')
    expect(text).toContain('Codex')
    expect(text).toContain('Gemini CLI')
    const codex = JSON.parse(readFileSync(join(cwd, '.codex', 'hooks.json'), 'utf8')) as {
      hooks: { PreToolUse: Array<{ hooks: Array<{ command: string; statusMessage?: string }> }> }
    }
    expect(codex.hooks.PreToolUse[0]?.hooks[0]?.command).toContain('--client codex')
    expect(codex.hooks.PreToolUse[0]?.hooks[0]?.statusMessage).toContain('slopgate')

    const broken = join(cwd, '.cursor', 'hooks.json')
    const original = '{not json'
    writeFileSync(broken, original)
    const failed = await main(['init', '--no-install', '--only', 'cursor'], {
      cwd,
      stdout: () => {},
      stderr: () => {},
    })
    expect(failed).toBe(2)
    expect(readFileSync(broken, 'utf8')).toBe(original)
  })
})

describe('cli', () => {
  it('prints the version and rejects an unknown command', async () => {
    const out: string[] = []
    const err: string[] = []
    expect(await main(['--version'], { stdout: (chunk) => out.push(chunk) })).toBe(0)
    expect(out.join('').trim()).toMatch(/^\d+\.\d+\.\d+/)
    expect(await main(['nope'], { stderr: (chunk) => err.push(chunk) })).toBe(2)
    expect(err.join('')).toContain('unknown command')
  })

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
