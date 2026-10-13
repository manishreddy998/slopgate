import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * True when this module is the process entry point.
 * npm bins are symlinks, so the path in argv and the module path can differ
 * until both are resolved.
 */
export function isDirectEntry(entry: string | undefined, modulePath: string): boolean {
  if (entry === undefined) return false
  try {
    return realpathSync(entry) === realpathSync(modulePath)
  } catch {
    return resolve(entry) === modulePath
  }
}
