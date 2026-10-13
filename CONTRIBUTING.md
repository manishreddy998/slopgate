# Contributing

Issues and pull requests are welcome. slopgate is a TypeScript CLI with no runtime dependencies.

## Setup

Node 20 or newer.

```bash
npm install
npm test
npm run typecheck
npm run build
node dist/cli.js check react
```

`npm test` does not contact the registries. Hook, scoring, and scan tests use fixtures, including the public shape of `react-codeshift` as of 13 October 2026.

Live registry check:

```bash
npm run build
SLOPGATE_LIVE=1 npx vitest run test/live.test.ts
```

That test denies `npm install react-codeshift` and allows `npm install react`, both in-process and through `dist/cli.js`.

Coverage thresholds are set in `vitest.config.ts`. `npm run test:coverage` enforces them.

## Demo

`docs/demo-check.txt` is stdout from `@slop-gate/cli` 0.1.0 (`node dist/cli.js check`) against the public npm registry on 13 October 2026. The PNG files in `docs/images/` are the same run. Regenerate the SVG from the transcript after a real run. Do not edit the transcript by hand.

```bash
node scripts/render-demo-svg.mjs
```

## Scanning this repository

The README and `examples/bad-skill/SKILL.md` mention `npx react-codeshift` on purpose. An unfiltered scan blocks that fixture.

```bash
node dist/cli.js scan --ignore README.md --ignore examples --ignore test --ignore CONTRIBUTING.md
```

CI uses the same ignores. Do not commit a `slopgate.config.json` that allowlists the fixture. The default is zero config, and an allow entry would hide the case the demo exists to show.

## Hooks and config

The hook fails open unless `SLOPGATE_FAIL_CLOSED=1`. Project config can be edited by the same client the hook is guarding. Allow lists are unioned, so set `SLOPGATE_IGNORE_PROJECT_CONFIG=1` when the project file must not be able to add an allow entry.

Do not add telemetry.

## Publishing

The package on npm is [`@slop-gate/cli`](https://www.npmjs.com/package/@slop-gate/cli). The binary name remains `slopgate`. Install it with `npx @slop-gate/cli` or `npm i -g @slop-gate/cli`.

`prepublishOnly` builds `dist/`. Published files are `dist`, `action.yml`, `README.md`, and `LICENSE`. `publishConfig.access` is `public`. `engines.node` is `>=20`.
