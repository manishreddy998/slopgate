/** Split a shell script into simple commands and words. Quotes are kept. This is not a full shell. */

export function normalizeScript(input: string): string {
  return input.replace(/\\\r?\n/g, ' ').replace(/\r\n/g, '\n')
}

export function splitSegments(input: string): string[] {
  const segments: string[] = []
  let current = ''
  let quote: "'" | '"' | '`' | null = null

  const push = (): void => {
    if (current.trim()) segments.push(current.trim())
    current = ''
  }

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!
    if (quote) {
      current += ch
      if (ch === '\\' && quote !== "'" && i + 1 < input.length) {
        current += input[++i]!
        continue
      }
      if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch
      current += ch
      continue
    }
    if (ch === '#') {
      while (i + 1 < input.length && input[i + 1] !== '\n') i++
      continue
    }
    if (ch === '\n' || ch === ';') {
      push()
      continue
    }
    if (ch === '&') {
      push()
      if (input[i + 1] === '&') i++
      continue
    }
    if (ch === '|') {
      push()
      if (input[i + 1] === '|') i++
      continue
    }
    current += ch
  }
  push()
  return segments
}

export function tokenize(segment: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: "'" | '"' | null = null

  const push = (): void => {
    if (current.length > 0) tokens.push(current)
    current = ''
  }

  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i]!
    if (quote) {
      if (ch === '\\' && quote === '"' && i + 1 < segment.length) {
        current += segment[++i]!
        continue
      }
      if (ch === quote) {
        quote = null
        continue
      }
      current += ch
      continue
    }
    if (ch === '\\' && i + 1 < segment.length) {
      current += segment[++i]!
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      continue
    }
    if (ch === ' ' || ch === '\t' || ch === '\n') {
      push()
      continue
    }
    current += ch
  }
  push()
  return tokens
}

const WRAPPERS = new Set(['sudo', 'command', 'env', 'time', 'nohup'])

const SUDO_VALUE_FLAGS = new Set([
  '-u',
  '-g',
  '--user',
  '--group',
  '--prompt',
  '-p',
  '--chdir',
  '-D',
  '--role',
  '-r',
  '--preserve-env',
  '-E',
])

export function commandBase(command: string): string {
  const base = command.split(/[/\\]/).pop() ?? command
  return base.replace(/\.(cmd|exe|bat)$/i, '').toLowerCase()
}

/** Skip environment assignments and wrappers like sudo, so the real command starts at the package tool. */
export function stripWrappers(tokens: string[]): string[] {
  let i = 0
  while (i < tokens.length) {
    const tok = tokens[i]!
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tok)) {
      i++
      continue
    }
    const base = commandBase(tok)
    if (!WRAPPERS.has(base)) break
    i++
    if (base !== 'sudo' && base !== 'env') continue
    while (i < tokens.length && tokens[i]!.startsWith('-')) {
      const flag = tokens[i]!
      i++
      const name = flag.split('=')[0]!
      if (SUDO_VALUE_FLAGS.has(name) && !flag.includes('=') && i < tokens.length && !tokens[i]!.startsWith('-')) {
        i++
      }
    }
  }
  return tokens.slice(i)
}
