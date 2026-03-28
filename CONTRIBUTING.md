# Contributing

Thanks for taking the time. agenttrail is a small project and I'd like to keep
it that way, so the bar is mostly "does this make the tool better without
making it bigger".

## Setup

```bash
git clone https://github.com/amansoomro062/agent-trail.git
cd agent-trail
npm install
npm --prefix web install
npm run build        # CLI (tsc) + dashboard (vite)
node dist/cli.js     # run it
npm run dev:web      # vite dev server, proxies /api to :4820
npm test             # parser + search tests (node:test, no test deps)
```

Node 20 or newer. There are no runtime dependencies for the CLI and I'd like
to keep it that way. Dashboard dependencies need a better reason than "it's
convenient".

## Where things live

- `src/` - the CLI: transcript discovery and parsing (`parser.ts`), the local
  HTTP server (`server.ts`), entry point (`cli.ts`).
- `web/` - the React dashboard.
- `test/` - parser and server tests, plain `node:test`.
- `DESIGN.md` - the visual system. Anything user-visible should follow it.

## Making changes

- Open an issue first for anything bigger than a bug fix. Transcript parsing
  changes especially: the schema isn't ours and edge cases are the whole game.
- Add a test if you touch the parser. The existing tests show how to build
  synthetic transcripts, see `test/helpers.ts`.
- Keep the CLI dependency-free.
- Follow `DESIGN.md` for UI work: five category colors, no sixth hue, every
  colored mark gets a text label, hover on every chart.
- Run `npm test` and `npm run typecheck` before opening a PR.

## Commit messages

Short, imperative, says what changed: "Fix double-counted tokens on streamed
chunks", not "fix bug" and not an essay. The diff can carry the detail.

## Pull requests

One thing per PR. If it fixes an issue, reference it. If it changes the UI,
include a screenshot.
