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
| types | - | - | - | - | - | skipped (user): the TypeScript compiler and @types/node were not allowed into the packages |
| unit | test-file | test-unit | src/**,test/** | <1s | yes | filled |
| integration | - | - | - | - | - | skipped (state): nothing external to integrate with, the program-level test is part of unit |
| end-to-end | - | - | - | - | - | skipped (state): no end-to-end test yet, it is the open task The written page is verified in WebKit |
| secrets | - | - | - | - | - | skipped (user): gitleaks is not installed and the user chose the check off |
| dependencies | - | scan-deps | package.json,package-lock.json | 2s | no | filled |
| code-security | - | - | - | - | - | skipped (state): about 100 lines of own code, too little for a code scanner to find anything |

## Running a single test

make test-one NAME=<test name>

## What these checks do not cover

- Types are not checked: Node strips them without looking, so a wrong type passes every check here.
- Credentials committed by accident are not searched for.
- Nothing opens the written page in a browser yet.
- `scan-deps` asks the npm registry, so it is not part of `check`; run `make scan-deps` by hand or in the platform's workflow.
- Import order is not enforced; Biome's import sorting is off.

## Services that must be running

make services-up
