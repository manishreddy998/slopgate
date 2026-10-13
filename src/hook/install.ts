import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { HookClient } from './format.js'

export function cliJsPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'cli.js')
}

export function hookCommand(client: HookClient, executable = process.execPath, script = cliJsPath()): string {
  return `${quote(executable)} ${quote(script)} hook --client ${client}`
}

export function claudeSettingsPath(global: boolean, projectDir: string, homeDir: string): string {
  return global ? join(homeDir, '.claude', 'settings.json') : join(projectDir, '.claude', 'settings.json')
}

export interface InstallResult {
  path: string
  changed: boolean
}

/** Merge a Claude Code PreToolUse hook. Existing hooks are left in place. */
export function installClaudeHook(path: string, command: string): InstallResult {
  const settings = readJsonObject(path)
  const hooks = objectAt(settings, 'hooks')
  const groups = arrayAt(hooks, 'PreToolUse')
  const found = groups.find((item) => isRecord(item) && item.matcher === 'Bash')
  const group: Record<string, unknown> = isRecord(found) ? found : { matcher: 'Bash', hooks: [] }
  if (group !== found) groups.push(group)
  const handlers = arrayAt(group, 'hooks')
  if (handlers.some((handler) => isRecord(handler) && typeof handler.command === 'string' && handler.command.includes('slopgate'))) {
    return { path, changed: false }
  }
  handlers.push({ type: 'command', command, timeout: 25 })
  writeJson(path, settings)
  return { path, changed: true }
}

function readJsonObject(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Could not parse ${path}: ${message}`)
  }
  if (!isRecord(parsed)) throw new Error(`${path} must be a JSON object`)
  return parsed
}

function objectAt(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const current = parent[key]
  if (isRecord(current)) return current
  const created: Record<string, unknown> = {}
  parent[key] = created
  return created
}

function arrayAt(parent: Record<string, unknown>, key: string): unknown[] {
  const current = parent[key]
  if (Array.isArray(current)) return current
  const created: unknown[] = []
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

function quote(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value
  return `'${value.replace(/'/g, `'\\''`)}'`
}
