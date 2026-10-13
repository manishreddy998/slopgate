import { scoreRefs } from '../evaluate.js'
import { explainResults, formatReport } from '../explain.js'
import type { LookupContext } from '../registry/lookup.js'
import { ECOSYSTEMS, type Ecosystem } from '../types.js'
import { version } from '../version.js'

const PROTOCOL_VERSIONS = new Set(['2024-11-05', '2025-03-26', '2025-06-18'])

export type McpFraming = 'content-length' | 'ndjson'

export interface DecodedFrame {
  body: string
  framing: McpFraming
}

export function pushFrames(buffer: Buffer, chunk: Buffer): { frames: DecodedFrame[]; rest: Buffer } {
  let rest = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk])
  const frames: DecodedFrame[] = []
  while (rest.length > 0) {
    const next = takeFrame(rest)
    if (!next) break
    if (next.body.trim()) frames.push({ body: next.body, framing: next.framing })
    rest = next.rest
  }
  return { frames, rest }
}

export function encodeFrame(message: unknown, framing: McpFraming): string {
  const body = JSON.stringify(message)
  if (framing === 'ndjson') return `${body}\n`
  return `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`
}

export async function handleMcpMessage(raw: unknown, ctx: LookupContext): Promise<unknown | null> {
  if (!isRecord(raw)) return rpcError(null, -32600, 'Request must be a JSON object')
  const hasId = 'id' in raw
  const id = hasId ? jsonId(raw.id) : null
  const method = typeof raw.method === 'string' ? raw.method : ''
  if (!method) return hasId ? rpcError(id, -32600, 'Missing method') : null
  const params = isRecord(raw.params) ? raw.params : {}
  switch (method) {
    case 'initialize': {
      const requested = typeof params.protocolVersion === 'string' ? params.protocolVersion : '2024-11-05'
      return rpcResult(id, {
        protocolVersion: PROTOCOL_VERSIONS.has(requested) ? requested : '2024-11-05',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'slopgate', version },
        instructions:
          'Call check_package before installing a package. A block means the name is missing, brand new, or very close to a well-known package.',
      })
    }
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null
    case 'ping':
      return hasId ? rpcResult(id, {}) : null
    case 'tools/list':
      return rpcResult(id, { tools: [checkPackageTool()] })
    case 'tools/call':
      return rpcResult(id, await callTool(params, ctx))
    default:
      return hasId ? rpcError(id, -32601, `Unknown method ${method}`) : null
  }
}

export async function serveMcp(options: {
  input: AsyncIterable<Uint8Array | string> | Iterable<Uint8Array | string>
  write: (chunk: string) => void
  ctx: LookupContext
}): Promise<number> {
  let buffer: Buffer = Buffer.alloc(0)
  for await (const chunk of iterate(options.input)) {
    const data = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk)
    let parsed: { frames: DecodedFrame[]; rest: Buffer }
    try {
      parsed = pushFrames(buffer, data)
    } catch (error) {
      options.write(encodeFrame(rpcError(null, -32700, messageOf(error)), 'content-length'))
      buffer = Buffer.alloc(0)
      continue
    }
    buffer = parsed.rest
    for (const frame of parsed.frames) {
      let response: unknown | null
      try {
        response = await handleMcpMessage(JSON.parse(frame.body) as unknown, options.ctx)
      } catch (error) {
        response = rpcError(null, -32700, messageOf(error))
      }
      if (response !== null) options.write(encodeFrame(response, frame.framing))
    }
  }
  return 0
}

async function* iterate(
  input: AsyncIterable<Uint8Array | string> | Iterable<Uint8Array | string>,
): AsyncGenerator<Uint8Array | string> {
  if (Symbol.asyncIterator in input) {
    for await (const chunk of input) yield chunk
    return
  }
  for (const chunk of input) yield chunk
}

function checkPackageTool(): Record<string, unknown> {
  return {
    name: 'check_package',
    description:
      'Check one package name before installing it. Returns a score from 0 to 100, a result of allow, warn, or block, and the real package if this name looks like a typo.',
    inputSchema: {
      type: 'object',
      properties: {
        ecosystem: {
          type: 'string',
          enum: [...ECOSYSTEMS],
          description: 'Where the package lives: npm, pypi, cargo, or go. Defaults to npm.',
        },
        name: {
          type: 'string',
          description: 'Package or module name, such as pandas, react, or github.com/gin-gonic/gin.',
        },
      },
      required: ['name'],
      additionalProperties: false,
    },
  }
}

async function callTool(params: Record<string, unknown>, ctx: LookupContext): Promise<Record<string, unknown>> {
  const tool = typeof params.name === 'string' ? params.name : ''
  if (tool !== 'check_package') return toolError(`Unknown tool ${tool || '(missing)'}`)
  const args = isRecord(params.arguments) ? params.arguments : {}
  const packageName = typeof args.name === 'string' ? args.name.trim() : ''
  if (!packageName) return toolError('check_package needs a name')
  const ecosystemRaw = typeof args.ecosystem === 'string' && args.ecosystem.length > 0 ? args.ecosystem : 'npm'
  if (!(ECOSYSTEMS as readonly string[]).includes(ecosystemRaw)) {
    return toolError(`unknown package source ${ecosystemRaw}. Use npm, pypi, cargo, or go.`)
  }
  const ecosystem = ecosystemRaw as Ecosystem
  const [scored] = await scoreRefs(
    [{ ecosystem, name: packageName, raw: packageName, ignoreScripts: false, customRegistry: false }],
    ctx,
  )
  if (!scored) return toolError('check failed')
  const text = (scored.verdict === 'allow' ? formatReport([scored]) : explainResults([scored])).trim()
  return {
    content: [{ type: 'text', text }],
    structuredContent: {
      ecosystem: scored.ecosystem,
      name: scored.name,
      score: scored.score,
      verdict: scored.verdict,
      reasons: scored.reasons.map((reason) => ({ code: reason.code, weight: reason.weight, message: reason.message })),
      suggestions: scored.suggestions.map((suggestion) => ({ name: suggestion.name, reason: suggestion.reason })),
      offline: scored.offline,
    },
    isError: scored.verdict === 'block',
  }
}

function toolError(text: string): Record<string, unknown> {
  return { content: [{ type: 'text', text }], isError: true }
}

function rpcResult(id: string | number | null, result: unknown): Record<string, unknown> {
  return { jsonrpc: '2.0', id, result }
}

function rpcError(id: string | number | null, code: number, message: string): Record<string, unknown> {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

function jsonId(value: unknown): string | number | null {
  if (typeof value === 'string' || typeof value === 'number') return value
  return null
}

function takeFrame(buffer: Buffer): { body: string; framing: McpFraming; rest: Buffer } | null {
  let start = 0
  while (start < buffer.length && isSpace(buffer[start]!)) start++
  if (start >= buffer.length) return null
  const head = buffer.subarray(start, Math.min(buffer.length, start + 20)).toString('utf8').toLowerCase()
  if (head.startsWith('content-length')) return takeContentLength(buffer, start)
  return takeLine(buffer, start)
}

function takeContentLength(buffer: Buffer, start: number): { body: string; framing: McpFraming; rest: Buffer } | null {
  const crlf = indexOf(buffer, '\r\n\r\n', start)
  const lf = indexOf(buffer, '\n\n', start)
  let sep = -1
  let sepLength = 0
  if (crlf !== -1 && (lf === -1 || crlf <= lf)) {
    sep = crlf
    sepLength = 4
  } else if (lf !== -1) {
    sep = lf
    sepLength = 2
  } else {
    return null
  }
  const match = /content-length:\s*(\d+)/i.exec(buffer.subarray(start, sep).toString('utf8'))
  const length = match?.[1] ? Number(match[1]) : Number.NaN
  if (!Number.isInteger(length) || length < 0 || length > 1_000_000) {
    throw new Error('The Content-Length header is not a valid number')
  }
  const bodyStart = sep + sepLength
  if (buffer.length < bodyStart + length) return null
  return {
    body: buffer.subarray(bodyStart, bodyStart + length).toString('utf8'),
    framing: 'content-length',
    rest: Buffer.from(buffer.subarray(bodyStart + length)),
  }
}

function takeLine(buffer: Buffer, start: number): { body: string; framing: McpFraming; rest: Buffer } | null {
  const newline = buffer.indexOf(0x0a, start)
  if (newline === -1) return null
  return {
    body: buffer.subarray(start, newline).toString('utf8').trim(),
    framing: 'ndjson',
    rest: Buffer.from(buffer.subarray(newline + 1)),
  }
}

function indexOf(buffer: Buffer, needle: string, from: number): number {
  return buffer.indexOf(needle, from)
}

function isSpace(byte: number): boolean {
  return byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
