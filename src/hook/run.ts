import { loadConfig, ConfigError } from '../config.js'
import { DiskCache, defaultCachePath } from '../cache.js'
import { evaluateCommand } from '../evaluate.js'
import type { LookupContext } from '../registry/lookup.js'
import {
  commandFromInput,
  cwdFromInput,
  detectClient,
  formatHookOutput,
  parseClient,
  type HookClient,
} from './format.js'

export interface HookRunOptions {
  stdin: string
  command?: string
  client?: string
  cwd?: string
  env?: NodeJS.ProcessEnv
  ctx?: Partial<LookupContext>
}

export interface HookRunResult {
  stdout: string
  stderr: string
  exitCode: number
}

export async function runHook(options: HookRunOptions): Promise<HookRunResult> {
  const env = options.env ?? process.env
  const failClosed = env.SLOPGATE_FAIL_CLOSED === '1'
  try {
    const direct = options.command?.trim()
    let client: HookClient = parseClient(options.client) === 'auto' ? 'claude' : (parseClient(options.client) as HookClient)
    let cwd = options.cwd || process.cwd()
    let command = direct ?? ''
    if (!direct) {
      const raw = options.stdin.trim()
      if (!raw) return allow(client)
      let input: Record<string, unknown>
      try {
        const parsed = JSON.parse(raw) as unknown
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('expected an object')
        input = parsed as Record<string, unknown>
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (failClosed) return { stdout: '', stderr: `slopgate: could not parse hook input (${message})\n`, exitCode: 2 }
        return { stdout: '', stderr: `slopgate: ignoring unreadable hook input (${message})\n`, exitCode: 0 }
      }
      client = detectClient(input, parseClient(options.client))
      cwd = cwdFromInput(input, cwd)
      command = commandFromInput(input, client)
    }
    if (!command.trim()) return allow(client)

    const config = options.ctx?.config ?? loadConfig(cwd, env)
    const evaluation = await evaluateCommand(command, cwd, {
      config,
      cache: options.ctx?.cache ?? new DiskCache(defaultCachePath(env)),
      ...(options.ctx?.fetchImpl ? { fetchImpl: options.ctx.fetchImpl } : {}),
      ...(options.ctx?.now ? { now: options.ctx.now } : {}),
    })
    if (!evaluation.relevant || evaluation.verdict === 'allow') return allow(client)
    return { stdout: formatHookOutput(client, evaluation.verdict, evaluation.text), stderr: '', exitCode: 0 }
  } catch (error) {
    const message = error instanceof ConfigError || error instanceof Error ? error.message : String(error)
    if (failClosed) return { stdout: '', stderr: `slopgate: ${message}\n`, exitCode: 2 }
    return { stdout: '', stderr: `slopgate: ${message}\n`, exitCode: 0 }
  }
}

function allow(client: HookClient): HookRunResult {
  return { stdout: formatHookOutput(client, 'allow', ''), stderr: '', exitCode: 0 }
}
