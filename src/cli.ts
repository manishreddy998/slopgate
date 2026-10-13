#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDirectEntry } from './entry.js'
import { DiskCache, defaultCachePath } from './cache.js'
import { loadConfig } from './config.js'
import { formatReport } from './explain.js'
import { scoreRefs } from './evaluate.js'
import type { HookClient } from './hook/format.js'
import {
  hookCommand,
  installClaudeHook,
  installCodexHook,
  installCursorHook,
  installGeminiHook,
  integrationPath,
  type InstallResult,
} from './hook/install.js'
import { runHook } from './hook/run.js'
import { installMcpServer, mcpConfigPath, mcpLaunch } from './mcp/install.js'
import { serveMcp } from './mcp/server.js'
import { formatScan, scanProject } from './scan/scan.js'
import type { LookupContext } from './registry/lookup.js'
import { worstVerdict } from './risk/score.js'
import { ECOSYSTEMS, type Ecosystem, type PackageRef } from './types.js'
import { version, packageName } from './version.js'

const HELP = `slopgate ${version}
Block missing, typosquatted, and newly published packages before install.

Usage
  slopgate init [--global] [--only claude,cursor,codex,gemini] [--no-install] [--no-mcp]
  slopgate check <package...> [--ecosystem npm|pypi|cargo|go] [--json] [--strict]
  slopgate hook [--client claude|cursor|codex|gemini|auto] [--command <shell>]
  slopgate scan [dir] [--ignore <glob>] [--json] [--strict]
  slopgate mcp

  npx @slop-gate/cli init
  slopgate check react-codeshift
  slopgate scan . --ignore README.md

No telemetry. Queries go only to the public registries.
`

const BOOLEAN_FLAGS = new Set(['help', 'version', 'global', 'json', 'strict', 'no-install', 'no-mcp'])

export interface CliIo {
  stdin?: string
  cwd?: string
  env?: NodeJS.ProcessEnv
  stdout?: (chunk: string) => void
  stderr?: (chunk: string) => void
  fetchImpl?: typeof fetch
  now?: () => number
  homeDir?: string
}

interface ParsedArgs {
  command: string
  positionals: string[]
  flags: Map<string, string | boolean>
}

export async function main(argv: string[], io: CliIo = {}): Promise<number> {
  const args = parseArgv(argv)
  const stdout = io.stdout ?? ((chunk: string) => process.stdout.write(chunk))
  const stderr = io.stderr ?? ((chunk: string) => process.stderr.write(chunk))
  if (args.flags.get('help') === true || args.command === 'help') {
    stdout(HELP)
    return 0
  }
  if (args.flags.get('version') === true || args.command === 'version') {
    stdout(`${version}\n`)
    return 0
  }
  if (args.command === '') {
    stdout(HELP)
    return 0
  }
  const cwd = io.cwd ?? process.cwd()
  const env = io.env ?? process.env
  try {
    switch (args.command) {
      case 'init':
        return initCommand(args, cwd, io.homeDir ?? homedir(), env, stdout, stderr)
      case 'check':
        return await checkCommand(args, cwd, env, io, stdout)
      case 'hook':
        return await hookCommandRun(args, cwd, env, io, stdout, stderr)
      case 'mcp':
        return await mcpCommandRun(cwd, env, io, stdout)
      case 'scan':
        return await scanCommand(args, cwd, env, io, stdout)
      default:
        stderr(`slopgate: unknown command ${args.command}\n\n${HELP}`)
        return 2
    }
  } catch (error) {
    stderr(`slopgate: ${error instanceof Error ? error.message : String(error)}\n`)
    return 2
  }
}

function initCommand(
  args: ParsedArgs,
  cwd: string,
  homeDir: string,
  env: NodeJS.ProcessEnv,
  stdout: (chunk: string) => void,
  stderr: (chunk: string) => void,
): number {
  const global = args.flags.get('global') === true
  if (!global && args.flags.get('no-install') !== true) {
    const installed = ensureDevDependency(cwd, env)
    if (installed === 'failed') {
      stderr(`slopgate: could not add ${packageName} as a dev dependency. Hooks will call npx -y ${packageName}.\n`)
    }
  }
  for (const client of selectedClients(args.flags.get('only'))) {
    const path = integrationPath(client, global, cwd, homeDir)
    const result = installClient(client, path, hookCommand(client))
    stdout(
      result.changed
        ? `Installed the ${CLIENT_LABEL[client]} hook in ${result.path}\n`
        : `${CLIENT_LABEL[client]} hook already present in ${result.path}\n`,
    )
    if (args.flags.get('no-mcp') === true) continue
    const launch = mcpLaunch()
    const mcp = installMcpServer(client, mcpConfigPath(client, global, cwd, homeDir), launch.command, launch.args)
    stdout(
      mcp.changed
        ? `Installed the ${CLIENT_LABEL[client]} MCP server in ${mcp.path}\n`
        : `${CLIENT_LABEL[client]} MCP server already present in ${mcp.path}\n`,
    )
  }
  return 0
}

const CLIENT_LABEL: Record<HookClient, string> = {
  claude: 'Claude Code',
  cursor: 'Cursor',
  codex: 'Codex',
  gemini: 'Gemini CLI',
}

const CLIENTS: readonly HookClient[] = ['claude', 'cursor', 'codex', 'gemini']

function selectedClients(only: string | boolean | undefined): HookClient[] {
  if (only === undefined) return [...CLIENTS]
  if (typeof only !== 'string') throw new Error('init --only needs a list of clients, separated by commas')
  const clients = only
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
  if (clients.length === 0) throw new Error('init --only needs at least one client')
  for (const client of clients) {
    if (!(CLIENTS as readonly string[]).includes(client)) throw new Error(`unknown client ${client}`)
  }
  return clients as HookClient[]
}

function installClient(client: HookClient, path: string, command: string): InstallResult {
  if (client === 'claude') return installClaudeHook(path, command)
  if (client === 'cursor') return installCursorHook(path, command)
  if (client === 'codex') return installCodexHook(path, command)
  return installGeminiHook(path, command)
}

async function checkCommand(
  args: ParsedArgs,
  cwd: string,
  env: NodeJS.ProcessEnv,
  io: CliIo,
  stdout: (chunk: string) => void,
): Promise<number> {
  if (args.positionals.length === 0) throw new Error('check needs at least one package name')
  const fallback = parseEcosystem(args.flags.get('ecosystem'))
  const refs = args.positionals.map((token) => specToRef(token, fallback))
  const ctx = lookupContext(cwd, env, io)
  const results = await scoreRefs(refs, ctx)
  if (args.flags.get('json') === true) {
    stdout(`${JSON.stringify({ verdict: worstVerdict(results), results }, null, 2)}\n`)
  } else {
    stdout(formatReport(results))
  }
  if (results.some((result) => result.verdict === 'block')) return 1
  if (args.flags.get('strict') === true && results.some((result) => result.verdict === 'warn')) return 1
  return 0
}

async function scanCommand(
  args: ParsedArgs,
  cwd: string,
  env: NodeJS.ProcessEnv,
  io: CliIo,
  stdout: (chunk: string) => void,
): Promise<number> {
  const root = args.positionals[0] ? resolve(cwd, args.positionals[0]) : cwd
  const ignoreFlag = args.flags.get('ignore')
  const ignore = typeof ignoreFlag === 'string' ? ignoreFlag.split('\n').filter((item) => item.length > 0) : []
  const report = await scanProject(root, { ignore, ctx: lookupContext(cwd, env, io) })
  if (args.flags.get('json') === true) {
    stdout(`${JSON.stringify(report, null, 2)}\n`)
  } else {
    stdout(formatScan(report))
  }
  if (report.verdict === 'block') return 1
  if (args.flags.get('strict') === true && report.verdict === 'warn') return 1
  return 0
}

async function mcpCommandRun(
  cwd: string,
  env: NodeJS.ProcessEnv,
  io: CliIo,
  stdout: (chunk: string) => void,
): Promise<number> {
  const input = io.stdin !== undefined ? [io.stdin] : process.stdin
  return serveMcp({ input, write: stdout, ctx: lookupContext(cwd, env, io) })
}

async function hookCommandRun(
  args: ParsedArgs,
  cwd: string,
  env: NodeJS.ProcessEnv,
  io: CliIo,
  stdout: (chunk: string) => void,
  stderr: (chunk: string) => void,
): Promise<number> {
  const commandFlag = args.flags.get('command')
  const result = await runHook({
    stdin: io.stdin ?? (await readStdin()),
    ...(typeof commandFlag === 'string' ? { command: commandFlag } : {}),
    ...(typeof args.flags.get('client') === 'string' ? { client: String(args.flags.get('client')) } : {}),
    cwd,
    env,
    ctx: {
      config: loadConfig(cwd, env),
      cache: new DiskCache(defaultCachePath(env)),
      ...(io.fetchImpl ? { fetchImpl: io.fetchImpl } : {}),
      ...(io.now ? { now: io.now } : {}),
    },
  })
  stdout(result.stdout)
  stderr(result.stderr)
  return result.exitCode
}

function lookupContext(cwd: string, env: NodeJS.ProcessEnv, io: CliIo): LookupContext {
  return {
    config: loadConfig(cwd, env),
    cache: new DiskCache(defaultCachePath(env)),
    ...(io.fetchImpl ? { fetchImpl: io.fetchImpl } : {}),
    ...(io.now ? { now: io.now } : {}),
  }
}

function specToRef(token: string, fallback: Ecosystem): PackageRef {
  const match = /^(npm|pypi|cargo|go):(.+)$/.exec(token)
  const ecosystem = match?.[1] ? (match[1] as Ecosystem) : fallback
  const name = (match?.[2] ?? token).trim()
  if (!name) throw new Error(`empty package name in ${token}`)
  return { ecosystem, name, raw: token, ignoreScripts: false, customRegistry: false }
}

function parseEcosystem(value: string | boolean | undefined): Ecosystem {
  if (typeof value !== 'string') return 'npm'
  if ((ECOSYSTEMS as readonly string[]).includes(value)) return value as Ecosystem
  throw new Error(`unknown package source ${value}. Use npm, pypi, cargo, or go.`)
}

function ensureDevDependency(cwd: string, env: NodeJS.ProcessEnv): 'installed' | 'skipped' | 'failed' {
  const pkgPath = join(cwd, 'package.json')
  if (!existsSync(pkgPath)) return 'skipped'
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      name?: string
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    if (pkg.name === packageName) return 'skipped'
    if (pkg.dependencies?.[packageName] || pkg.devDependencies?.[packageName]) return 'skipped'
  } catch {
    return 'skipped'
  }
  const result = spawnSync('npm', ['install', '--save-dev', '--silent', `${packageName}@${version}`], {
    cwd,
    env,
    encoding: 'utf8',
  })
  return result.status === 0 ? 'installed' : 'failed'
}

function storeFlag(flags: Map<string, string | boolean>, key: string, value: string): void {
  if (key !== 'ignore') {
    flags.set(key, value)
    return
  }
  const previous = flags.get(key)
  flags.set(key, typeof previous === 'string' ? `${previous}\n${value}` : value)
}

function parseArgv(argv: string[]): ParsedArgs {
  const positionals: string[] = []
  const flags = new Map<string, string | boolean>()
  let command = ''
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]!
    if (token === '--') {
      positionals.push(...argv.slice(index + 1))
      break
    }
    if (token === '--help' || token === '-h') {
      flags.set('help', true)
      continue
    }
    if (token === '--version' || token === '-v') {
      flags.set('version', true)
      continue
    }
    if (token.startsWith('--')) {
      const body = token.slice(2)
      const eq = body.indexOf('=')
      if (eq !== -1) {
        storeFlag(flags, body.slice(0, eq), body.slice(eq + 1))
        continue
      }
      const next = argv[index + 1]
      if (next !== undefined && !next.startsWith('-') && !BOOLEAN_FLAGS.has(body)) {
        storeFlag(flags, body, next)
        index++
        continue
      }
      flags.set(body, true)
      continue
    }
    if (!command) command = token
    else positionals.push(token)
  }
  return { command, positionals, flags }
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return ''
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

const invokedDirectly = isDirectEntry(process.argv[1], fileURLToPath(import.meta.url))

if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code
    })
    .catch((error: unknown) => {
      process.stderr.write(`slopgate: ${error instanceof Error ? error.message : String(error)}\n`)
      process.exitCode = 2
    })
}
