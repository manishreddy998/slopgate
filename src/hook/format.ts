export type HookClient = 'claude' | 'cursor' | 'codex' | 'gemini'

export function parseClient(value: string | undefined): HookClient | 'auto' {
  if (value === 'claude' || value === 'cursor' || value === 'codex' || value === 'gemini' || value === 'auto') {
    return value
  }
  return 'auto'
}

export function detectClient(input: Record<string, unknown>, requested: HookClient | 'auto'): HookClient {
  if (requested !== 'auto') return requested
  const toolName = typeof input.tool_name === 'string' ? input.tool_name : ''
  const event = typeof input.hook_event_name === 'string' ? input.hook_event_name : ''
  if (toolName === 'run_shell_command' || event === 'BeforeTool') return 'gemini'
  if (typeof input.command === 'string' && input.tool_input === undefined && input.tool_name === undefined) return 'cursor'
  return 'claude'
}

export function commandFromInput(input: Record<string, unknown>, client: HookClient): string {
  if (client === 'cursor') return stringField(input.command)
  const toolInput = input.tool_input
  if (typeof toolInput === 'string') {
    try {
      const parsed = JSON.parse(toolInput) as unknown
      if (parsed && typeof parsed === 'object' && 'command' in parsed) {
        return stringField((parsed as { command: unknown }).command)
      }
    } catch {
      return toolInput
    }
  }
  if (toolInput && typeof toolInput === 'object' && 'command' in toolInput) {
    return stringField((toolInput as { command: unknown }).command)
  }
  return stringField(input.command)
}

export function cwdFromInput(input: Record<string, unknown>, fallback: string): string {
  return stringField(input.cwd) || fallback
}

export function formatHookOutput(client: HookClient, verdict: 'allow' | 'warn' | 'block', text: string): string {
  if (client === 'cursor') return `${JSON.stringify(cursorPayload(verdict, text))}\n`
  if (client === 'gemini') return geminiPayload(verdict, text)
  return claudePayload(verdict, text)
}

function claudePayload(verdict: 'allow' | 'warn' | 'block', text: string): string {
  if (verdict === 'allow') return ''
  if (verdict === 'warn') {
    return `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: text.trim(),
      },
    })}\n`
  }
  return `${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: text.trim(),
    },
  })}\n`
}

function cursorPayload(verdict: 'allow' | 'warn' | 'block', text: string): Record<string, string> {
  if (verdict === 'allow') return { permission: 'allow' }
  const message = text.trim()
  if (verdict === 'warn') return { permission: 'allow', user_message: message, agent_message: message }
  return { permission: 'deny', user_message: message, agent_message: message }
}

function geminiPayload(verdict: 'allow' | 'warn' | 'block', text: string): string {
  if (verdict === 'allow') return ''
  if (verdict === 'warn') return `${JSON.stringify({ additionalContext: text.trim() })}\n`
  return `${JSON.stringify({ decision: 'deny', reason: text.trim() })}\n`
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
