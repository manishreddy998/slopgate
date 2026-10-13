export const ECOSYSTEMS = ['npm', 'pypi', 'cargo', 'go'] as const

export type Ecosystem = (typeof ECOSYSTEMS)[number]

export type Verdict = 'allow' | 'warn' | 'block'

export type OfflinePolicy = 'allow' | 'warn' | 'block'

export interface PackageRef {
  ecosystem: Ecosystem
  name: string
  /** The name as typed, including extra features and version marks. */
  raw: string
  version?: string
  ignoreScripts: boolean
  /** A git URL, a folder path, or a package site that is not the public one. A miss there does not prove the name is fake. */
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
  /** True if the package site has it. False if the site said it is missing. Null if the site did not answer. */
  exists: boolean | null
  createdAt?: string
  ageDays?: number
  /** Null means we asked for a download count and got no number. Undefined means we did not ask. */
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
  /** Higher means a closer match. */
  score: number
}

export interface Reason {
  code: string
  /** Points added to the 0–100 score. Zero means the line is only an explanation. */
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
