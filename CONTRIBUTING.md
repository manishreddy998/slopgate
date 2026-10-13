# Contributing

Issues and pull requests are welcome. slopgate is a TypeScript CLI with no runtime dependencies.

## Setup

Node 20 or newer.

```bash
npm install
npm test
npm run typecheck
npm run build
node dist/cli.js check pypi:pandas
```

`npm test` does not contact the registries. Hook, scoring, and scan tests use fixtures, built from the public shape of real registry entries as of 13 October 2026.

Live registry check:

```bash
npm run build
SLOPGATE_LIVE=1 npx vitest run test/live.test.ts
```

That test checks a blocked install and an allowed install against the live registry, both in-process and through `dist/cli.js`.

Coverage thresholds are set in `vitest.config.ts`. `npm run test:coverage` enforces them.

## Screenshots

The PNG files in `docs/images/` are real terminal captures of `@slop-gate/cli` 0.1.2 against the public PyPI registry on 13 October 2026. Replace them with new captures after a release. Do not edit them by hand.

## Scanning this repository

`examples/bad-skill/SKILL.md` tells the reader to run `pip install pandas-sql-helper`, a package that does not exist, on purpose. An unfiltered scan blocks that fixture.

```bash
node dist/cli.js scan --ignore README.md --ignore examples --ignore test --ignore CONTRIBUTING.md
```

CI uses the same ignores. Do not commit a `slopgate.config.json` that allowlists the fixture. The default is zero config, and an allow entry would hide the case the demo exists to show.

## Hooks and config

The hook fails open unless `SLOPGATE_FAIL_CLOSED=1`. Project config can be edited by the same client the hook is guarding. Allow lists are unioned, so set `SLOPGATE_IGNORE_PROJECT_CONFIG=1` when the project file must not be able to add an allow entry.

`init` adds `@slop-gate/cli` as a dev dependency. Hook commands and the MCP server run `npx -y @slop-gate/cli`.

Do not add telemetry.

## Publishing

The package on npm is [`@slop-gate/cli`](https://www.npmjs.com/package/@slop-gate/cli). The binary name remains `slopgate`. Install it with `npx @slop-gate/cli` or `npm i -g @slop-gate/cli`.

`prepublishOnly` builds `dist/`. Published files are `dist`, `action.yml`, `README.md`, and `LICENSE`. `publishConfig.access` is `public`. `engines.node` is `>=20`.
