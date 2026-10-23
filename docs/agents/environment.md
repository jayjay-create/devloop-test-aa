<!-- devloop: 0.157.0 -->
# Environment

Node 25 runs the TypeScript files directly (type stripping): no build and no runtime dependencies. After a clone or a pull that changes `package.json`, run `npm install` once for Biome, the one dev dependency.

- Tests: `npm test` (`node --test 'test/*.test.ts'`), also `make test-unit`.
- Checks: `make check` runs format, lint and unit tests; `make fmt-write` rewrites the files to Biome's format; `make scan-deps` runs `npm audit` (needs the network).
- Program: `printf 'a\nb\na\n' | node src/bin.ts [out.html]` prints the distinct links and writes the page (default `links.html` in the current directory).
- `make services-up` says nothing has to run and does nothing.

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
