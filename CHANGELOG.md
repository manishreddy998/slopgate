# Changelog

## 0.1.1

- The program runs when npm starts it through a bin symlink, including `npx` and a global install.
- `init` adds `@slop-gate/cli` as a dev dependency. Hooks and the MCP server call `npx -y @slop-gate/cli`.
