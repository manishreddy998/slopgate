#!/usr/bin/env node
import { version } from './version.js'

const HELP = `slopgate ${version}
Stop AI coding agents from installing hallucinated packages.

Usage
  slopgate init [--global] [--only claude,cursor,codex,gemini] [--no-mcp] [--no-install]
  slopgate scan [dir] [--json] [--fail-on block|warn|none] [--ignore glob]
  slopgate check <package...> [--ecosystem npm|pypi|cargo|go] [--json]
  slopgate hook [--client claude|cursor|codex|gemini|auto] [--command <shell>]
  slopgate mcp

No telemetry. Registry requests stay between you and the registry.
`

function main(): void {
  const args = process.argv.slice(2)
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    process.stdout.write(HELP)
    return
  }
  if (args.includes('--version') || args.includes('-v')) {
    process.stdout.write(`${version}\n`)
    return
  }
  process.stderr.write(`slopgate: unknown command ${args[0] ?? ''}\n\n${HELP}`)
  process.exitCode = 2
}

main()
