# Task Checklist

**Session ID**: `phase02-session02-runtime-bridge-consolidation-and-safe-parsing`
**Total Tasks**: 15
**Estimated Duration**: 3.0-4.0 hours
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
| Testing | 4 | 4 | 0 |
| **Total** | **15** | **15** | **0** |

---

## Setup (3 tasks)

Bridge inventory, path mapping, and failure-contract definition before code changes.

- [x] T001 [S0202] Verify the duplicate OpenClaw CLI execution, parser call sites, and downstream response contracts in implementation notes (`.spec_system/specs/phase02-session02-runtime-bridge-consolidation-and-safe-parsing/implementation-notes.md`)
- [x] T002 [S0202] Document the runtime file inputs, approved OpenClaw boundaries, and current malformed-output failure modes in implementation notes (`.spec_system/specs/phase02-session02-runtime-bridge-consolidation-and-safe-parsing/implementation-notes.md`)
- [x] T003 [S0202] Define the canonical bridge helper contract, sanitized failure mapping, and deferred non-scope items in implementation notes (`.spec_system/specs/phase02-session02-runtime-bridge-consolidation-and-safe-parsing/implementation-notes.md`)

---

## Foundation (4 tasks)

Shared bridge and runtime-path primitives.

- [x] T004 [S0202] Refactor the canonical OpenClaw bridge helper surface for shared execution, mixed-output parsing, and typed probe results with timeout, stderr fallback, and malformed-output rejection (`lib/openclaw-cli.ts`)
- [x] T005 [S0202] Add validated runtime file resolvers for bridge consumers with boundary-checked OpenClaw path handling (`lib/openclaw-paths.ts`)
- [x] T006 [S0202] [P] Extend bridge-helper unit tests for malformed mixed output, stderr-only JSON, empty output, and typed result contracts (`lib/openclaw-cli.test.ts`)
- [x] T007 [S0202] [P] Extend runtime-path tests for invalid `OPENCLAW_HOME`-derived file paths and approved-boundary resolution (`lib/openclaw-paths.test.ts`)

---

## Implementation (4 tasks)

Migrate existing consumers onto the shared bridge surface.

- [x] T008 [S0202] Route provider-probe CLI fallback through the shared bridge helper and validated `models.json` resolution with timeout, retry, and failure-path handling (`lib/model-probe.ts`)
- [x] T009 [S0202] Route gateway version and CLI health probes through the shared bridge helper with explicit degraded and down-state error mapping (`app/api/gateway-health/route.ts`)
- [x] T010 [S0202] Align session CLI fallback parsing with the hardened shared bridge contract and explicit malformed-output handling (`lib/session-test-fallback.ts`)
- [x] T011 [S0202] Remove the remaining duplicated bridge execution and parser branches from bridge consumers while preserving existing operator-visible success responses (`lib/model-probe.ts`, `app/api/gateway-health/route.ts`, `lib/session-test-fallback.ts`)

---

## Testing (4 tasks)

Regression coverage and verification evidence.

- [x] T012 [S0202] [P] Extend provider-probe tests for malformed CLI output, invalid runtime paths, missing probe matches, and shared-helper reuse (`lib/model-probe.test.ts`)
- [x] T013 [S0202] [P] Extend gateway-health tests for CLI fallback success, malformed runtime output, and sanitized down-state responses (`app/api/gateway-health/route.test.ts`)
- [x] T014 [S0202] [P] Extend session fallback tests for malformed output and shared parse-contract behavior (`lib/session-test-fallback.test.ts`)
- [x] T015 [S0202] Run focused Vitest coverage, verify ASCII and LF on touched files, manually exercise gateway health and provider probe diagnostics, and record outcomes (`.spec_system/specs/phase02-session02-runtime-bridge-consolidation-and-safe-parsing/implementation-notes.md`)

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

Run the `implement` workflow step to begin AI-led implementation.
