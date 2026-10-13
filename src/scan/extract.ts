import { basename } from 'node:path'
import { normalizePypi, parseRequirementsTxt, parseShell } from '../parse/command.js'
import type { Ecosystem, PackageRef } from '../types.js'

export interface Extracted {
  refs: PackageRef[]
  warnings: string[]
}

const MANAGER =
  /\b(?:python3?\s+-m\s+pip|pip3|pnpm|bunx|npx|uvx|npm|yarn|bun|pip|uv|poetry|cargo|go)\b/

const STOP = new Set([
  'a',
  'an',
  'and',
  'are',
  'before',
  'by',
  'do',
  'for',
  'from',
  'if',
  'in',
  'into',
  'is',
  'it',
  'not',
  'of',
  'on',
  'or',
  'please',
  'so',
  'that',
  'the',
  'then',
  'this',
  'to',
  'using',
  'via',
  'we',
  'when',
  'with',
  'you',
  'your',
])

export function extractRefs(relativePath: string, text: string): Extracted {
  const base = basename(relativePath).toLowerCase()
  try {
    if (base === 'package.json') return { refs: refsFromPackageJson(text), warnings: [] }
    if (base === 'pyproject.toml') return { refs: refsFromPyproject(text), warnings: [] }
    if (base === 'pipfile') return { refs: refsFromPipfile(text), warnings: [] }
    if (base === 'cargo.toml') return { refs: refsFromCargo(text), warnings: [] }
    if (base === 'go.mod') return { refs: refsFromGoMod(text), warnings: [] }
    if (/^requirements.*\.txt$/.test(base)) return { refs: parseRequirementsTxt(text).packages, warnings: [] }
    return { refs: refsFromProse(text), warnings: [] }
  } catch (error) {
    return { refs: [], warnings: [`Could not parse ${relativePath}: ${error instanceof Error ? error.message : String(error)}`] }
  }
}

function refsFromProse(text: string): PackageRef[] {
  const fences: string[] = []
  const withoutFences = text.replace(/```[^\n]*\n([\s\S]*?)```/g, (_match, body: string) => {
    fences.push(body)
    return '\n'
  })
  const inlines: string[] = []
  const plain = withoutFences.replace(/`([^`\n]+)`/g, (_match, body: string) => {
    inlines.push(body)
    return ' '
  })
  const refs: PackageRef[] = []
  for (const chunk of [...fences, ...inlines, ...plain.split(/\r?\n/)]) {
    const command = clipToCommands(chunk)
    if (!command) continue
    refs.push(...parseShell(command).packages)
  }
  return refs
}

function clipToCommands(text: string): string {
  const parts = text.split(/(\s*(?:&&|\|\||;)\s*)/)
  const kept: string[] = []
  for (const part of parts) {
    if (/^\s*(?:&&|\|\||;)\s*$/.test(part)) {
      if (kept.length > 0) kept.push(part.trim())
      continue
    }
    const command = clipSegment(part)
    if (command) kept.push(command)
  }
  return kept.join(' ')
}

function clipSegment(segment: string): string {
  const cleaned = segment.trim().replace(/^[-*]\s+/, '').replace(/^[$>]\s+/, '')
  const match = MANAGER.exec(cleaned)
  if (match?.index === undefined) return ''
  const tokens = tokenizeQuoted(cleaned.slice(match.index))
  const kept: string[] = []
  for (const token of tokens) {
    const bare = token.replace(/^['"]|['"]$/g, '').toLowerCase()
    if (kept.length > 0 && STOP.has(bare)) break
    kept.push(token)
  }
  return kept.join(' ')
}

function tokenizeQuoted(text: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: "'" | '"' | '' = ''
  for (const char of text) {
    if (quote) {
      current += char
      if (char === quote) {
        tokens.push(current)
        current = ''
        quote = ''
      }
      continue
    }
    if (char === "'" || char === '"') {
      if (current) tokens.push(current)
      current = char
      quote = char
      continue
    }
    if (/\s/.test(char)) {
      if (current) tokens.push(current)
      current = ''
      continue
    }
    current += char
  }
  if (current) tokens.push(current)
  return tokens
}

function refsFromPackageJson(text: string): PackageRef[] {
  const parsed = JSON.parse(text) as unknown
  if (!isRecord(parsed)) return []
  const refs: PackageRef[] = []
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    const deps = parsed[section]
    if (!isRecord(deps)) continue
    for (const [name, spec] of Object.entries(deps)) {
      if (typeof spec !== 'string' || nonRegistrySpec(spec)) continue
      const real = spec.startsWith('npm:') ? aliasName(spec) : name
      const ref = npmRef(real ?? '', `${name}@${spec}`)
      if (ref) refs.push(ref)
    }
  }
  return refs
}

function refsFromPyproject(text: string): PackageRef[] {
  return refsFromTomlTables(text, (section) => {
    if (section === 'project' || section === 'project.optional-dependencies') return 'strings'
    if (/^tool\.poetry\.(dependencies|dev-dependencies)$/.test(section)) return 'keys'
    if (/^tool\.poetry\.group\.[^.]+\.dependencies$/.test(section)) return 'keys'
    return null
  })
}

function refsFromPipfile(text: string): PackageRef[] {
  return refsFromTomlTables(text, (section) => (section === 'packages' || section === 'dev-packages' ? 'keys' : null))
}

function refsFromCargo(text: string): PackageRef[] {
  const refs: PackageRef[] = []
  let section = ''
  let dep = false
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim()
    const header = /^\[([^\]]+)\]$/.exec(line)
    if (header?.[1]) {
      section = header[1].replace(/["']/g, '').trim()
      dep = /(^|\.)(dependencies|dev-dependencies|build-dependencies)$/.test(section)
      continue
    }
    if (!dep || !line || line.startsWith('[')) continue
    const key = /^([A-Za-z0-9_-]+)\s*=/.exec(line)
    if (!key?.[1] || key[1] === 'workspace') continue
    const custom = /\bgit\s*=/.test(line) || /\bpath\s*=/.test(line)
    refs.push(ref('cargo', key[1].toLowerCase(), line, custom))
  }
  return refs
}

function refsFromGoMod(text: string): PackageRef[] {
  const refs: PackageRef[] = []
  let mode: 'none' | 'require' | 'skip' = 'none'
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\/\/.*$/, '').trim()
    if (!line) continue
    if (line === ')') {
      mode = 'none'
      continue
    }
    if (/^require\s*\(/.test(line)) {
      mode = 'require'
      continue
    }
    const single = /^require\s+(\S+)/.exec(line)
    if (single?.[1]) {
      pushGo(refs, single[1])
      continue
    }
    if (/^(exclude|replace|retract)\b/.test(line)) {
      mode = line.endsWith('(') ? 'skip' : 'none'
      continue
    }
    if (mode === 'require') pushGo(refs, line.split(/\s+/)[0] ?? '')
  }
  return refs
}

function refsFromTomlTables(text: string, classify: (section: string) => 'strings' | 'keys' | null): PackageRef[] {
  const refs: PackageRef[] = []
  let mode: 'strings' | 'keys' | null = null
  let inArray = false
  const flushStrings = (chunk: string): void => {
    for (const match of chunk.matchAll(/"([^"]+)"|'([^']+)'/g)) {
      const spec = match[1] ?? match[2] ?? ''
      const name = pep508Name(spec)
      if (name && name.toLowerCase() !== 'python') refs.push(ref('pypi', normalizePypi(name), spec, false))
    }
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split('#')[0] ?? ''
    const trimmed = line.trim()
    const header = /^\[([^\]]+)\]$/.exec(trimmed)
    if (header?.[1]) {
      mode = classify(header[1].trim())
      inArray = false
      continue
    }
    if (mode === 'strings') {
      const array = /^(?:dependencies|[A-Za-z0-9_-]+)\s*=\s*\[(.*)$/.exec(trimmed)
      if (array?.[1] !== undefined) {
        flushStrings(array[1])
        inArray = !array[1].includes(']')
        continue
      }
      if (inArray) {
        flushStrings(trimmed)
        if (trimmed.includes(']')) inArray = false
      }
      continue
    }
    if (mode === 'keys') {
      const key = /^([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)\s*=/.exec(trimmed)
      if (!key?.[1] || key[1].toLowerCase() === 'python') continue
      refs.push(ref('pypi', normalizePypi(key[1]), trimmed, false))
    }
  }
  return refs
}

function pep508Name(spec: string): string | null {
  const match = /^([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)/.exec(spec.trim())
  return match?.[1] ?? null
}

function pushGo(refs: PackageRef[], token: string): void {
  if (!token || token === ')') return
  if (!token.includes('.') || token.startsWith('./') || token.endsWith('/...')) return
  refs.push(ref('go', token, token, false))
}

function npmRef(name: string, raw: string): PackageRef | null {
  const normalized = name.toLowerCase()
  if (normalized.startsWith('@')) {
    if (!/^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/.test(normalized)) return null
  } else if (!/^[a-z0-9][a-z0-9._-]*$/.test(normalized)) {
    return null
  }
  return ref('npm', normalized, raw, false)
}

function aliasName(spec: string): string | null {
  const body = spec.slice('npm:'.length)
  if (body.startsWith('@')) {
    const slash = body.indexOf('/')
    if (slash <= 1) return null
    const at = body.indexOf('@', slash + 1)
    return at === -1 ? body : body.slice(0, at)
  }
  const at = body.indexOf('@')
  return (at === -1 ? body : body.slice(0, at)) || null
}

function nonRegistrySpec(spec: string): boolean {
  return /^(file:|link:|git\+|github:|gitlab:|bitbucket:|http:|https:|workspace:|portal:|\.)/.test(spec)
}

function ref(ecosystem: Ecosystem, name: string, raw: string, customRegistry: boolean): PackageRef {
  return { ecosystem, name, raw, ignoreScripts: false, customRegistry }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
