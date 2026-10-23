---
runner: make
all: check
---

<!-- devloop: 0.157.0 -->
# Checks

| Class | Per-file | Whole | Files | Duration | Blocking | Status |
|---|---|---|---|---|---|---|
| format | fmt-file | fmt | src/**,test/** | <1s | yes | filled |
| lint | lint-file | lint | src/**,test/** | <1s | yes | filled |
| types | - | types | src/**,test/**,e2e/**,playwright.config.ts,tsconfig.json | 2s | yes | filled |
| unit | test-file | test-unit | src/**,test/** | <1s | yes | filled |
| integration | - | - | - | - | - | skipped (state): nothing external to integrate with, the program-level test is part of unit |
| end-to-end | - | test-e2e | e2e/**,playwright.config.ts,src/** | 7s | yes | filled |
| secrets | - | scan-secrets | ** | 1s | yes | filled |
| dependencies | - | scan-deps | package.json,package-lock.json | 2s | no | filled |
| code-security | - | - | - | - | - | skipped (state): about 100 lines of own code, too little for a code scanner to find anything |

## Running a single test

make test-one NAME=<test name>

## What these checks do not cover

- Types are checked by `tsc --noEmit`, but Node strips them without looking, so a wrong type that `tsc` cannot see (an `any` that leaks in, a cast) passes.
- `scan-secrets` knows the credential shapes of gitleaks' default rules; a credential of another shape passes.
- The page is opened in WebKit only; no other browser is tried. The end-to-end check needs the WebKit browser installed once per machine (`npx playwright install webkit`) and fails without it.
- `scan-deps` asks the npm registry, so it is not part of `check`; run `make scan-deps` by hand or in the platform's workflow.
- Import order is not enforced; Biome's import sorting is off.

## Services that must be running

make services-up
