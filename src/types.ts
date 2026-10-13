export const ECOSYSTEMS = ['npm', 'pypi', 'cargo', 'go'] as const

export type Ecosystem = (typeof ECOSYSTEMS)[number]

export type Verdict = 'allow' | 'warn' | 'block'

export type OfflinePolicy = 'allow' | 'warn' | 'block'

export interface PackageRef {
  ecosystem: Ecosystem
  name: string
  /** Specifier as written, including extras and version ranges. */
  raw: string
  version?: string
  ignoreScripts: boolean
  /** Git URL, path, or a non-default registry. A public-registry miss is not decisive. */
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
  /** True when the registry has the name, false on a confirmed miss, null when the registry did not respond. */
  exists: boolean | null
  createdAt?: string
  ageDays?: number
  /** Null means the downloads endpoint returned no count. Undefined means it was not queried. */
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
  /** Points added to the 0–100 score. Zero marks an explanatory line. */
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
