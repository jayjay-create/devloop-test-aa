---
runner: make
all: check
---

<!-- devloop: 0.157.0 -->
# Checks

| Class | Per-file | Whole | Files | Duration | Blocking | Status |
|---|---|---|---|---|---|---|
| format | - | - | - | - | - | empty |
| lint | - | - | - | - | - | empty |
| types | - | - | - | - | - | empty |
| unit | - | - | - | - | - | empty |
| integration | - | - | - | - | - | empty |
| end-to-end | - | - | - | - | - | empty |
| secrets | - | - | - | - | - | empty |
| dependencies | - | - | - | - | - | empty |
| code-security | - | - | - | - | - | empty |

## Running a single test

make test-one NAME=<test name>

## What these checks do not cover

- No check class is decided yet.

## Services that must be running

make services-up
