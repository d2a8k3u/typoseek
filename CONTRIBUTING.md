# Contributing

Ask questions and share ideas in [Discussions](https://github.com/d2a8k3u/typoseek/discussions). Report bugs and request features through the [issue forms](https://github.com/d2a8k3u/typoseek/issues/new/choose). Report security problems as [SECURITY.md](SECURITY.md) describes, never in a public issue.

## Set up

You need Node 22 or newer. CI runs Node 22 and 24.

```bash
npm ci
npm run test:unit
```

## Run the CI checks

CI runs these on every pull request. Run them before you open one:

```bash
npm run typecheck
npm run lint
npm run format:check
npm run test:coverage
npm run build
npm run test:package
npm run check:package
npm run size
npm run knip
npm run api:check
```

`npm run format` fixes formatting. Coverage must stay at 95% or more for `src/` and at 100% for `src/core/`. `npm run size` fails when a gzipped entry point grows past its limit in `.size-limit.json`.

CI also runs two suites that need extra tools on your machine:

- `npm run test:runtimes` runs the packed package under Bun and Deno. Both must be on your `PATH`.
- `npm run test:demo` runs the demo's browser tests. Install Chromium first with `npx playwright install chromium`.

## What a pull request needs

- A bug fix comes with a test that fails without the fix.
- A change to the public API comes with the reports from `npm run api:update` in `etc/`. Every export must appear as inline code in the README or a page in `docs/`, and `test/docs` fails when one is missing.
- A new file in `examples/` appears once in the README or a page in `docs/`, followed by the output it prints. `test/docs` runs it and compares.
- A change users notice needs a changeset. Run `npx changeset`, pick the version bump and describe the change in one line for the changelog.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): summary`.
