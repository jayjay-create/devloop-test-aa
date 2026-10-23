<!-- devloop: 0.157.0 -->
# Environment

Node 25 runs the TypeScript files directly (type stripping): no build, no dependencies, no install step.

- Tests: `npm test` (`node --test 'test/*.test.ts'`).
- Program: `printf 'a\nb\na\n' | node src/bin.ts [out.html]` prints the distinct links and writes the page (default `links.html` in the current directory).
- `make services-up` says nothing has to run and does nothing.

## Install permission

install-tools: no
install-answered: 2026-10-23
