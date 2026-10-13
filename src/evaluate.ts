import { existsSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import { parseRequirementsTxt, parseShell } from './parse/command.js'
import { explainResults } from './explain.js'
import { lookupPackage, type LookupContext } from './registry/lookup.js'
import { scorePackage, worstVerdict } from './risk/score.js'
import type { PackageRef, RiskResult, Verdict } from './types.js'
import { mapPool } from './util.js'

const REQUIREMENTS_MAX_BYTES = 1_000_000

export interface Evaluation {
  relevant: boolean
  verdict: Verdict
  results: RiskResult[]
  text: string
}

export async function evaluateCommand(command: string, cwd: string, ctx: LookupContext): Promise<Evaluation> {
  const parsed = parseShell(command)
  if (parsed.packages.length === 0 && parsed.requirementFiles.length === 0) {
    return { relevant: false, verdict: 'allow', results: [], text: '' }
  }
  const refs = [...parsed.packages]
  const warnings: RiskResult[] = []
  for (const file of parsed.requirementFiles) {
    const loaded = loadRequirements(resolve(cwd), resolve(cwd, file.path), 0, new Set())
    refs.push(...loaded.packages)
    warnings.push(...loaded.warnings)
  }
  const results = [...warnings, ...(await scoreRefs(dedupe(refs), ctx))]
  const verdict = worstVerdict(results)
  return { relevant: true, verdict, results, text: explainResults(results) }
}

export async function scoreRefs(refs: readonly PackageRef[], ctx: LookupContext): Promise<RiskResult[]> {
  return mapPool(refs, ctx.config.concurrency, async (ref) => {
    const fact = await lookupPackage(ref.ecosystem, ref.name, ctx)
    return scorePackage({
      ecosystem: ref.ecosystem,
      name: ref.name,
      fact,
      config: ctx.config,
      ignoreScripts: ref.ignoreScripts,
      customRegistry: ref.customRegistry,
    })
  })
}

function dedupe(refs: readonly PackageRef[]): PackageRef[] {
  const map = new Map<string, PackageRef>()
  for (const ref of refs) {
    const key = `${ref.ecosystem}:${ref.name}`
    const previous = map.get(key)
    if (!previous || (previous.ignoreScripts && !ref.ignoreScripts)) map.set(key, ref)
  }
  return [...map.values()]
}

function loadRequirements(
  root: string,
  file: string,
  depth: number,
  seen: Set<string>,
): { packages: PackageRef[]; warnings: RiskResult[] } {
  if (depth > 4) return { packages: [], warnings: [] }
  if (!inside(root, file)) {
    return {
      packages: [],
      warnings: [
        warning(file, `Refusing to read ${file} because it is outside the workspace.`),
      ],
    }
  }
  if (seen.has(file)) return { packages: [], warnings: [] }
  seen.add(file)
  if (!existsSync(file) || !statSync(file).isFile()) {
    return { packages: [], warnings: [warning(file, `Could not read ${file}, so those packages were not checked.`)] }
  }
  const size = statSync(file).size
  if (size > REQUIREMENTS_MAX_BYTES) {
    return { packages: [], warnings: [warning(file, `${file} is too large to scan as a requirements file.`)] }
  }
  const parsed = parseRequirementsTxt(readFileSync(file, 'utf8'))
  const packages = [...parsed.packages]
  const warnings: RiskResult[] = []
  for (const nested of parsed.files) {
    const next = loadRequirements(root, resolve(file, '..', nested), depth + 1, seen)
    packages.push(...next.packages)
    warnings.push(...next.warnings)
  }
  return { packages, warnings }
}

function inside(root: string, target: string): boolean {
  if (!isAbsolute(target)) return false
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function warning(name: string, message: string): RiskResult {
  return {
    ecosystem: 'pypi',
    name,
    score: 40,
    verdict: 'warn',
    offline: false,
    suggestions: [],
    reasons: [{ code: 'requirements-file', weight: 40, message }],
  }
}
