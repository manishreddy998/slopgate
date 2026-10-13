import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runHook } from '../src/hook/run.js'

const live = process.env.SLOPGATE_LIVE === '1'

describe.skipIf(!live)('live registry', () => {
  it('blocks npm install react-codeshift and allows npm install react', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'slopgate-live-'))
    const env = { SLOPGATE_CACHE: join(cwd, 'cache.json') }
    const blocked = await runHook({
      stdin: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'npm install react-codeshift' } }),
      client: 'claude',
      cwd,
      env,
    })
    expect(blocked.exitCode).toBe(0)
    const decision = JSON.parse(blocked.stdout) as {
      hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string }
    }
    expect(decision.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(decision.hookSpecificOutput.permissionDecisionReason).toContain('react-codeshift')
    expect(decision.hookSpecificOutput.permissionDecisionReason).toContain('jscodeshift')

    const allowed = await runHook({
      stdin: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'npm install react' } }),
      client: 'claude',
      cwd,
      env,
    })
    expect(allowed.stdout).toBe('')
    expect(allowed.exitCode).toBe(0)

    const cli = join(process.cwd(), 'dist', 'cli.js')
    expect(existsSync(cli)).toBe(true)
    const spawned = spawnSync(
      process.execPath,
      [cli, 'hook', '--client', 'claude', '--command', 'npm install react-codeshift'],
      { cwd, env: { ...process.env, ...env }, encoding: 'utf8' },
    )
    expect(spawned.status).toBe(0)
    expect(spawned.stdout).toContain('"permissionDecision":"deny"')
    expect(spawned.stdout).toContain('react-codeshift')
  }, 30_000)
})
