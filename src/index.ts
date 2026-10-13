export { version } from './version.js'
export { commandInstallsPackages, normalizePypi, parseRequirementsTxt, parseShell } from './parse/command.js'
export { DEFAULT_CONFIG, loadConfig } from './config.js'
export { lookupPackage } from './registry/lookup.js'
export type { LookupContext } from './registry/lookup.js'
export { evaluateCommand } from './evaluate.js'
export { scanProject } from './scan/scan.js'
export { explainResults } from './explain.js'
export { scorePackage } from './risk/score.js'
export { analyzeName } from './risk/typo.js'
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
