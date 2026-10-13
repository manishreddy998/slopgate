import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { HookClient } from '../hook/format.js'
import { cliJsPath } from '../hook/install.js'

export interface McpInstallResult {
  path: string
  changed: boolean
}

export function mcpLaunch(executable = process.execPath, script = cliJsPath()): { command: string; args: string[] } {
  return { command: executable, args: [script, 'mcp'] }
}

export function mcpConfigPath(client: HookClient, global: boolean, projectDir: string, homeDir: string): string {
  const root = global ? homeDir : projectDir
  if (client === 'claude') return global ? join(homeDir, '.claude.json') : join(projectDir, '.mcp.json')
  if (client === 'cursor') return join(root, '.cursor', 'mcp.json')
  if (client === 'codex') return join(root, '.codex', 'config.toml')
  return join(root, '.gemini', 'settings.json')
}

/** Point one agent at `slopgate mcp`. Existing servers and other settings stay put. */
export function installMcpServer(
  client: HookClient,
  path: string,
  command: string,
  args: readonly string[],
): McpInstallResult {
  if (client === 'codex') return installCodexMcp(path, command, args)
  return installJsonMcp(path, command, args)
}

function installJsonMcp(path: string, command: string, args: readonly string[]): McpInstallResult {
  const settings = readJsonObject(path)
  const servers = objectAt(settings, 'mcpServers')
  if (servers.slopgate !== undefined) {
    if (!isRecord(servers.slopgate)) throw new Error(`${path} mcpServers.slopgate must be an object`)
    return { path, changed: false }
  }
  servers.slopgate = { command, args: [...args] }
  writeJson(path, settings)
  return { path, changed: true }
}

function installCodexMcp(path: string, command: string, args: readonly string[]): McpInstallResult {
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : ''
  if (/^\s*\[mcp_servers\.slopgate\]\s*$/m.test(existing)) return { path, changed: false }
  const section = `[mcp_servers.slopgate]\ncommand = ${tomlString(command)}\nargs = ${tomlArray(args)}\n`
  const next = existing.length === 0 ? section : `${existing.replace(/\s*$/, '')}\n\n${section}`
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, next)
  return { path, changed: true }
}

function tomlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function tomlArray(values: readonly string[]): string {
  return `[${values.map((value) => tomlString(value)).join(', ')}]`
}

function readJsonObject(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch (error) {
    throw new Error(`Could not parse ${path}: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!isRecord(parsed)) throw new Error(`${path} must be a JSON object`)
  return parsed
}

function objectAt(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const current = parent[key]
  if (isRecord(current)) return current
  if (current !== undefined) throw new Error(`${key} must be a JSON object`)
  const created: Record<string, unknown> = {}
  parent[key] = created
  return created
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
