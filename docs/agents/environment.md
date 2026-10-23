<!-- devloop: 0.157.0 -->
# Environment

Node 25 runs the TypeScript files directly (type stripping): no build and no runtime dependencies. After a clone or a pull that changes `package.json`, run `npm install` once for Biome, the one dev dependency.

- Tests: `npm test` (`node --test 'test/*.test.ts'`), also `make test-unit`.
- End-to-end test: `npm run test:e2e` (Playwright, single project `webkit`, tests in `e2e/`) starts `node src/bin.ts`, opens the written page in WebKit. The WebKit browser is needed once per machine: `npx playwright install webkit` (a download; the person runs it).
- Checks: `make check` runs format, lint, unit tests and the end-to-end test; `make fmt-write` rewrites the files to Biome's format; `make scan-deps` runs `npm audit` (needs the network).
- Program: `printf 'a\nb\na\n' | node src/bin.ts [out.html]` prints the distinct links and writes the page (default `links.html` in the current directory).
- `make services-up` says nothing has to run and does nothing.

## Installed outside the project

- `brew install htmlq` installed into `/opt/homebrew/bin` (htmlq 0.4.0, run by the person).

## Install permission

install-tools: no
install-answered: 2026-10-23

## Dependency permission

dependency-tools: no
dependency-answered: 2026-10-23

## Unattended mode

unattended-mode: no
unattended-reason: the person said no to work running alone in this project
unattended-answered: 2026-10-23
