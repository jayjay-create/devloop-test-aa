<!-- devloop: 0.157.0 -->
# Environment

Node 25 runs the TypeScript files directly (type stripping): no build and no runtime dependencies. After a clone or a pull that changes `package.json`, run `npm install` once for Biome, the one dev dependency.

- Tests: `npm test` (`node --test 'test/*.test.ts'`), also `make test-unit`.
- End-to-end test: `npm run test:e2e` (Playwright, single project `webkit`, tests in `e2e/`) starts `node src/bin.ts`, opens the written page in WebKit. The WebKit browser is needed once per machine: `npx playwright install webkit` (a download; the person runs it).
- Checks: `make check` runs format, lint, types, unit tests, the end-to-end test and the secrets scan (needs gitleaks, `brew install gitleaks`); `make fmt-write` rewrites the files to Biome's format; `make scan-deps` runs `npm audit` (needs the network).
- Program: `printf 'a\nb\na\n' | node src/bin.ts [out.html]` prints the distinct links and writes the page (default `links.html` in the current directory).
- Links from an HTML file: `npm run links -- page.html [out.html]` (`scripts/links.sh`) extracts the `href` of every `a` element with htmlq, prints the distinct links and writes the page (default `links.html` in the current directory). htmlq must be installed (`brew install htmlq`); the script tests in `test/links-script.test.ts` are skipped where it is missing.
- `make services-up` says nothing has to run and does nothing.

## Installed outside the project

- `brew install htmlq` installed into `/opt/homebrew/bin` (htmlq 0.4.0, run by the person).
- `brew install gitleaks 2>& 1` installed into /opt/homebrew/bin

## Install permission

install-tools: yes
install-place: /usr/local/bin
install-place: /usr/local/sbin
install-place: /opt
install-place: ~/.local/bin
install-place: ~/bin
install-place: ~/go/bin
install-place: ~/Library/Caches/ms-playwright
install-place: ~/.cache/ms-playwright
install-place: ~/Library/Caches/Cypress
install-place: ~/.cache/Cypress
install-place: ~/.cache/puppeteer
install-route: npm
install-answered: 2026-10-23

## Dependency permission

dependency-tools: yes
dependency-answered: 2026-10-23

## Unattended mode

unattended-mode: yes
unattended-answered: 2026-10-23
