.PHONY: check fmt fmt-file fmt-write lint lint-file types test-unit test-file test-one test-e2e scan-deps scan-secrets services-up

BIOME = npx --no-install biome

# Every blocking class in sequence, as listed in docs/agents/checks.md.
check: fmt lint types test-unit test-e2e scan-secrets

fmt:
	$(BIOME) format .

fmt-file:
	@test -n "$(FILE)" || { echo "usage: make fmt-file FILE=<path>" >&2; exit 2; }
	$(BIOME) format "$(FILE)"

# The rewriting form of the format tool. It is in no row of checks.md and no hook calls it.
fmt-write:
	$(BIOME) format --write .

lint:
	$(BIOME) lint .

lint-file:
	@test -n "$(FILE)" || { echo "usage: make lint-file FILE=<path>" >&2; exit 2; }
	$(BIOME) lint "$(FILE)"

types:
	npx --no-install tsc -p tsconfig.json

test-unit:
	npm test

test-file:
	@test -n "$(FILE)" || { echo "usage: make test-file FILE=<path>" >&2; exit 2; }
	node --test "$(FILE)"

test-one:
	@test -n "$(NAME)" || { echo "usage: make test-one NAME=<test name>" >&2; exit 2; }
	node --test --test-name-pattern "$(NAME)" 'test/*.test.ts'

# Needs the WebKit browser: npx playwright install webkit (once per machine).
test-e2e:
	npm run test:e2e

# Searches the files of the working tree, then the whole git history, for credentials.
scan-secrets:
	gitleaks dir --no-banner --config .gitleaks.toml .
	gitleaks git --no-banner --config .gitleaks.toml .

# Asks the npm registry, so it is not part of check: an outage there must not stop work here.
scan-deps:
	npm audit --audit-level=high

services-up:
	@echo "nothing has to run for this project"
