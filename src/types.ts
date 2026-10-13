export const ECOSYSTEMS = ['npm', 'pypi', 'cargo', 'go'] as const

export type Ecosystem = (typeof ECOSYSTEMS)[number]

export type Verdict = 'allow' | 'warn' | 'block'

export type OfflinePolicy = 'allow' | 'warn' | 'block'

export interface PackageRef {
  ecosystem: Ecosystem
  name: string
  /** Specifier as written, including extras and version operators. */
  raw: string
  version?: string
  ignoreScripts: boolean
  /** Git URL, path, or a non-default registry. Missing on the public index is not proof of a hallucination. */
  customRegistry: boolean
}

export interface ParsedCommand {
  manager?: string
  packages: PackageRef[]
  requirementFiles: Array<{ ecosystem: Ecosystem; path: string }>
}

export interface PackageFact {
  ecosystem: Ecosystem
  name: string
  /** True when the registry has it, false when the registry confirmed a miss, null when the registry could not be reached. */
  exists: boolean | null
  createdAt?: string
  ageDays?: number
  /** Null means the downloads endpoint was asked and had no number. Undefined means we did not ask. */
  weeklyDownloads?: number | null
  recentDownloads?: number | null
  totalDownloads?: number | null
  description?: string | null
  repository?: string | null
  license?: string | null
  installScripts: string[]
  versionCount?: number
  latestVersion?: string
  fromCache: boolean
  stale: boolean
  offline: boolean
  error?: string
}

export interface Suggestion {
  name: string
  reason: string
  /** Higher is a closer match. */
  score: number
}

export interface Reason {
  code: string
  /** Contribution to the 0–100 risk score. Zero means the line is explanatory only. */
  weight: number
  message: string
}

export interface RiskResult {
  ecosystem: Ecosystem
  name: string
  score: number
  verdict: Verdict
  reasons: Reason[]
  suggestions: Suggestion[]
  offline: boolean
}

export interface SlopgateConfig {
  blockScore: number
  warnScore: number
  maxAgeDays: number
  minWeeklyDownloads: number
  typoDistance: number
  allow: string[]
  trustedScopes: string[]
  offline: OfflinePolicy
  ignoreInstallScripts: boolean
  concurrency: number
  cacheTtlHours: number
  missingTtlMinutes: number
  ignorePaths: string[]
  registries: {
    npm?: string
    pypi?: string
    crates?: string
    go?: string
  }
}
