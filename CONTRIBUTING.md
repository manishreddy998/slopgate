# Contributing

slopgate is a small TypeScript command-line tool. It has no extra libraries at run time. Issues and patches are welcome.

## Setup

Node 20 or newer.

```bash
npm install
npm test
npm run typecheck
npm run build
node dist/cli.js check react
```

`npm test` does not talk to the package sites. The hook, the score, and the scan use fake replies, including the real shape of `react-codeshift` as of 13 October 2026.

To check the live package sites:

```bash
npm run build
SLOPGATE_LIVE=1 npx vitest run test/live.test.ts
```

That test blocks `npm install react-codeshift` and allows `npm install react`. It checks both the library and `dist/cli.js`.

The lowest coverage numbers are in `vitest.config.ts`. `npm run test:coverage` checks them.

## The demo

`docs/demo-check.txt` is real output from `node dist/cli.js check` on the public npm site. After a real run, rebuild the picture. Do not type the transcript by hand:

```bash
node scripts/render-demo-svg.mjs
```

## Scanning this repo

The README and `examples/bad-skill/SKILL.md` mention `npx react-codeshift` on purpose. A plain scan blocks that example.

```bash
node dist/cli.js scan --ignore README.md --ignore examples --ignore test --ignore CONTRIBUTING.md
```

CI does the same. Do not commit a `slopgate.config.json` that allows the example. The product works with no config file, and an allow entry would hide the thing the demo exists to show.

## Hooks and settings

The hook lets the install continue if slopgate crashes, unless `SLOPGATE_FAIL_CLOSED=1`. Project settings are easy to use, and the coding tool can edit them too. Allow lists are added together, so set `SLOPGATE_IGNORE_PROJECT_CONFIG=1` when the project file should not be able to add an allow.

There is no usage tracking. Please do not add any.

## Publishing

`prepublishOnly` builds `dist/`. The published files are `dist`, `action.yml`, `README.md`, and `LICENSE`. The package is public. `engines.node` is `>=20`.
