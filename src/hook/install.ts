import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { HookClient } from './format.js'
import { packageName } from '../version.js'

export function hookCommand(client: HookClient): string {
  return `npx -y ${packageName} hook --client ${client}`
}

export function claudeSettingsPath(global: boolean, projectDir: string, homeDir: string): string {
  return global ? join(homeDir, '.claude', 'settings.json') : join(projectDir, '.claude', 'settings.json')
}

export interface InstallResult {
  path: string
  changed: boolean
}

/** Merge a Claude Code or Codex PreToolUse hook. Existing hooks are left in place. */
export function installClaudeHook(path: string, command: string): InstallResult {
  return installPreToolHook(path, command)
}

export function installCodexHook(path: string, command: string): InstallResult {
  return installPreToolHook(path, command, 'Checking packages with slopgate')
}

export function installCursorHook(path: string, command: string): InstallResult {
  const settings = readJsonObject(path)
  if (settings.version === undefined) settings.version = 1
  const hooks = objectAt(settings, 'hooks')
  const handlers = arrayAt(hooks, 'beforeShellExecution')
  if (hasSlopgateCommand(handlers)) return { path, changed: false }
  handlers.push({ command, timeout: 25 })
  writeJson(path, settings)
  return { path, changed: true }
}

export function installGeminiHook(path: string, command: string): InstallResult {
  const settings = readJsonObject(path)
  const hooks = objectAt(settings, 'hooks')
  const groups = arrayAt(hooks, 'BeforeTool')
  const found = groups.find((item) => isRecord(item) && item.matcher === 'run_shell_command')
  const group: Record<string, unknown> = isRecord(found) ? found : { matcher: 'run_shell_command', hooks: [] }
  if (group !== found) groups.push(group)
  const handlers = arrayAt(group, 'hooks')
  if (handlers.some((handler) => isRecord(handler) && handler.name === 'slopgate')) return { path, changed: false }
  handlers.push({
    name: 'slopgate',
    type: 'command',
    command,
    timeout: 25000,
    description: 'Block fake, look-alike, and very new package installs',
  })
  writeJson(path, settings)
  return { path, changed: true }
}

export function integrationPath(
  client: HookClient,
  global: boolean,
  projectDir: string,
  homeDir: string,
): string {
  if (client === 'claude') return claudeSettingsPath(global, projectDir, homeDir)
  const root = global ? homeDir : projectDir
  if (client === 'cursor') return join(root, '.cursor', 'hooks.json')
  if (client === 'codex') return join(root, '.codex', 'hooks.json')
  return join(root, '.gemini', 'settings.json')
}

function installPreToolHook(path: string, command: string, statusMessage?: string): InstallResult {
  const settings = readJsonObject(path)
  const hooks = objectAt(settings, 'hooks')
  const groups = arrayAt(hooks, 'PreToolUse')
  const found = groups.find((item) => isRecord(item) && item.matcher === 'Bash')
  const group: Record<string, unknown> = isRecord(found) ? found : { matcher: 'Bash', hooks: [] }
  if (group !== found) groups.push(group)
  const handlers = arrayAt(group, 'hooks')
  if (hasSlopgateCommand(handlers)) return { path, changed: false }
  handlers.push({
    type: 'command',
    command,
    timeout: 25,
    ...(statusMessage ? { statusMessage } : {}),
  })
  writeJson(path, settings)
  return { path, changed: true }
}

function hasSlopgateCommand(handlers: unknown[]): boolean {
  return handlers.some(
    (handler) =>
      isRecord(handler) &&
      typeof handler.command === 'string' &&
      (handler.command.includes(packageName) || handler.command.includes('slopgate')),
  )
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
