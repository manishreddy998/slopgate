# Contributing

slopgate is a small TypeScript CLI with no runtime dependencies. Issues and patches are welcome.

## Setup

Node 20 or newer.

```bash
npm install
npm test
npm run typecheck
npm run build
node dist/cli.js check react
```

`npm test` does not talk to the registries. The hook, the scorer, and the scan use mocked responses, including the real shape of `react-codeshift` as of 13 October 2026.

To check the live registries:

```bash
npm run build
SLOPGATE_LIVE=1 npx vitest run test/live.test.ts
```

That test denies `npm install react-codeshift` and allows `npm install react`, through the library and through `dist/cli.js`.

Coverage floors live in `vitest.config.ts`. `npm run test:coverage` enforces them.

## The demo

`docs/demo-check.txt` is stdout from `node dist/cli.js check` against the public npm registry. Regenerate the picture after a real run, and do not hand-edit the transcript:

```bash
node scripts/render-demo-svg.mjs
```

## Scanning this repo

The README and `examples/bad-skill/SKILL.md` mention `npx react-codeshift` on purpose. A plain scan blocks that fixture.

```bash
node dist/cli.js scan --ignore README.md --ignore examples --ignore test --ignore CONTRIBUTING.md
```

CI does the same. Do not add a committed `slopgate.config.json` that allowlists the fixture. The product is zero-config, and an allow entry would hide the thing the demo exists to show.

## Hooks and config

The hook fails open unless `SLOPGATE_FAIL_CLOSED=1`. Project config is convenient and also editable by the agent you are trying to constrain. Allow lists are unioned, so set `SLOPGATE_IGNORE_PROJECT_CONFIG=1` when the project file should not be able to add an allow.

There is no telemetry. Please do not add any.

## Publishing

`prepublishOnly` builds `dist/`. The published files are `dist`, `action.yml`, `README.md`, and `LICENSE`. The package is `public` and `engines.node` is `>=20`.
