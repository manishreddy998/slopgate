import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MemoryCache } from '../src/cache.js'
import { main } from '../src/cli.js'
import { DEFAULT_CONFIG } from '../src/config.js'
import { installMcpServer } from '../src/mcp/install.js'
import { encodeFrame, pushFrames, serveMcp } from '../src/mcp/server.js'

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

const ctx = {
  config: DEFAULT_CONFIG,
  cache: new MemoryCache(),
  fetchImpl: registry,
  now: () => NOW,
}

function request(id: number, method: string, params: unknown): Record<string, unknown> {
  return { jsonrpc: '2.0', id, method, params }
}

describe('MCP server', () => {
  it('answers check_package over Content-Length and newline JSON', async () => {
    const calls = [
      request(1, 'initialize', { protocolVersion: '2024-11-05' }),
      request(2, 'tools/list', {}),
      request(3, 'tools/call', { name: 'check_package', arguments: { name: 'react' } }),
      request(4, 'tools/call', { name: 'check_package', arguments: { ecosystem: 'npm', name: 'react-codeshift' } }),
    ]
    const ndjson = `${calls.map((call) => JSON.stringify(call)).join('\n')}\n`
    const framed = calls.map((call) => encodeFrame(call, 'content-length')).join('')
    for (const input of [ndjson, framed]) {
      const out: string[] = []
      const code = await serveMcp({ input: [input], write: (chunk) => out.push(chunk), ctx })
      expect(code).toBe(0)
      const { frames } = pushFrames(Buffer.alloc(0), Buffer.from(out.join('')))
      const messages = frames.map((frame) => JSON.parse(frame.body) as { id: number; result: Record<string, unknown> })
      expect(messages.map((message) => message.id)).toEqual([1, 2, 3, 4])
      const tools = messages[1]?.result.tools as Array<{ name: string }>
      expect(tools.map((tool) => tool.name)).toEqual(['check_package'])
      expect(messages[2]?.result.isError).toBe(false)
      expect(JSON.stringify(messages[2]?.result.structuredContent)).toContain('"verdict":"allow"')
      expect(messages[3]?.result.isError).toBe(true)
      expect(JSON.stringify(messages[3]?.result.content)).toContain('jscodeshift')
    }
  })

  it('ignores the initialized notification and rejects a bad frame', async () => {
    const out: string[] = []
    await serveMcp({
      input: ['{"jsonrpc":"2.0","method":"notifications/initialized"}\nContent-Length: nope\r\n\r\n{}'],
      write: (chunk) => out.push(chunk),
      ctx,
    })
    const { frames } = pushFrames(Buffer.alloc(0), Buffer.from(out.join('')))
    expect(frames).toHaveLength(1)
    expect(frames[0]?.body).toContain('Content-Length')
  })
})

describe('init mcp config', () => {
  it('writes a server entry for each client without dropping Gemini hooks', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'slopgate-mcp-'))
    const code = await main(['init', '--no-install', '--only', 'gemini,codex'], {
      cwd,
      stdout: () => {},
    })
    expect(code).toBe(0)
    const gemini = JSON.parse(readFileSync(join(cwd, '.gemini', 'settings.json'), 'utf8')) as {
      hooks: { BeforeTool: unknown[] }
      mcpServers: { slopgate: { args: string[] } }
    }
    expect(gemini.hooks.BeforeTool).toHaveLength(1)
    expect(gemini.mcpServers.slopgate.args.at(-1)).toBe('mcp')
    const toml = readFileSync(join(cwd, '.codex', 'config.toml'), 'utf8')
    expect(toml).toContain('[mcp_servers.slopgate]')
    expect(toml).toContain('"mcp"')

    const again = installMcpServer('codex', join(cwd, '.codex', 'config.toml'), 'node', ['cli.js', 'mcp'])
    expect(again.changed).toBe(false)
    expect(readFileSync(join(cwd, '.codex', 'config.toml'), 'utf8').match(/mcp_servers\.slopgate/g)).toHaveLength(1)
  })

  it('skips MCP files when --no-mcp is set', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'slopgate-nomcp-'))
    const out: string[] = []
    const code = await main(['init', '--no-install', '--no-mcp', '--only', 'cursor'], {
      cwd,
      stdout: (chunk) => out.push(chunk),
    })
    expect(code).toBe(0)
    expect(out.join('')).not.toContain('MCP')
    expect(() => readFileSync(join(cwd, '.cursor', 'mcp.json'), 'utf8')).toThrow()
  })
})
