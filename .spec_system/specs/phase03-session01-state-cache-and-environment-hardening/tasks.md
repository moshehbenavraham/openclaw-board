# Task Checklist

**Session ID**: `phase03-session01-state-cache-and-environment-hardening`
**Total Tasks**: 16
**Estimated Duration**: 3.0-3.5 hours
**Created**: 2026-03-31

---

## Legend

- `[x]` = Completed
- `[ ]` = Pending
- `[P]` = Parallelizable (can run with other [P] tasks)
- `[SNNMM]` = Session reference (NN=phase number, MM=session number)
- `TNNN` = Task ID

---

## Progress Summary

| Category | Total | Done | Remaining |
|----------|-------|------|-----------|
| Setup | 3 | 3 | 0 |
| Foundation | 4 | 4 | 0 |
| Implementation | 4 | 4 | 0 |
| Testing | 5 | 5 | 0 |
| **Total** | **16** | **16** | **0** |

---

## Setup (3 tasks)

Capture the exact scope, safety contracts, and deferred work before code
changes begin.

- [x] T001 [S0301] Verify SYN-27, SYN-28, and SYN-30 against the current
      alert, cache, and runtime-path surfaces in implementation notes
      (`.spec_system/specs/phase03-session01-state-cache-and-environment-hardening/implementation-notes.md`)
- [x] T002 [S0301] Define atomic-write, cache-isolation, and root-validation
      acceptance criteria plus sanitized failure contracts in implementation
      notes
      (`.spec_system/specs/phase03-session01-state-cache-and-environment-hardening/implementation-notes.md`)
- [x] T003 [S0301] Record route response-shape compatibility rules and phase
      03 deferred items for client cleanup and final closeout in
      implementation notes
      (`.spec_system/specs/phase03-session01-state-cache-and-environment-hardening/implementation-notes.md`)

---

## Foundation (4 tasks)

Create the shared primitives that the touched routes will reuse.

- [x] T004 [S0301] Create shared alert-config helpers for default fallback,
      legacy-rule normalization, and atomic rename-and-swap persistence with
      idempotency protection, transaction boundaries, and compensation on
      failure (`lib/alert-config.ts`)
- [x] T005 [S0301] [P] Add helper regression coverage for default fallback,
      legacy-rule normalization, and temp-file cleanup on write failure
      (`lib/alert-config.test.ts`)
- [x] T006 [S0301] Harden config-cache storage and reads with defensive
      cloning or immutability so callers cannot mutate canonical state on
      re-entry (`lib/config-cache.ts`)
- [x] T007 [S0301] [P] Extend config-cache tests for clone isolation,
      overwrite semantics, and cleared-state behavior
      (`lib/config-cache.test.ts`)

---

## Implementation (4 tasks)

Move the scoped runtime surfaces onto the shared safe primitives.

- [x] T008 [S0301] Add validated OpenClaw root and derived runtime-path
      helpers that reject env-driven escapes with explicit error mapping
      (`lib/openclaw-paths.ts`)
- [x] T009 [S0301] Refactor alert write routes to use the shared alert-config
      helper with duplicate-trigger prevention while in-flight and sanitized
      write-failure handling (`app/api/alerts/route.ts`)
- [x] T010 [S0301] Refactor alert diagnostics to reuse the shared atomic
      alert-config helper and validated cron-store resolution with timeout
      and failure-path handling (`app/api/alerts/check/route.ts`)
- [x] T011 [S0301] Refactor config reads to serve safe cached snapshots and
      validated runtime-derived paths with explicit empty and error response
      mapping (`app/api/config/route.ts`)

---

## Testing (5 tasks)

Regression coverage and verification evidence for the hardened runtime paths.

- [x] T012 [S0301] [P] Extend OpenClaw path tests for invalid root
      assumptions, cron-store override rejection, and approved-boundary
      enforcement (`lib/openclaw-paths.test.ts`)
- [x] T013 [S0301] [P] Extend alert route tests for atomic persistence,
      temp-file cleanup, and stable client-safe write failures
      (`app/api/alerts/route.test.ts`)
- [x] T014 [S0301] [P] Extend alert diagnostics tests for live-send
      `lastAlerts` persistence and failure-path handling
      (`app/api/alerts/check/route.test.ts`)
- [x] T015 [S0301] [P] Extend config route tests for cache isolation,
      validated root handling, and sanitized runtime-read failures
      (`app/api/config/route.test.ts`)
- [x] T016 [S0301] Run focused Vitest coverage, verify ASCII and LF on
      touched files, manually smoke-test alert and config flows, and record
      outcomes
      (`.spec_system/specs/phase03-session01-state-cache-and-environment-hardening/implementation-notes.md`)

---

## Completion Checklist

Before marking session complete:

- [x] All tasks marked `[x]`
- [x] All tests passing
- [x] All files ASCII-encoded
- [x] implementation-notes.md updated
- [x] Ready for the validate workflow step

---

## Next Steps

Run `updateprd` after validation to sync the PRD and session tracking.
