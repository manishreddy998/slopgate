import type { Ecosystem, PackageRef, ParsedCommand } from '../types.js'
import { commandBase, normalizeScript, splitSegments, stripWrappers, tokenize } from './shell.js'

export interface FlagSpec {
  boolean: string[]
  value: string[]
  shortBoolean: string[]
  shortValue: string[]
}

interface Walked {
  positionals: string[]
  boolean: Set<string>
  values: Map<string, string[]>
}

interface Leading {
  sub?: string
  rest: string[]
  boolean: Set<string>
  values: Map<string, string[]>
}

const NPM_INSTALL_FLAGS: FlagSpec = {
  boolean: [
    'save',
    'save-dev',
    'save-exact',
    'save-optional',
    'save-prod',
    'global',
    'ignore-scripts',
    'no-save',
    'legacy-peer-deps',
    'strict-peer-deps',
    'package-lock',
    'no-package-lock',
    'dry-run',
    'silent',
    'quiet',
    'json',
    'yes',
    'prefer-offline',
    'prefer-online',
    'no-optional',
    'foreground-scripts',
    'dev',
    'exact',
    'optional',
    'peer',
    'offline',
    'frozen-lockfile',
    'lockfile-only',
    'no-frozen-lockfile',
    'ignore-workspace-root-check',
    'recursive',
    'production',
  ],
  value: [
    'registry',
    'prefix',
    'cache',
    'userconfig',
    'globalconfig',
    'script-shell',
    'workspace',
    'omit',
    'include',
    'install-strategy',
    'cpu',
    'os',
    'libc',
    'tag',
    'scope',
    'before',
    'save-prefix',
    'filter',
    'dir',
    'cwd',
    'config',
  ],
  shortBoolean: ['D', 'S', 'E', 'g', 'q', 'P', 'O', 's', 'd', 'f', 'y'],
  shortValue: ['w', 'C', 'F'],
}

const NPX_FLAGS: FlagSpec = {
  boolean: [
    'yes',
    'no',
    'quiet',
    'ignore-existing',
    'no-install',
    'shell',
    'ignore-scripts',
    'offline',
    'prefer-offline',
  ],
  value: [
    'package',
    'call',
    'cache',
    'registry',
    'npm',
    'node-arg',
    'node-options',
    'prefix',
    'userconfig',
    'cwd',
    'dir',
    'from',
    'with',
    'python',
    'index-url',
    'filter',
  ],
  shortBoolean: ['y', 'q', 's'],
  shortValue: ['p', 'c'],
}

const PIP_FLAGS: FlagSpec = {
  boolean: [
    'upgrade',
    'user',
    'pre',
    'no-deps',
    'ignore-installed',
    'quiet',
    'break-system-packages',
    'dry-run',
    'no-cache-dir',
    'force-reinstall',
    'compile',
    'no-compile',
    'no-input',
    'disable-pip-version-check',
  ],
  value: [
    'requirement',
    'constraint',
    'target',
    'index-url',
    'extra-index-url',
    'find-links',
    'prefix',
    'root',
    'src',
    'upgrade-strategy',
    'config-settings',
    'editable',
    'python-version',
    'implementation',
    'platform',
    'dest',
    'index',
    'group',
    'script',
    'constraints',
  ],
  shortBoolean: ['U', 'q'],
  shortValue: ['r', 'c', 't', 'i', 'f', 'e'],
}

const POETRY_FLAGS: FlagSpec = {
  boolean: ['dev', 'optional', 'lock', 'dry-run', 'sync', 'no-sync'],
  value: ['group', 'extras', 'source', 'platform', 'python', 'editable'],
  shortBoolean: ['D', 'q'],
  shortValue: ['G', 'E', 'e'],
}

const CARGO_FLAGS: FlagSpec = {
  boolean: [
    'dev',
    'build',
    'optional',
    'locked',
    'force',
    'no-default-features',
    'all-features',
    'quiet',
    'offline',
    'dry-run',
  ],
  value: [
    'version',
    'vers',
    'features',
    'git',
    'branch',
    'tag',
    'rev',
    'path',
    'registry',
    'index',
    'target',
    'root',
    'profile',
    'rename',
  ],
  shortBoolean: ['q', 'D', 'F'],
  shortValue: [],
}

const EMPTY: ParsedCommand = { packages: [], requirementFiles: [] }

export function parseShell(script: string): ParsedCommand {
  const packages: PackageRef[] = []
  const requirementFiles: ParsedCommand['requirementFiles'] = []
  let manager: string | undefined
  for (const segment of splitSegments(normalizeScript(script))) {
    const tokens = stripWrappers(tokenize(segment))
    if (tokens.length === 0) continue
    const parsed = parseCommand(tokens)
    if (!parsed) continue
    if (parsed.packages.length === 0 && parsed.requirementFiles.length === 0) continue
    manager ??= parsed.manager
    packages.push(...parsed.packages)
    requirementFiles.push(...parsed.requirementFiles)
  }
  return { manager, packages, requirementFiles }
}

export function commandInstallsPackages(script: string): boolean {
  const parsed = parseShell(script)
  return parsed.packages.length > 0 || parsed.requirementFiles.length > 0
}

function parseCommand(tokens: string[]): ParsedCommand | null {
  let base = commandBase(tokens[0] ?? '')
  let args = tokens.slice(1)

  if (
    (base === 'python' || base === 'python3' || base === 'python2' || base === 'py') &&
    args[0] === '-m' &&
    (args[1] === 'pip' || args[1] === 'pip3')
  ) {
    base = 'pip'
    args = args.slice(2)
  }

  switch (base) {
    case 'npm':
      return parseNpm(args)
    case 'pnpm':
      return parsePnpm(args)
    case 'yarn':
      return parseYarn(args)
    case 'bun':
      return parseBun(args)
    case 'npx':
    case 'bunx':
      return finish(base, jsPackages(args, 'npx'))
    case 'pip':
    case 'pip3':
      return parsePip(args, base)
    case 'uv':
      return parseUv(args)
    case 'uvx':
      return finish('uvx', pypiNpx(args))
    case 'poetry':
      return parsePoetry(args)
    case 'cargo':
      return parseCargo(args)
    case 'go':
      return parseGo(args)
    default:
      return null
  }
}

function finish(manager: string, body: Omit<ParsedCommand, 'manager'>): ParsedCommand {
  return { manager, ...body }
}

function parseNpm(args: string[]): ParsedCommand | null {
  const leading = splitLeading(args, new Set(['prefix', 'registry', 'cache', 'userconfig', 'cwd']))
  if (!leading.sub) return null
  const merged = prependLeading(leading)
  if (['install', 'i', 'add', 'update', 'up'].includes(leading.sub)) {
    return finish('npm', { ...EMPTY, ...jsPackages(merged, 'many') })
  }
  if (leading.sub === 'exec' || leading.sub === 'x') {
    return finish('npm', { ...EMPTY, ...jsPackages(merged, 'npx') })
  }
  return null
}

function parsePnpm(args: string[]): ParsedCommand | null {
  const leading = splitLeading(args, new Set(['dir', 'filter', 'cwd', 'registry', 'prefix']))
  if (!leading.sub) return null
  const merged = prependLeading(leading)
  if (['add', 'update', 'up'].includes(leading.sub)) return finish('pnpm', jsPackages(merged, 'many'))
  if (leading.sub === 'dlx' || leading.sub === 'exec' || leading.sub === 'x') {
    return finish('pnpm', jsPackages(merged, 'npx'))
  }
  return null
}

function parseYarn(args: string[]): ParsedCommand | null {
  const leading = splitLeading(args, new Set(['cwd', 'prefix']))
  if (!leading.sub) return null
  if (leading.sub === 'global') {
    const next = leading.rest[0]
    if (next !== 'add') return null
    return finish('yarn', jsPackages(leading.rest.slice(1), 'many'))
  }
  if (leading.sub === 'add' || leading.sub === 'up' || leading.sub === 'upgrade') {
    return finish('yarn', jsPackages(prependLeading(leading), 'many'))
  }
  if (leading.sub === 'dlx') return finish('yarn', jsPackages(leading.rest, 'npx'))
  if (leading.sub === 'create') {
    const walked = walk(leading.rest, NPX_FLAGS)
    const name = walked.positionals[0]
    if (!name) return finish('yarn', EMPTY)
    const pkgName = name.startsWith('create-') ? name : `create-${name}`
    const pkg = npmPackage(pkgName, false, false)
    return finish('yarn', { packages: pkg ? [pkg] : [], requirementFiles: [] })
  }
  return null
}

function parseBun(args: string[]): ParsedCommand | null {
  const leading = splitLeading(args, new Set(['cwd', 'config', 'filter', 'registry']))
  if (!leading.sub) return null
  const merged = prependLeading(leading)
  if (leading.sub === 'add' || leading.sub === 'update') return finish('bun', jsPackages(merged, 'many'))
  if (leading.sub === 'x') return finish('bun', jsPackages(leading.rest, 'npx'))
  return null
}

function parseUv(args: string[]): ParsedCommand | null {
  const sub = args[0]
  if (sub === 'pip') return parsePip(args.slice(1), 'uv')
  if (sub === 'add') return finish('uv', uvAdd(args.slice(1)))
  if (sub === 'tool' && (args[1] === 'install' || args[1] === 'run')) {
    return finish('uv', pypiNpx(args.slice(2)))
  }
  if (sub === 'x') return finish('uv', pypiNpx(args.slice(1)))
  return null
}

function parsePip(args: string[], manager: string): ParsedCommand | null {
  if (args[0] !== 'install') return null
  const walked = walk(args.slice(1), PIP_FLAGS)
  const index = first(walked, 'index-url') ?? first(walked, 'i') ?? first(walked, 'index')
  const custom = Boolean(index && !/pypi\.org/i.test(index))
  const packages: PackageRef[] = []
  for (const positional of walked.positionals) {
    const pkg = pypiPackage(positional, custom)
    if (pkg) packages.push(pkg)
  }
  for (const editable of values(walked, 'editable', 'e')) {
    const pkg = pypiPackage(editable, true)
    if (pkg) packages.push(pkg)
  }
  const files = values(walked, 'requirement', 'r')
  return finish(manager, {
    packages,
    requirementFiles: files.map((path) => ({ ecosystem: 'pypi' as const, path })),
  })
}

function uvAdd(args: string[]): Omit<ParsedCommand, 'manager'> {
  const walked = walk(args, PIP_FLAGS)
  const index = first(walked, 'index-url') ?? first(walked, 'index')
  const custom = Boolean(index && !/pypi\.org/i.test(index))
  const packages = walked.positionals
    .map((positional) => pypiPackage(positional, custom))
    .filter((pkg): pkg is PackageRef => pkg !== null)
  return { packages, requirementFiles: [] }
}

function pypiNpx(args: string[]): Omit<ParsedCommand, 'manager'> {
  const walked = walk(args, NPX_FLAGS)
  const from = values(walked, 'from', 'with', 'package', 'p')
  const index = first(walked, 'index-url')
  const custom = Boolean(index && !/pypi\.org/i.test(index))
  const specs = from.length > 0 ? from : walked.positionals.slice(0, 1)
  const packages = specs
    .map((spec) => pypiPackage(spec, custom))
    .filter((pkg): pkg is PackageRef => pkg !== null)
  return { packages, requirementFiles: [] }
}

function parsePoetry(args: string[]): ParsedCommand | null {
  if (args[0] !== 'add') return null
  const walked = walk(args.slice(1), POETRY_FLAGS)
  const packages: PackageRef[] = []
  for (const positional of walked.positionals) {
    const pkg = poetryPackage(positional, false)
    if (pkg) packages.push(pkg)
  }
  for (const editable of values(walked, 'editable', 'e')) {
    const pkg = poetryPackage(editable, true)
    if (pkg && !editable.startsWith('.') && !editable.startsWith('/')) packages.push(pkg)
  }
  return finish('poetry', { packages, requirementFiles: [] })
}

function parseCargo(args: string[]): ParsedCommand | null {
  const sub = args[0]
  if (sub !== 'add' && sub !== 'install') return null
  const walked = walk(args.slice(1), CARGO_FLAGS)
  const custom = walked.values.has('git') || walked.values.has('path')
  const flagged = first(walked, 'version') ?? first(walked, 'vers')
  const packages = walked.positionals
    .map((positional) => cargoPackage(positional, flagged, custom))
    .filter((pkg): pkg is PackageRef => pkg !== null)
  return finish('cargo', { packages, requirementFiles: [] })
}

function parseGo(args: string[]): ParsedCommand | null {
  const sub = args[0]
  if (sub !== 'get' && sub !== 'install') return null
  const positionals: string[] = []
  for (let i = 1; i < args.length; i++) {
    const tok = args[i]!
    if (tok === '--') {
      positionals.push(...args.slice(i + 1))
      break
    }
    if (tok.startsWith('-')) continue
    positionals.push(tok)
  }
  const packages = positionals
    .map((positional) => goPackage(positional))
    .filter((pkg): pkg is PackageRef => pkg !== null)
  return finish('go', { packages, requirementFiles: [] })
}

function jsPackages(args: string[], mode: 'many' | 'npx'): Omit<ParsedCommand, 'manager'> {
  const walked = walk(args, mode === 'npx' ? NPX_FLAGS : NPM_INSTALL_FLAGS)
  const ignoreScripts = walked.boolean.has('ignore-scripts')
  const registry = first(walked, 'registry')
  const custom = Boolean(registry && !/registry\.npmjs\.org/i.test(registry))
  let specs: string[]
  if (mode === 'npx') {
    const packaged = values(walked, 'package', 'p')
    if (packaged.length > 0) specs = packaged
    else specs = walked.positionals.slice(0, 1)
  } else {
    specs = walked.positionals
  }
  const packages = specs
    .map((spec) => npmPackage(spec, ignoreScripts, custom))
    .filter((pkg): pkg is PackageRef => pkg !== null)
  return { packages, requirementFiles: [] }
}

export function parseRequirementsTxt(text: string): { packages: PackageRef[]; files: string[] } {
  const packages: PackageRef[] = []
  const files: string[] = []
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/(^|\s)#.*/, '').trim()
    if (!line) continue
    if (line.startsWith('-r ') || line.startsWith('--requirement ') || line.startsWith('--requirement=')) {
      files.push(requirementPath(line))
      continue
    }
    if (line.startsWith('-c ') || line.startsWith('--constraint ') || line.startsWith('--constraint=')) {
      const spec = line.includes('=') && !line.startsWith('-c ') ? line.slice(line.indexOf('=') + 1) : line.split(/\s+/).slice(1).join(' ')
      const pkg = pypiPackage(spec, false)
      if (pkg) packages.push(pkg)
      continue
    }
    if (line.startsWith('-e ') || line.startsWith('--editable ') || line.startsWith('--editable=')) {
      const spec = argAfter(line)
      const pkg = pypiPackage(spec, true)
      if (pkg) packages.push(pkg)
      continue
    }
    if (line.startsWith('-')) continue
    const pkg = pypiPackage(line, false)
    if (pkg) packages.push(pkg)
  }
  return { packages, files: files.filter(Boolean) }
}

function requirementPath(line: string): string {
  if (line.includes('=')) return line.slice(line.indexOf('=') + 1).trim()
  return line.split(/\s+/).slice(1).join(' ').trim()
}

function argAfter(line: string): string {
  if (line.includes('=')) return line.slice(line.indexOf('=') + 1).trim()
  return line.split(/\s+/).slice(1).join(' ').trim()
}

export function normalizePypi(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, '-')
}

function npmPackage(raw: string, ignoreScripts: boolean, customRegistry: boolean): PackageRef | null {
  if (!raw || isPathSpec(raw) || isUrlSpec(raw)) return null
  let spec = raw
  const aliasAt = spec.indexOf('@npm:')
  if (aliasAt > 0) spec = spec.slice(aliasAt + '@npm:'.length)
  const split = splitNpm(spec)
  if (!split) return null
  return {
    ecosystem: 'npm',
    name: split.name.toLowerCase(),
    raw,
    ...(split.version !== undefined ? { version: split.version } : {}),
    ignoreScripts,
    customRegistry,
  }
}

function splitNpm(spec: string): { name: string; version?: string } | null {
  if (spec.startsWith('@')) {
    const slash = spec.indexOf('/')
    if (slash <= 1) return null
    const at = spec.indexOf('@', slash + 1)
    const name = (at === -1 ? spec : spec.slice(0, at)).toLowerCase()
    const version = at === -1 ? undefined : spec.slice(at + 1)
    if (!/^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/.test(name)) return null
    return version === undefined ? { name } : { name, version }
  }
  const at = spec.indexOf('@')
  const name = (at === -1 ? spec : spec.slice(0, at)).toLowerCase()
  const version = at === -1 ? undefined : spec.slice(at + 1)
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(name)) return null
  return version === undefined ? { name } : { name, version }
}

function pypiPackage(raw: string, customRegistry: boolean): PackageRef | null {
  const trimmed = raw.trim()
  if (!trimmed || trimmed.startsWith('-') || isPathSpec(trimmed)) return null
  if (/^(git\+|hg\+|svn\+|bzr\+|https?:|ssh:|file:)/i.test(trimmed)) return null
  const noMarker = (trimmed.split(';')[0] ?? trimmed).trim()
  const direct = noMarker.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)\s*@\s*(\S+)/)
  if (direct?.[1]) {
    return {
      ecosystem: 'pypi',
      name: normalizePypi(direct[1]),
      raw,
      ...(direct[2] !== undefined ? { version: direct[2] } : {}),
      ignoreScripts: false,
      customRegistry: true,
    }
  }
  const matched = noMarker.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?\s*(.*)$/)
  if (!matched?.[1]) return null
  const version = matched[2]?.trim()
  return {
    ecosystem: 'pypi',
    name: normalizePypi(matched[1]),
    raw,
    ...(version ? { version } : {}),
    ignoreScripts: false,
    customRegistry,
  }
}

function poetryPackage(raw: string, customRegistry: boolean): PackageRef | null {
  if (!raw || isPathSpec(raw) || raw.includes('://')) return null
  const matched = raw.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?(?:@(.+))?$/)
  if (!matched?.[1]) return null
  return {
    ecosystem: 'pypi',
    name: normalizePypi(matched[1]),
    raw,
    ...(matched[2] !== undefined ? { version: matched[2] } : {}),
    ignoreScripts: false,
    customRegistry,
  }
}

function cargoPackage(raw: string, flaggedVersion: string | undefined, customRegistry: boolean): PackageRef | null {
  if (!raw || isPathSpec(raw) || raw.includes('://')) return null
  const at = raw.indexOf('@')
  const name = at === -1 ? raw : raw.slice(0, at)
  const version = at === -1 ? flaggedVersion : raw.slice(at + 1)
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name)) return null
  return {
    ecosystem: 'cargo',
    name,
    raw,
    ...(version !== undefined ? { version } : {}),
    ignoreScripts: false,
    customRegistry,
  }
}

function goPackage(raw: string): PackageRef | null {
  if (!raw || raw === 'all' || raw === '.' || isPathSpec(raw) || raw.endsWith('/...')) return null
  if (raw.startsWith('http://') || raw.startsWith('https://')) return null
  let name = raw
  let version: string | undefined
  const at = raw.lastIndexOf('@')
  if (at > 0) {
    name = raw.slice(0, at)
    version = raw.slice(at + 1)
  }
  if (!name.includes('.')) return null
  return {
    ecosystem: 'go',
    name,
    raw,
    ...(version !== undefined ? { version } : {}),
    ignoreScripts: false,
    customRegistry: false,
  }
}

function isPathSpec(spec: string): boolean {
  return spec === '.' || spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('/') || spec.startsWith('~')
}

function isUrlSpec(spec: string): boolean {
  return /^(git\+|git:|github:|gitlab:|bitbucket:|file:|link:|workspace:|portal:|patch:|https?:|ssh:)/i.test(spec)
}

function walk(args: string[], spec: FlagSpec): Walked {
  const value = new Set(spec.value)
  const shortValue = new Set(spec.shortValue)
  const positionals: string[] = []
  const boolean = new Set<string>()
  const values = new Map<string, string[]>()

  for (let i = 0; i < args.length; i++) {
    const tok = args[i]!
    if (tok === '--') {
      positionals.push(...args.slice(i + 1))
      break
    }
    if (tok.startsWith('--')) {
      const body = tok.slice(2)
      const eq = body.indexOf('=')
      const name = eq === -1 ? body : body.slice(0, eq)
      if (!name) continue
      if (eq !== -1) {
        pushValue(values, name, body.slice(eq + 1))
        continue
      }
      if (value.has(name)) {
        const next = args[i + 1]
        if (next !== undefined && !next.startsWith('-')) {
          pushValue(values, name, next)
          i++
        }
        continue
      }
      boolean.add(name)
      continue
    }
    if (tok.startsWith('-') && tok.length > 1) {
      const letters = tok.slice(1)
      for (let c = 0; c < letters.length; c++) {
        const letter = letters[c]!
        if (shortValue.has(letter)) {
          const rest = letters.slice(c + 1)
          if (rest) pushValue(values, letter, rest)
          else if (args[i + 1] !== undefined && !args[i + 1]!.startsWith('-')) {
            pushValue(values, letter, args[++i]!)
          }
          break
        }
        boolean.add(letter)
      }
      continue
    }
    positionals.push(tok)
  }
  return { positionals, boolean, values }
}

function splitLeading(args: string[], valueFlags: Set<string>): Leading {
  const boolean = new Set<string>()
  const values = new Map<string, string[]>()
  for (let i = 0; i < args.length; i++) {
    const tok = args[i]!
    if (!tok.startsWith('-') || tok === '-') {
      return { sub: tok, rest: args.slice(i + 1), boolean, values }
    }
    if (tok === '--') return { rest: args.slice(i + 1), boolean, values }
    if (tok.startsWith('--')) {
      const body = tok.slice(2)
      const eq = body.indexOf('=')
      const name = eq === -1 ? body : body.slice(0, eq)
      if (!name) continue
      if (eq !== -1) {
        pushValue(values, name, body.slice(eq + 1))
        continue
      }
      if (valueFlags.has(name) && args[i + 1] !== undefined && !args[i + 1]!.startsWith('-')) {
        pushValue(values, name, args[++i]!)
        continue
      }
      boolean.add(name)
      continue
    }
    boolean.add(tok.slice(1))
  }
  return { rest: [], boolean, values }
}

function prependLeading(leading: Leading): string[] {
  const out: string[] = []
  for (const flag of leading.boolean) out.push(flag.length === 1 ? `-${flag}` : `--${flag}`)
  for (const [key, list] of leading.values) {
    for (const value of list) out.push(`--${key}`, value)
  }
  return [...out, ...leading.rest]
}

function pushValue(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

function values(walked: Walked, ...keys: string[]): string[] {
  const out: string[] = []
  for (const key of keys) {
    const list = walked.values.get(key)
    if (list) out.push(...list)
  }
  return out
}

function first(walked: Walked, key: string): string | undefined {
  return walked.values.get(key)?.[0]
}

export function ecosystemOf(name: string): Ecosystem | undefined {
  if (name === 'npm' || name === 'pypi' || name === 'cargo' || name === 'go') return name
  return undefined
}
