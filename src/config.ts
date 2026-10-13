import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { OfflinePolicy, SlopgateConfig } from './types.js'

export const DEFAULT_REGISTRIES = {
  npm: 'https://registry.npmjs.org',
  pypi: 'https://pypi.org',
  crates: 'https://crates.io',
  go: 'https://proxy.golang.org',
} as const

export const DEFAULT_CONFIG: SlopgateConfig = {
  blockScore: 60,
  warnScore: 25,
  maxAgeDays: 30,
  minWeeklyDownloads: 100,
  typoDistance: 2,
  allow: [],
  trustedScopes: [],
  offline: 'warn',
  ignoreInstallScripts: false,
  concurrency: 8,
  cacheTtlHours: 12,
  missingTtlMinutes: 15,
  ignorePaths: [],
  registries: { ...DEFAULT_REGISTRIES },
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

export function loadConfig(cwd: string, env: NodeJS.ProcessEnv = process.env): SlopgateConfig {
  let config = DEFAULT_CONFIG
  if (env.SLOPGATE_IGNORE_PROJECT_CONFIG !== '1') {
    const project = readProjectConfig(cwd)
    if (project) config = mergeConfig(config, project)
  }
  const userPath = join(homedir(), '.config', 'slopgate', 'config.json')
  const user = readConfigFile(userPath)
  if (user) config = mergeConfig(config, user)
  if (env.SLOPGATE_CONFIG && resolve(env.SLOPGATE_CONFIG) !== resolve(userPath)) {
    const explicit = readConfigFile(env.SLOPGATE_CONFIG)
    if (explicit) config = mergeConfig(config, explicit)
  }
  return clampConfig(config)
}

/** The nearest slopgate.config.json. If there is none, the nearest package.json "slopgate" key. */
export function readProjectConfig(cwd: string): Partial<SlopgateConfig> | null {
  let dir = resolve(cwd)
  for (;;) {
    const dedicated = join(dir, 'slopgate.config.json')
    if (existsSync(dedicated)) return readConfigFile(dedicated)
    const pkgPath = join(dir, 'package.json')
    if (existsSync(pkgPath)) {
      const fromPkg = readPackageConfig(pkgPath)
      if (fromPkg) return fromPkg
    }
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

export function readConfigFile(path: string): Partial<SlopgateConfig> | null {
  if (!existsSync(path)) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new ConfigError(`Could not parse ${path}: ${message}`)
  }
  return normalizeConfig(parsed, path)
}

function readPackageConfig(path: string): Partial<SlopgateConfig> | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new ConfigError(`Could not parse ${path}: ${message}`)
  }
  if (!parsed || typeof parsed !== 'object' || !('slopgate' in parsed)) return null
  return normalizeConfig((parsed as { slopgate: unknown }).slopgate, `${path}#slopgate`)
}

export function normalizeConfig(value: unknown, path: string): Partial<SlopgateConfig> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ConfigError(`${path} must be a JSON object`)
  }
  const obj = value as Record<string, unknown>
  const out: Partial<SlopgateConfig> = {}
  assignNumber(out, 'blockScore', obj.blockScore, path)
  assignNumber(out, 'warnScore', obj.warnScore, path)
  assignNumber(out, 'maxAgeDays', obj.maxAgeDays, path)
  assignNumber(out, 'minWeeklyDownloads', obj.minWeeklyDownloads, path)
  assignNumber(out, 'typoDistance', obj.typoDistance, path)
  assignNumber(out, 'concurrency', obj.concurrency, path)
  assignNumber(out, 'cacheTtlHours', obj.cacheTtlHours, path)
  assignNumber(out, 'missingTtlMinutes', obj.missingTtlMinutes, path)
  assignStringList(out, 'allow', obj.allow, path)
  assignStringList(out, 'trustedScopes', obj.trustedScopes, path)
  assignStringList(out, 'ignorePaths', obj.ignorePaths, path)
  if (obj.ignoreInstallScripts !== undefined) {
    if (typeof obj.ignoreInstallScripts !== 'boolean') {
      throw new ConfigError(`${path} ignoreInstallScripts must be true or false`)
    }
    out.ignoreInstallScripts = obj.ignoreInstallScripts
  }
  if (obj.offline !== undefined) {
    if (obj.offline !== 'allow' && obj.offline !== 'warn' && obj.offline !== 'block') {
      throw new ConfigError(`${path} offline must be allow, warn, or block`)
    }
    out.offline = obj.offline
  }
  if (obj.registries !== undefined) {
    if (!obj.registries || typeof obj.registries !== 'object' || Array.isArray(obj.registries)) {
      throw new ConfigError(`${path} registries must be an object`)
    }
    const registries: SlopgateConfig['registries'] = {}
    for (const key of ['npm', 'pypi', 'crates', 'go'] as const) {
      const url = (obj.registries as Record<string, unknown>)[key]
      if (url === undefined) continue
      if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
        throw new ConfigError(`${path} registries.${key} must be an http or https URL`)
      }
      registries[key] = url
    }
    out.registries = registries
  }
  return out
}

function assignNumber(
  out: Partial<SlopgateConfig>,
  key: 'blockScore' | 'warnScore' | 'maxAgeDays' | 'minWeeklyDownloads' | 'typoDistance' | 'concurrency' | 'cacheTtlHours' | 'missingTtlMinutes',
  value: unknown,
  path: string,
): void {
  if (value === undefined) return
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ConfigError(`${path} ${key} must be a number`)
  }
  out[key] = value
}

function assignStringList(
  out: Partial<SlopgateConfig>,
  key: 'allow' | 'trustedScopes' | 'ignorePaths',
  value: unknown,
  path: string,
): void {
  if (value === undefined) return
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new ConfigError(`${path} ${key} must be a list of strings`)
  }
  out[key] = value
}

export function mergeConfig(base: SlopgateConfig, patch: Partial<SlopgateConfig>): SlopgateConfig {
  return {
    ...base,
    ...patch,
    allow: patch.allow ? unique([...base.allow, ...patch.allow]) : base.allow,
    trustedScopes: patch.trustedScopes ? unique([...base.trustedScopes, ...patch.trustedScopes]) : base.trustedScopes,
    ignorePaths: patch.ignorePaths ? unique([...base.ignorePaths, ...patch.ignorePaths]) : base.ignorePaths,
    registries: { ...base.registries, ...patch.registries },
  }
}

function clampConfig(config: SlopgateConfig): SlopgateConfig {
  const blockScore = clamp(config.blockScore, 1, 100)
  const warnScore = clamp(config.warnScore, 0, blockScore)
  return {
    ...config,
    blockScore,
    warnScore,
    maxAgeDays: Math.max(0, config.maxAgeDays),
    minWeeklyDownloads: Math.max(0, config.minWeeklyDownloads),
    typoDistance: clamp(config.typoDistance, 1, 3),
    concurrency: clamp(config.concurrency, 1, 32),
    cacheTtlHours: Math.max(0, config.cacheTtlHours),
    missingTtlMinutes: Math.max(0, config.missingTtlMinutes),
    offline: config.offline satisfies OfflinePolicy,
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}
