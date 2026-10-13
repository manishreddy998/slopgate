import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isDirectEntry } from '../src/entry.js'

const root = join(import.meta.dirname, '..')
const cliJs = join(root, 'dist', 'cli.js')

function buildCli(): void {
  const tsc = join(root, 'node_modules', '.bin', 'tsc')
  const built = spawnSync(tsc, ['-p', 'tsconfig.json'], { cwd: root, encoding: 'utf8' })
  expect(built.status, built.stdout + built.stderr).toBe(0)
  chmodSync(cliJs, 0o755)
}

describe('entry path', () => {
  it('treats a symlink and the real file as the same entry', () => {
    const dir = mkdtempSync(join(tmpdir(), 'slopgate-entry-'))
    const real = join(dir, 'cli.js')
    const link = join(dir, 'slopgate')
    writeFileSync(real, '')
    writeFileSync(join(dir, 'other.js'), '')
    symlinkSync(real, link)
    expect(isDirectEntry(link, real)).toBe(true)
    expect(isDirectEntry(real, real)).toBe(true)
    expect(isDirectEntry(undefined, real)).toBe(false)
    expect(isDirectEntry(join(dir, 'other.js'), real)).toBe(false)
  })

  it('falls back to the literal path when the file is missing', () => {
    const missing = join(tmpdir(), `slopgate-missing-${Date.now()}`, 'cli.js')
    expect(isDirectEntry(missing, missing)).toBe(true)
    expect(isDirectEntry(missing, join(tmpdir(), 'somewhere-else.js'))).toBe(false)
  })
})

describe('npm bin', () => {
  it('runs through node on a symlink and by executing the symlink', () => {
    buildCli()
    const prefix = mkdtempSync(join(tmpdir(), 'slopgate-prefix-'))
    const packageDir = join(prefix, 'lib', 'node_modules', '@slop-gate', 'cli', 'dist')
    mkdirSync(packageDir, { recursive: true })
    symlinkSync(cliJs, join(packageDir, 'cli.js'))
    const binDir = join(prefix, 'bin')
    mkdirSync(binDir)
    const bin = join(binDir, 'slopgate')
    symlinkSync(join('..', 'lib', 'node_modules', '@slop-gate', 'cli', 'dist', 'cli.js'), bin)

    const viaNode = spawnSync(process.execPath, [bin, '--version'], { encoding: 'utf8' })
    expect(viaNode.status, viaNode.stderr).toBe(0)
    expect(viaNode.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/)

    const direct = spawnSync(bin, ['--version'], { encoding: 'utf8' })
    expect(direct.status, direct.stderr).toBe(0)
    expect(direct.stdout.trim()).toBe(viaNode.stdout.trim())
    expect(dirname(bin)).toBe(binDir)
  })
})
