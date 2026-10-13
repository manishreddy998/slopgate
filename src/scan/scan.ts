import { readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'
import { scoreRefs } from '../evaluate.js'
import type { LookupContext } from '../registry/lookup.js'
import { worstVerdict } from '../risk/score.js'
import type { PackageRef, RiskResult, Verdict } from '../types.js'
import { extractRefs } from './extract.js'

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'vendor',
  'venv',
  '.venv',
  'target',
  'coverage',
  '.cache',
  '__pycache__',
])

const MAX_BYTES = 1_000_000

export interface ScanFinding {
  files: string[]
  result: RiskResult
}

export interface ScanReport {
  filesScanned: number
  findings: ScanFinding[]
  warnings: string[]
  verdict: Verdict
}

export async function scanProject(
  root: string,
  options: { ignore?: readonly string[]; ctx: LookupContext },
): Promise<ScanReport> {
  const abs = resolve(root)
  const info = statSync(abs)
  if (!info.isDirectory()) throw new Error(`${root} is not a directory`)
  const ignore = [...options.ctx.config.ignorePaths, ...(options.ignore ?? [])]
  const files = collectFiles(abs, ignore)
  const grouped = new Map<string, { ref: PackageRef; files: string[] }>()
  const warnings: string[] = []
  for (const file of files) {
    let text: string
    try {
      if (statSync(file).size > MAX_BYTES) {
        warnings.push(`Skipped ${relative(abs, file)} because it is larger than 1 MB.`)
        continue
      }
      text = readFileSync(file, 'utf8')
    } catch (error) {
      warnings.push(`Could not read ${relative(abs, file)}: ${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    const extracted = extractRefs(relative(abs, file), text)
    warnings.push(...extracted.warnings)
    for (const ref of extracted.refs) {
      const key = `${ref.ecosystem}:${ref.name}`
      const rel = relative(abs, file).split('\\').join('/')
      const existing = grouped.get(key)
      if (!existing) {
        grouped.set(key, { ref, files: [rel] })
        continue
      }
      if (!existing.files.includes(rel)) existing.files.push(rel)
      if (existing.ref.customRegistry && !ref.customRegistry) existing.ref = ref
    }
  }
  const entries = [...grouped.values()]
  const scored = await scoreRefs(
    entries.map((entry) => entry.ref),
    options.ctx,
  )
  const findings = entries
    .map((entry, index) => ({ files: entry.files, result: scored[index]! }))
    .sort((left, right) => rank(right.result.verdict) - rank(left.result.verdict) || left.result.name.localeCompare(right.result.name))
  const verdict = worstVerdict(findings.map((finding) => finding.result))
  return {
    filesScanned: files.length,
    findings,
    warnings,
    verdict: verdict === 'allow' && warnings.length > 0 ? 'warn' : verdict,
  }
}

export function formatScan(report: ScanReport): string {
  const lines: string[] = []
  if (report.findings.length === 0) {
    lines.push(`Scanned ${report.filesScanned} files. No package names found.`)
  } else {
    lines.push(`Scanned ${report.filesScanned} files, ${report.findings.length} packages.`, '')
    const flagged = report.findings.filter((finding) => finding.result.verdict !== 'allow')
    const detailed = flagged.length > 0 ? flagged : report.findings
    for (const finding of detailed) {
      lines.push(
        `${finding.result.name} (${finding.result.ecosystem}) — risk ${finding.result.score}/100 — ${finding.result.verdict}`,
      )
      lines.push(`  found in ${finding.files.join(', ')}`)
      for (const reason of finding.result.reasons) {
        if (reason.weight === 0 && reason.code === 'allowlisted') continue
        if (finding.result.verdict === 'allow') continue
        lines.push(`  • ${reason.message}`)
      }
      if (finding.result.verdict !== 'allow' && finding.result.suggestions.length > 0) {
        lines.push('  Closest real packages:')
        for (const suggestion of finding.result.suggestions) lines.push(`  • ${suggestion.name} — ${suggestion.reason}`)
      }
      lines.push('')
    }
    const allowed = report.findings.filter((finding) => finding.result.verdict === 'allow')
    if (flagged.length > 0 && allowed.length > 0) {
      lines.push(`Allowed: ${allowed.map((finding) => finding.result.name).join(', ')}`)
    }
  }
  for (const warning of report.warnings) lines.push(warning)
  return `${lines.join('\n').trim()}\n`
}

function collectFiles(root: string, ignore: readonly string[]): string[] {
  const found: string[] = []
  const walk = (dir: string): void => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const path = join(dir, entry.name)
      const rel = relative(root, path).split('\\').join('/')
      if (ignored(rel, ignore)) continue
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || directoryIgnored(rel, ignore)) continue
        walk(path)
        continue
      }
      if (entry.isFile() && isScanFile(rel)) found.push(path)
    }
  }
  walk(root)
  return found.sort()
}

function isScanFile(rel: string): boolean {
  const base = basename(rel)
  const lower = base.toLowerCase()
  if (['package.json', 'pyproject.toml', 'pipfile', 'cargo.toml', 'go.mod', '.cursorrules'].includes(lower)) return true
  if (['skill.md', 'claude.md', 'agents.md', 'agent.md'].includes(lower)) return true
  if (/^readme(\.|$)/i.test(base) || /^requirements.*\.txt$/i.test(base)) return true
  if ((rel === 'docs' || rel.startsWith('docs/') || rel.includes('/docs/')) && /\.(md|mdx|rst)$/i.test(base)) return true
  if (/(^|\/)skills\//.test(rel) && /\.(md|mdx)$/i.test(base)) return true
  if (/(^|\/)\.cursor\/rules\//.test(rel) && /\.(md|mdc|txt)$/i.test(base)) return true
  return false
}

export function ignored(rel: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => {
    const normalized = pattern.trim().replace(/\\/g, '/').replace(/^\.\//, '')
    if (!normalized) return false
    if (matchGlob(normalized, rel)) return true
    if (!normalized.includes('/')) return rel.split('/').some((segment) => matchGlob(normalized, segment))
    return false
  })
}

function directoryIgnored(rel: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => {
    const cleaned = pattern
      .trim()
      .replace(/\\/g, '/')
      .replace(/^\.\//, '')
      .replace(/\/\*\*$/, '')
    if (!cleaned || cleaned.includes('*') || cleaned.includes('?')) return false
    return rel === cleaned || rel.startsWith(`${cleaned}/`)
  })
}

function matchGlob(pattern: string, value: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  const source = escaped.replace(/\\\*\\\*/g, '.*').replace(/\\\*/g, '[^/]*').replace(/\\\?/g, '[^/]')
  return new RegExp(`^${source}$`, 'i').test(value)
}

function rank(verdict: Verdict): number {
  if (verdict === 'block') return 2
  if (verdict === 'warn') return 1
  return 0
}
