import type { Ecosystem, PackageFact, Reason, RiskResult, SlopgateConfig, Suggestion, Verdict } from '../types.js'
import { analyzeName, type NameAnalysis } from './typo.js'
import { compareKey } from './popular.js'

const PLACEHOLDER =
  /placeholder|dependency confusion|do not install|don't install|not a real package|typosquat|slopsquat|security holding/i

const patternCache = new Map<string, RegExp>()

export function scorePackage(input: {
  ecosystem: Ecosystem
  name: string
  fact: PackageFact
  config: SlopgateConfig
  ignoreScripts?: boolean
  customRegistry?: boolean
  analysis?: NameAnalysis
}): RiskResult {
  const analysis = input.analysis ?? analyzeName(input.ecosystem, input.name, input.config.typoDistance)
  const base = {
    ecosystem: input.ecosystem,
    name: input.fact.name || input.name,
    offline: input.fact.offline,
    suggestions: [] as Suggestion[],
  }

  if (isAllowlisted(input.name, input.ecosystem, input.config)) {
    return { ...base, score: 0, verdict: 'allow', reasons: [reason('allowlisted', 0, 'This name is on your slopgate allow list.')] }
  }

  if (input.fact.exists === false && input.customRegistry) {
    return finish(base, input.config, analysis, [
      reason(
        'custom-registry',
        40,
        'This name is not on the public package site. The command uses another registry, a git URL, or a folder path, so this is a warning, not a block.',
      ),
    ])
  }

  if (input.fact.exists === false) {
    return finish(base, input.config, analysis, [
      reason(
        'not-found',
        100,
        `No package named ${input.name} is on the public ${registryLabel(input.ecosystem)} site. Tools often make up names like this. Installing one is how a fake package gets in.`,
      ),
    ])
  }

  if (input.fact.exists === null) {
    if (analysis.popular) {
      return {
        ...base,
        score: 0,
        verdict: 'allow',
        offline: true,
        reasons: [reason('popular', 0, 'The package site did not answer, but this is a well-known package.')],
      }
    }
    if (analysis.strong.length > 0) {
      return finish(
        { ...base, offline: true },
        input.config,
        analysis,
        [
          reason(
            'typosquat',
            80,
            `The package site did not answer, and ${input.name} is ${analysis.strong[0]?.reason ?? 'very close to a well-known package'}.`,
          ),
        ],
        true,
      )
    }
    if (input.config.offline === 'allow') {
      return { ...base, score: 0, verdict: 'allow', offline: true, reasons: [reason('offline', 0, 'The package site did not answer. Your offline setting is allow, so this is allowed.')] }
    }
    const weight = input.config.offline === 'block' ? 70 : 45
    return finish(
      { ...base, offline: true },
      input.config,
      analysis,
      [reason('offline', weight, 'The package site did not answer, so this name was not checked. Your offline setting is ' + input.config.offline + '.')],
      true,
    )
  }

  if (analysis.popular) {
    return {
      ...base,
      score: 0,
      verdict: 'allow',
      reasons: [reason('popular', 0, 'This is a well-known package.')],
    }
  }

  const reasons: Reason[] = []
  const age = ageReason(input.fact, input.config)
  if (age) reasons.push(age)
  const downloads = downloadReason(input.fact, input.config)
  if (downloads) reasons.push(downloads)
  if (input.fact.versionCount === 1) {
    reasons.push(reason('single-version', 12, 'Only one version has been published.'))
  }
  if (input.fact.repository === null) {
    reasons.push(reason('missing-repo', 14, 'The listing has no link to source code.'))
  }
  if (input.fact.description === null) {
    reasons.push(reason('missing-description', 5, 'The listing has no description.'))
  }
  if (input.fact.license === null) {
    reasons.push(reason('missing-license', 5, 'The listing has no license.'))
  }
  if (
    input.fact.installScripts.length > 0 &&
    !input.ignoreScripts &&
    !input.config.ignoreInstallScripts
  ) {
    reasons.push(
      reason(
        'install-script',
        18,
        `It has an install script (${input.fact.installScripts.join(', ')}). That script runs code as soon as you install the package.`,
      ),
    )
  }
  if (input.fact.description && PLACEHOLDER.test(input.fact.description)) {
    reasons.push(
      reason(
        'placeholder',
        30,
        `The owner says this is a placeholder ("${truncate(input.fact.description, 120)}"), not a package you should install.`,
      ),
    )
  }
  const strong = analysis.strong[0]
  if (strong) {
    const weight = strong.reason.startsWith('two letter changes') ? 35 : 55
    reasons.push(reason('typosquat', weight, `The name is ${strong.reason}.`))
  }

  let score = reasons.reduce((sum, item) => sum + item.weight, 0)
  if (strong && !downloadsLookEstablished(input.fact)) score = Math.max(score, 70)
  return finish(base, input.config, analysis, reasons, false, score)
}

export function isAllowlisted(name: string, ecosystem: Ecosystem, config: SlopgateConfig): boolean {
  const key = compareKey(ecosystem, name)
  if (config.allow.some((pattern) => matches(pattern, name) || matches(pattern, key))) return true
  return config.trustedScopes.some((scope) => {
    const normalized = scope.toLowerCase().replace(/\/$/, '')
    return key === normalized || key.startsWith(`${normalized}/`) || name.startsWith(`${scope}/`)
  })
}

export function verdictFor(score: number, config: SlopgateConfig): Verdict {
  if (score >= config.blockScore) return 'block'
  if (score >= config.warnScore) return 'warn'
  return 'allow'
}

export function worstVerdict(results: readonly RiskResult[]): Verdict {
  if (results.some((result) => result.verdict === 'block')) return 'block'
  if (results.some((result) => result.verdict === 'warn')) return 'warn'
  return 'allow'
}

function finish(
  base: { ecosystem: Ecosystem; name: string; offline: boolean; suggestions: Suggestion[] },
  config: SlopgateConfig,
  analysis: NameAnalysis,
  reasons: Reason[],
  lockScore = false,
  preset?: number,
): RiskResult {
  const score = lockScore ? reasons.reduce((sum, item) => sum + item.weight, 0) : (preset ?? reasons.reduce((sum, item) => sum + item.weight, 0))
  const capped = Math.max(0, Math.min(100, score))
  const verdict = verdictFor(capped, config)
  const suggestions = verdict === 'allow' ? [] : [...analysis.strong, ...analysis.weak].slice(0, 3)
  return { ...base, score: capped, verdict, reasons, suggestions }
}

function ageReason(fact: PackageFact, config: SlopgateConfig): Reason | null {
  if (fact.ageDays === undefined) return null
  const days = fact.ageDays
  const pretty = days < 1 ? 'less than a day' : `${Math.floor(days)} day${Math.floor(days) === 1 ? '' : 's'}`
  if (days < 2) return reason('too-new', 45, `Published ${pretty} ago.`)
  if (days < 7) return reason('too-new', 34, `Published ${pretty} ago.`)
  if (days < config.maxAgeDays) return reason('too-new', 18, `Published ${pretty} ago. That is inside the ${config.maxAgeDays}-day window for new packages.`)
  return null
}

function downloadReason(fact: PackageFact, config: SlopgateConfig): Reason | null {
  if (typeof fact.weeklyDownloads === 'number') {
    const weekly = fact.weeklyDownloads
    if (weekly === 0) {
      return reason('low-downloads', 36, `No downloads in the last week. The minimum is ${config.minWeeklyDownloads}.`)
    }
    if (weekly < 10) return reason('low-downloads', 28, `Only ${formatCount(weekly)} downloads in the last week.`)
    if (weekly < config.minWeeklyDownloads) {
      return reason('low-downloads', 18, `${formatCount(weekly)} downloads in the last week. That is under the minimum of ${config.minWeeklyDownloads}.`)
    }
    if (weekly < 1000) return reason('low-downloads', 6, `${formatCount(weekly)} downloads in the last week.`)
    return null
  }
  if (typeof fact.recentDownloads === 'number') {
    const recent = fact.recentDownloads
    if (recent === 0) return reason('low-downloads', 36, 'No recent downloads on crates.io.')
    if (recent < 50) return reason('low-downloads', 28, `Only ${formatCount(recent)} recent downloads on crates.io.`)
    if (recent < Math.max(500, config.minWeeklyDownloads * 5)) {
      return reason('low-downloads', 18, `${formatCount(recent)} recent downloads on crates.io.`)
    }
    return null
  }
  if (typeof fact.totalDownloads === 'number') {
    const total = fact.totalDownloads
    if (total < 100) return reason('low-downloads', 30, `Only ${formatCount(total)} downloads in total.`)
    if (total < 1000) return reason('low-downloads', 16, `${formatCount(total)} downloads in total.`)
  }
  return null
}

function downloadsLookEstablished(fact: PackageFact): boolean {
  if (typeof fact.weeklyDownloads === 'number' && fact.weeklyDownloads >= 1000) return true
  if (typeof fact.recentDownloads === 'number' && fact.recentDownloads >= 5000) return true
  if (typeof fact.totalDownloads === 'number' && fact.totalDownloads >= 100_000) return true
  return false
}

function matches(pattern: string, value: string): boolean {
  let compiled = patternCache.get(pattern)
  if (!compiled) {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')
    compiled = new RegExp(`^${escaped}$`, 'i')
    patternCache.set(pattern, compiled)
  }
  return compiled.test(value)
}

function reason(code: string, weight: number, message: string): Reason {
  return { code, weight, message }
}

function registryLabel(ecosystem: Ecosystem): string {
  switch (ecosystem) {
    case 'npm':
      return 'npm'
    case 'pypi':
      return 'PyPI'
    case 'cargo':
      return 'crates.io'
    case 'go':
      return 'Go module'
  }
}

function truncate(value: string, max: number): string {
  const flat = value.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`
}

function formatCount(value: number): string {
  return new Intl.NumberFormat('en-US').format(value)
}
