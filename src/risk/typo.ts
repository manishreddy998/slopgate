import type { Ecosystem } from '../types.js'
import type { Suggestion } from '../types.js'
import { collapseRepeats, damerau, homoglyphKey, separatorKey, sharedPrefixLength } from './distance.js'
import { compareKey, popularEntries, popularEntry, type PopularEntry } from './popular.js'

export interface NameAnalysis {
  popular: boolean
  strong: Suggestion[]
  weak: Suggestion[]
}

export function analyzeName(ecosystem: Ecosystem, name: string, maxDistance: number): NameAnalysis {
  const key = compareKey(ecosystem, name)
  if (popularEntry(ecosystem, name)) return { popular: true, strong: [], weak: [] }

  const strong: Array<Suggestion & { rank: number }> = []
  const weak: Array<Suggestion & { rank: number }> = []
  const stripped = separatorKey(key)
  const glyph = homoglyphKey(key)
  const collapsed = collapseRepeats(key)
  const segments = key.split('/')
  const lastSegment = segments[segments.length - 1] ?? key
  const parent = segments.slice(0, -1).join('/')

  for (const entry of popularEntries(ecosystem)) {
    const edit = editMatch(key, entry, maxDistance)
    if (edit) {
      strong.push({ name: entry.name, reason: edit.reason, score: edit.score, rank: entry.rank })
      continue
    }
    if (glyph === entry.homoglyph && key !== entry.key && key.length >= 4) {
      strong.push({
        name: entry.name,
        reason: `uses lookalike characters for ${entry.name}`,
        score: 96,
        rank: entry.rank,
      })
      continue
    }
    if (stripped === entry.stripped && key !== entry.key && stripped.length >= 5) {
      strong.push({
        name: entry.name,
        reason: `same name as ${entry.name} aside from - _ . separators`,
        score: 90,
        rank: entry.rank,
      })
      continue
    }
    if (collapsed === entry.collapsed && key !== entry.key && collapsed.length >= 4 && key.length >= 5) {
      strong.push({
        name: entry.name,
        reason: `repeated letters collapse to ${entry.name}`,
        score: 88,
        rank: entry.rank,
      })
      continue
    }
    if (ecosystem === 'go' && parent && parent === entry.parent && lastSegment.length >= 3) {
      const segmentDistance = damerau(lastSegment, entry.lastSegment, 1)
      if (segmentDistance === 1) {
        strong.push({
          name: entry.name,
          reason: `module path is one edit from ${entry.name}`,
          score: 94,
          rank: entry.rank,
        })
        continue
      }
    }
    const resemblance = weakScore(key, entry)
    if (resemblance >= 40) {
      weak.push({
        name: entry.name,
        reason: resemblanceReason(key, entry),
        score: resemblance,
        rank: entry.rank,
      })
    }
  }

  strong.sort(byScore)
  weak.sort(byScore)
  return {
    popular: false,
    strong: strong.slice(0, 3).map(stripRank),
    weak: weak.slice(0, 3).map(stripRank),
  }
}

function editMatch(key: string, entry: PopularEntry, maxDistance: number): { score: number; reason: string } | null {
  if (key.length < 4 || entry.key.length < 4) return null
  const distance = damerau(key, entry.key, maxDistance)
  if (distance === 1) {
    return { score: 100 - entry.rank / 1000, reason: `one edit from ${entry.name}` }
  }
  if (
    distance === 2 &&
    maxDistance >= 2 &&
    key.length >= 6 &&
    entry.key.length >= 6 &&
    key[0] === entry.key[0] &&
    Math.abs(key.length - entry.key.length) <= 1
  ) {
    return { score: 70 - entry.rank / 1000, reason: `two edits from ${entry.name}` }
  }
  return null
}

function weakScore(key: string, entry: PopularEntry): number {
  let score = 0
  for (const token of key.split(/[^a-z0-9]+/i)) {
    if (token.length < 6) continue
    if (entry.key.includes(token)) score += token.length * token.length
  }
  const prefix = sharedPrefixLength(key, entry.key)
  if (prefix >= 8 && prefix < key.length && prefix < entry.key.length) score += prefix * prefix
  return score
}

function resemblanceReason(key: string, entry: PopularEntry): string {
  const prefix = sharedPrefixLength(key, entry.key)
  if (prefix >= 8) return `shares a long prefix with ${entry.name}`
  const token = key.split(/[^a-z0-9]+/i).find((part) => part.length >= 6 && entry.key.includes(part))
  if (token) return `contains "${token}", the distinctive part of ${entry.name}`
  return `resembles ${entry.name}`
}

function byScore(left: Suggestion & { rank: number }, right: Suggestion & { rank: number }): number {
  return right.score - left.score || left.rank - right.rank
}

function stripRank(suggestion: Suggestion & { rank: number }): Suggestion {
  return { name: suggestion.name, reason: suggestion.reason, score: suggestion.score }
}
