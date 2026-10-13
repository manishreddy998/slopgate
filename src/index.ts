export { version } from './version.js'
export { commandInstallsPackages, normalizePypi, parseRequirementsTxt, parseShell } from './parse/command.js'
export { DEFAULT_CONFIG, loadConfig } from './config.js'
export { lookupPackage } from './registry/lookup.js'
export type { LookupContext } from './registry/lookup.js'
export type {
  Ecosystem,
  OfflinePolicy,
  PackageFact,
  PackageRef,
  ParsedCommand,
  Reason,
  RiskResult,
  SlopgateConfig,
  Suggestion,
  Verdict,
} from './types.js'
