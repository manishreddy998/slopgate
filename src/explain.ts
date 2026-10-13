import type { RiskResult, Verdict } from './types.js'
import { worstVerdict } from './risk/score.js'

export function explainResults(results: readonly RiskResult[]): string {
  const flagged = results.filter((result) => result.verdict !== 'allow')
  if (flagged.length === 0) return ''
  const blocked = flagged.some((result) => result.verdict === 'block')
  const lines = [
    blocked
      ? 'slopgate blocked this install.'
      : 'slopgate warning. The install can continue. Read this first.',
    '',
  ]
  for (const result of flagged) {
    lines.push(`${result.name} (${result.ecosystem}) — risk ${result.score}/100 — ${result.verdict}`)
    for (const item of result.reasons) {
      if (item.weight === 0 && item.code === 'allowlisted') continue
      lines.push(`  • ${item.message}`)
    }
    if (result.suggestions.length > 0) {
      lines.push('  Closest real packages:')
      for (const suggestion of result.suggestions) {
        lines.push(`  • ${suggestion.name} — ${suggestion.reason}`)
      }
    }
    lines.push('')
  }
  lines.push(
    'If one of these is the package you wanted, install that. To allow a private name, add it under allow or trustedScopes in slopgate.config.json.',
  )
  return `${lines.join('\n').trim()}\n`
}

export function summarize(results: readonly RiskResult[]): { verdict: Verdict; text: string } {
  return { verdict: worstVerdict(results), text: explainResults(results) }
}

/** Text for `slopgate check`. Safe packages stay on one line. Blocks and warnings include the full note. */
export function formatReport(results: readonly RiskResult[]): string {
  if (results.length === 0) return 'No packages to check.\n'
  if (results.every((result) => result.verdict === 'allow')) {
    return `${results.map((result) => `${result.name} (${result.ecosystem}) — risk ${result.score}/100 — allow`).join('\n')}\n`
  }
  return explainResults(results)
}
