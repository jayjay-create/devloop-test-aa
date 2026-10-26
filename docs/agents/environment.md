<!-- devloop: 0.161.0 -->
# Environment

Node 25 runs the TypeScript files directly (type stripping): no build and no runtime dependencies. After a clone or a pull that changes `package.json`, run `npm install` once for Biome, the one dev dependency.

- Tests: `npm test` (`node --test 'test/*.test.ts'`), also `make test-unit`.
- End-to-end test: `npm run test:e2e` (Playwright, single project `webkit`, tests in `e2e/`) starts `node src/bin.ts`, opens the written page in WebKit. The WebKit browser is needed once per machine: `npx playwright install webkit` (a download; the person runs it).
- Checks: `make check` runs format, lint, types, unit tests, the end-to-end test and the secrets scan (needs gitleaks, `brew install gitleaks`); `make fmt-write` rewrites the files to Biome's format; `make scan-deps` runs `npm audit` (needs the network).
- Program: `printf 'a\nb\na\n' | node src/bin.ts [out.html]` prints the distinct links and writes the page (default `links.html` in the current directory). With `--count` it prints only the number of distinct links.
- Links from an HTML file: `npm run links -- [--sort] [--count] page.html [out.html]` (`scripts/links.sh`) extracts the `href` of every `a` element with htmlq, prints the distinct links and writes the page (default `links.html` in the current directory). htmlq must be installed (`brew install htmlq`); the script tests in `test/links-script.test.ts` are skipped where it is missing.
- Diagram: `npm run diagram` (`scripts/diagram.sh`) renders `docs/links.mmd` into `docs/links.svg` with `mmdc` from the PATH (`npm install -g @mermaid-js/mermaid-cli`; it fetches a headless browser into `~/.cache/puppeteer` on first use). `mmdc` is not a project package and not part of `make check`; the script tests in `test/diagram-script.test.ts` use stubs and pass without it.
- Links with a settings file: `npm run links:config -- page.html [out.html]` (`scripts/links-config.sh`) reads `sort` from `links.config.yaml` in the project root with yq and calls `npm run links`, with `--sort` when the value is `true`. yq (Mike Farah's) must be installed for real use (`brew install yq`); it is not part of `make check`, and the script tests in `test/links-config-script.test.ts` use stubs and pass without it.
- `make services-up` says nothing has to run and does nothing.

## Installed outside the project

- `brew install htmlq` installed into `/opt/homebrew/bin` (htmlq 0.4.0, run by the person).
- `brew install gitleaks 2>& 1` installed into /opt/homebrew/bin
- `npm install -g @mermaid-js/mermaid-cli 2>& 1` installed into /opt/homebrew/bin

## Dependency permission

dependency-tools: yes
dependency-answered: 2026-10-23

## Unattended mode

unattended-mode: yes
unattended-answered: 2026-10-23

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
install-answered: 2026-10-26
