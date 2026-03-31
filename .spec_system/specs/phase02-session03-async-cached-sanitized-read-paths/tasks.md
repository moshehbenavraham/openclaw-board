# Task Checklist

**Session ID**: `phase02-session03-async-cached-sanitized-read-paths`
**Total Tasks**: 18
**Estimated Duration**: 3.5-4.0 hours
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
| Setup | 3 | 0 | 3 |
| Foundation | 4 | 0 | 4 |
| Implementation | 6 | 0 | 6 |
| Testing | 5 | 0 | 5 |
| **Total** | **18** | **0** | **18** |

---

## Setup (3 tasks)

Route inventory, cache budgets, and response-contract planning before code
changes.

- [x] T001 [S0203] Verify the targeted analytics and skills read hotspots,
      current cache semantics, and remaining sync I/O in implementation notes
      (`.spec_system/specs/phase02-session03-async-cached-sanitized-read-paths/implementation-notes.md`)
- [x] T002 [S0203] Define per-route file-count, file-size, TTL, and in-flight
      dedupe budgets for the scoped read paths in implementation notes
      (`.spec_system/specs/phase02-session03-async-cached-sanitized-read-paths/implementation-notes.md`)
- [x] T003 [S0203] Record client-visible response-shape constraints,
      sanitized error contracts, and deferred lower-priority read endpoints in
      implementation notes
      (`.spec_system/specs/phase02-session03-async-cached-sanitized-read-paths/implementation-notes.md`)

---

## Foundation (4 tasks)

Shared bounded read primitives for the scoped routes.

- [x] T004 [S0203] Create bounded async read-path helpers for directory scans,
      file-size guards, and keyed computation caching with cleanup on scope
      exit for all acquired resources (`lib/openclaw-read-paths.ts`)
- [x] T005 [S0203] [P] Add helper regression coverage for oversize-file
      handling, bounded directory enumeration, and duplicate-trigger
      prevention while in-flight (`lib/openclaw-read-paths.test.ts`)
- [x] T006 [S0203] Refactor shared skill discovery and content readers onto
      the bounded async helper with types matching the declared skill contract
      and explicit error mapping (`lib/openclaw-skills.ts`)
- [x] T007 [S0203] [P] Extend skills helper tests for malformed session
      snapshots, oversize skill files, and sanitized missing-content behavior
      (`lib/openclaw-skills.test.ts`)

---

## Implementation (6 tasks)

Migrate the targeted heavy routes onto the shared bounded async surface.

- [x] T008 [S0203] Migrate aggregate stats reads to bounded async session
      scans and keyed cache reuse with duplicate-trigger prevention while
      in-flight (`app/api/stats-all/route.ts`)
- [x] T009 [S0203] Migrate model stats aggregation to bounded async session
      scans with deterministic ordering, bounded file counts, and sanitized
      failure handling (`app/api/stats-models/route.ts`)
- [x] T010 [S0203] Migrate activity heatmap generation to bounded async
      session scans with duplicate-trigger prevention while in-flight
      (`app/api/activity-heatmap/route.ts`)
- [x] T011 [S0203] Migrate per-agent stats reads to async bounded session
      parsing with validated agent boundaries and explicit error mapping
      (`app/api/stats/[agentId]/route.ts`)
- [x] T012 [S0203] Update the skills list route to await bounded async skill
      scans with explicit empty and error response mapping
      (`app/api/skills/route.ts`)
- [x] T013 [S0203] Update the skill content route to await bounded content
      reads with validated query input and explicit error mapping
      (`app/api/skills/content/route.ts`)

---

## Testing (5 tasks)

Regression coverage and verification evidence for the migrated read paths.

- [x] T014 [S0203] [P] Extend aggregate stats route tests for cache hits,
      oversize-session handling, and sanitized failure responses
      (`app/api/stats-all/route.test.ts`)
- [x] T015 [S0203] [P] Create model-stats route tests for bounded scans,
      deterministic ordering, and sanitized failure responses
      (`app/api/stats-models/route.test.ts`)
- [x] T016 [S0203] [P] Extend activity heatmap route tests for async cache
      reuse, bounded reads, and sanitized failure responses
      (`app/api/activity-heatmap/route.test.ts`)
- [x] T017 [S0203] [P] Extend per-agent stats and skills route tests for async
      helper adoption, bounded content reads, and stable client-safe errors
      (`app/api/stats/[agentId]/route.test.ts`, `app/api/skills/route.test.ts`, `app/api/skills/content/route.test.ts`)
- [x] T018 [S0203] Run focused Vitest coverage, verify ASCII and LF on touched
      files, manually smoke-test the home, models, pixel-office, and skills
      read flows, and record outcomes
      (`.spec_system/specs/phase02-session03-async-cached-sanitized-read-paths/implementation-notes.md`)

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
