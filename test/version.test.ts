import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { version, packageName } from '../src/version.js'

describe('version', () => {
  it('matches package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      name: string
      version: string
    }
    expect(version).toBe(pkg.version)
    expect(packageName).toBe('@slop-gate/cli')
    expect(packageName).toBe(pkg.name)
    expect(version).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
