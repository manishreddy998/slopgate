# slopgate

Stop an AI coding tool before it installs a package that is not real.

These tools invent package names. They also mistype real names, and they copy `npx` lines out of generated skill files. slopgate checks the name first. A missing package is blocked. A very new name, a name almost nobody uses, or a name that looks like a famous package comes back with a score and a short note the tool can read.

```bash
npx slopgate init
```

That one line is the setup after this package is on npm. From a copy of this repo:

```bash
npm install
npm run build
node dist/cli.js init
node dist/cli.js check react-codeshift
node dist/cli.js check react
```

![slopgate blocks react-codeshift and allows react](docs/demo.svg)

This picture is real output from the public npm site on 13 October 2026. `check` exits 1 when it blocks. The Claude Code hook prints a deny decision and exits 0, because that is how Claude Code wants a block. `npm install react` is allowed. The same text is in [docs/demo-check.txt](docs/demo-check.txt).

slopgate does not send usage data. It only talks to the public package sites.

## The name tools actually tried to install

In October 2025, generated skill files started telling tools to run `npx react-codeshift`. That name mixes [jscodeshift](https://www.npmjs.com/package/jscodeshift) and [react-codemod](https://www.npmjs.com/package/react-codemod). It was not a package. The command spread with those files into many repos, including through `bunx`, `pnpm dlx`, and `yarn dlx`.

On 14 January 2026, Charlie Eriksen at Aikido published a placeholder on that name so someone else could not claim it later. On 13 October 2026 that placeholder had one version, no downloads that week, no link to source code, and a description that says it exists to stop a name mix-up. slopgate scores that listing at 92/100 and blocks it. The block comes from those facts. The name is not hard-coded. The write-up is [Agent skills spreading hallucinated npx commands](https://www.aikido.dev/blog/agent-skills-spreading-hallucinated-npx-commands).

`examples/bad-skill/SKILL.md` is a file like those. A scan of this repo reports it on purpose. The same scan blocks `npx slopgate init` until this package is published, because that command installs a name the npm site does not have yet. CI skips the README and `examples/` so those examples do not fail the build.

## What the hook checks

`init` adds a check that runs before an install:

| Tool | Project file | When it runs |
| --- | --- | --- |
| Claude Code | `.claude/settings.json` | Before a Bash command |
| Cursor | `.cursor/hooks.json` | Before a shell command |
| Codex CLI | `.codex/hooks.json` | Before a Bash command |
| Gemini CLI | `.gemini/settings.json` | Before the shell tool |

It also adds an MCP server. MCP is a way for the tool to call `check_package` itself. Pass `--no-mcp` to skip that. Pass `--global` to write the files in your home folder. Pass `--only cursor` to set up one tool.

The command reader covers `npm`, `pnpm`, `yarn`, `bun`, `npx`, `pip`, `uv`, `uvx`, `poetry`, `cargo`, and `go get`. It understands versions, scoped names, flags, requirement files, and commands joined with `&&`. `npm test` is left alone. So is `npm install` when it names no new package.

If slopgate itself crashes, the hook lets the install continue, so a bug does not freeze the tool. Set `SLOPGATE_FAIL_CLOSED=1` when you would rather stop the install.

## Scan a repo

```bash
node dist/cli.js scan
node dist/cli.js scan . --ignore examples --ignore README.md
```

The scan reads README files, markdown under `docs/`, `SKILL.md`, markdown under `skills/`, `CLAUDE.md`, `AGENTS.md`, Cursor rules, `package.json`, `requirements*.txt`, `pyproject.toml`, `Pipfile`, `Cargo.toml`, and `go.mod`. It skips `node_modules`, `.git`, `dist`, `vendor`, virtualenvs, and Cargo `target`.

GitHub Actions, once this repo is the action source:

```yaml
name: slopgate
on: [pull_request]
jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: manishreddy998/slopgate@main
        with:
          ignore: |
            examples
            README.md
```

`strict: true` also fails the job on a warning. The action builds slopgate from its own folder, so it works before an npm publish.

## How a score is chosen

A confirmed miss on the public package site is a block. Everything else gets a score from 0 to 100. The defaults block at 60 and warn at 25.

| Sign | What it means |
| --- | --- |
| Younger than 30 days | The name was published very recently |
| Fewer than 100 downloads last week | Almost nobody is installing it |
| One version | Nothing newer has been published |
| No source link, description, or license | The listing is thin |
| Placeholder wording | The owner says not to install it |
| Install scripts | `preinstall`, `install`, or `postinstall` on npm. These run code at install time |
| A close spelling, look-alike letters, or a changed `-` `_` `.` | Close to a well-known package |

Suggestions are the real package you may have meant. A weak likeness, such as sharing the word `codeshift`, is explained and does not by itself raise the score. That is why `react-dom` is not flagged just because it contains `react`.

Well-known packages score 0 even when they have install scripts. `esbuild` is allowed. A git URL, a folder path, or a private registry is a warning when the public site misses, not a block. Names on `allow` or `trustedScopes` are allowed even when the public site has never heard of them.

When the package site does not answer, a well-known name is allowed, a strong typo is blocked, and every other name follows `offline` (the default is `warn`). Results are saved for 12 hours under `$XDG_CACHE_HOME/slopgate` or `~/.cache/slopgate`. A miss is saved for 15 minutes.

Copy [slopgate.config.example.json](slopgate.config.example.json) to `slopgate.config.json`, or put the same object under a `"slopgate"` key in `package.json`. `~/.config/slopgate/config.json` is applied after that. Numbers in the user file replace the project file. Allow lists are added together, so a project file can add an allow and the user file cannot take it back. A coding tool that can edit the repo can edit the project file. Set `SLOPGATE_IGNORE_PROJECT_CONFIG=1` on the hook when the project file should not count.

## What this does not do

slopgate does not read the code inside a famous package, and it does not look up known security bugs. `npm install react` is allowed because react is real and widely installed. Socket, Snyk, and Aikido are the tools that keep watching a package after the name is real.

| | slopgate | sloppy-joe | slopcop | Socket, Snyk, Aikido |
| --- | --- | --- | --- | --- |
| Stops the tool at install time | Claude, Cursor, Codex, Gemini, plus MCP | No. It only scans | Wraps npm and pip | Paid products |
| Package sites | npm, PyPI, crates.io, Go | Eight package sites | npm and PyPI | Many |
| Typos | Letter changes against a hand-picked list of famous packages | Many generated misspellings | Name patterns | Their own threat data |
| Known bugs in real packages | No | Yes, through OSV | No | Yes |
| Price | Free, MIT | Free, Apache-2.0 | Free | Paid |

sloppy-joe goes further on made-up misspellings, and it keeps its settings outside the repo. slopgate is the other shape: no setup required, no extra libraries at run time, and a hook the coding tool runs on its own.

## Commands

```bash
slopgate init [--global] [--only claude,cursor,codex,gemini] [--no-install] [--no-mcp]
slopgate check react-codeshift
slopgate check pypi:flask cargo:serde go:github.com/gin-gonic/gin
slopgate hook --client claude          # used by the installed hooks
slopgate mcp                           # MCP over stdin. Content-Length headers, or one JSON object per line
slopgate scan [dir] --ignore examples
```

`check --json` prints the score, the reasons, and the suggestions. `--strict` exits 1 on a warning as well as a block.

## Development

Node 20 or newer. [CONTRIBUTING.md](CONTRIBUTING.md) has the test steps. [SECURITY.md](SECURITY.md) covers what happens when slopgate crashes, and how project settings can be changed by the tool you are trying to stop.

MIT. Copyright 2026 Manish.
