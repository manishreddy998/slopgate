#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DiskCache, defaultCachePath } from './cache.js'
import { loadConfig } from './config.js'
import { formatReport } from './explain.js'
import { scoreRefs } from './evaluate.js'
import { claudeSettingsPath, hookCommand, installClaudeHook } from './hook/install.js'
import { runHook } from './hook/run.js'
import type { LookupContext } from './registry/lookup.js'
import { worstVerdict } from './risk/score.js'
import { ECOSYSTEMS, type Ecosystem, type PackageRef } from './types.js'
import { version } from './version.js'

const HELP = `slopgate ${version}
Stop AI coding agents from installing hallucinated packages.

Usage
  slopgate init [--global]
  slopgate check <package...> [--ecosystem npm|pypi|cargo|go] [--json] [--strict]
  slopgate hook [--client claude|cursor|codex|gemini|auto] [--command <shell>]

  slopgate check react-codeshift
  slopgate hook --client claude --command "npm install react"

No telemetry. Registry requests stay between you and the registry.
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
  if (args.flags.get('help') === true || args.command === '' || args.command === 'help') {
    stdout(HELP)
    return 0
  }
  if (args.flags.get('version') === true || args.command === '--version') {
    stdout(`${version}\n`)
    return 0
  }
  const cwd = io.cwd ?? process.cwd()
  const env = io.env ?? process.env
  try {
    switch (args.command) {
      case 'init':
        return initCommand(args, cwd, io.homeDir ?? homedir(), stdout, stderr)
      case 'check':
        return await checkCommand(args, cwd, env, io, stdout)
      case 'hook':
        return await hookCommandRun(args, cwd, env, io, stdout, stderr)
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
  stdout: (chunk: string) => void,
  stderr: (chunk: string) => void,
): number {
  const global = args.flags.get('global') === true
  if (!global && args.flags.get('no-install') !== true) {
    const installed = ensureDevDependency(cwd)
    if (installed === 'failed') {
      stderr('slopgate: could not add the local dev dependency. The hook will call this copy of the CLI.\n')
    }
  }
  const path = claudeSettingsPath(global, cwd, homeDir)
  const result = installClaudeHook(path, hookCommand('claude'))
  stdout(
    result.changed
      ? `Installed the Claude Code hook in ${result.path}\n`
      : `Claude Code hook already present in ${result.path}\n`,
  )
  return 0
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
  throw new Error(`unknown ecosystem ${value}`)
}

function ensureDevDependency(cwd: string): 'installed' | 'skipped' | 'failed' {
  const pkgPath = join(cwd, 'package.json')
  if (!existsSync(pkgPath)) return 'skipped'
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      name?: string
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    if (pkg.name === 'slopgate') return 'skipped'
    if (pkg.dependencies?.slopgate || pkg.devDependencies?.slopgate) return 'skipped'
  } catch {
    return 'skipped'
  }
  const result = spawnSync('npm', ['install', '--save-dev', '--silent', `slopgate@${version}`], {
    cwd,
    encoding: 'utf8',
  })
  return result.status === 0 ? 'installed' : 'failed'
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
        flags.set(body.slice(0, eq), body.slice(eq + 1))
        continue
      }
      const next = argv[index + 1]
      if (next !== undefined && !next.startsWith('-') && !BOOLEAN_FLAGS.has(body)) {
        flags.set(body, next)
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

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

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
