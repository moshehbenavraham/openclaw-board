# Session Specification

**Session ID**: `phase02-session03-async-cached-sanitized-read-paths`
**Phase**: 02 - Runtime Boundary and Read Path Hardening
**Status**: Not Started
**Created**: 2026-03-31

---

## 1. Session Overview

This session finishes Phase 02 by hardening the read-heavy operator surfaces
that still do synchronous filesystem work or broad unbounded scans on demand.
The current hot spots are `app/api/stats-all/route.ts`,
`app/api/stats-models/route.ts`, `app/api/activity-heatmap/route.ts`,
`app/api/stats/[agentId]/route.ts`, and the skills readers behind
`app/api/skills/*`. These routes power core operator views, but they still
read many runtime files directly in request handlers and do not consistently
bound file size, file count, or duplicate concurrent work.

The goal is to move those paths onto one shared async read-helper surface,
add short-lived keyed caching with in-flight dedupe where the scans are most
expensive, and keep client-facing responses intentionally small and
sanitized. That directly targets SYN-13, SYN-17, SYN-21, SYN-26, SYN-33, and
SYN-35 while preserving the earlier browser-visible token and path redaction
work from Session 00-02.

Session 02 already consolidated runtime bridge parsing and validated runtime
paths. With that dependency in place, this session can focus on filesystem-
heavy analytics and skills routes without reopening the CLI hardening work.
Completing it should leave Phase 02 ready to hand off to the residual cleanup
work in Phase 03.

---

## 2. Objectives

1. Introduce shared async read-path helpers with file-size caps, file-count
   limits, and keyed in-flight caching for targeted analytics and skills
   scans.
2. Migrate the scoped heavy routes to async bounded scans while preserving
   their current operator-visible success shapes.
3. Sanitize read-path metadata and error responses so browser payloads do not
   expose raw filesystem paths or unnecessary operational details.
4. Add regression coverage for cache hits, oversize or malformed files,
   bounded scans, and client-safe failure responses.

---

## 3. Prerequisites

### Required Sessions

- [x] `phase02-session02-runtime-bridge-consolidation-and-safe-parsing` -
  shared runtime parsing and validated path helpers are already available for
  reuse on the remaining read surfaces
- [x] `phase01-session01-route-boundary-validation` - validated `agentId`
  boundaries already exist for the per-agent stats route
- [x] `phase01-session03-abuse-resistance-and-deterministic-diagnostics` -
  analytics routes already have rate-limit conventions that the read-path work
  must preserve

### Required Tools/Knowledge

- Node `fs/promises` patterns for asynchronous directory and file access
- Existing OpenClaw path resolvers under `lib/openclaw-paths.ts`
- Current route response contracts used by the home, models, pixel-office, and
  skills pages
- Vitest route and helper testing patterns already used in this repo

### Environment Requirements

- `OPENCLAW_HOME` points to a runtime tree with representative agent session
  data for manual verification
- Sensitive feature flags may remain disabled; the targeted routes are read-
  only and must continue working in that state
- No new package dependencies are required; the solution should stay on built-
  in Node and existing project utilities

---

## 4. Scope

### In Scope (MVP)

- Server can scan the targeted analytics routes (`stats-all`, `stats-models`,
  `activity-heatmap`, and `stats/[agentId]`) through shared async helpers with
  file-count and file-size bounds
- Server can list skill metadata and read `SKILL.md` content through async
  bounded reads that keep malformed or oversized files from turning into raw
  client errors
- Heavy analytics routes can reuse short-lived keyed caches with in-flight
  dedupe so repeated reads do not stampede the filesystem
- Browser-visible read errors and metadata are sanitized to the minimum needed
  for operators while keeping existing success responses usable

### Out of Scope (Deferred)

- Mutable cache clone fixes and atomic write cleanup - *Reason: Phase 03 owns
  the remaining cache-integrity and write-integrity work*
- Broad client polling redesign and localStorage retention limits -
  *Reason: Phase 03 owns the remaining browser-side operational cleanup*
- Lower-traffic read routes outside the targeted hotspot set, such as
  `agent-status`, `pixel-office/idle-rank`, and `pixel-office/tracks` -
  *Reason: keep this session within the 2-4 hour scope cap while addressing
  the highest-risk analytics and skills surfaces first*
- Final documentation closeout and accepted-risk decisions - *Reason: Phase 03
  owns project verification and documentation synchronization*

---

## 5. Technical Approach

### Architecture

Add a shared `lib/openclaw-read-paths.ts` helper that encapsulates bounded
directory enumeration, file-size-checked reads, and a small keyed in-memory
cache with in-flight dedupe for expensive computations. Route handlers should
pass route-specific budgets into that helper instead of open-coding
`readdirSync` and `readFileSync` loops.

Use that helper to migrate `app/api/stats-all/route.ts`,
`app/api/stats-models/route.ts`, `app/api/activity-heatmap/route.ts`, and
`app/api/stats/[agentId]/route.ts` onto async session-file reads. The routes
should keep their current success payload shapes, preserve existing rate-limit
behavior where present, and replace raw thrown-error serialization with stable
operator-facing failures.

Refactor `lib/openclaw-skills.ts` onto the same bounded async helper so skills
listing and content reads stop doing synchronous directory scans and unbounded
file reads in request handlers. The skills routes should await those helpers
and return stable 4xx and 5xx responses without surfacing raw parser details,
internal paths, or oversized-file errors to the browser.

### Design Patterns

- Shared bounded read helper: centralize scan limits, size guards, and async
  file access instead of repeating route-local loops
- Keyed cache with in-flight dedupe: reuse hot analytics results without
  allowing concurrent requests to stampede the same expensive read path
- Thin route handlers: keep `app/api/*/route.ts` focused on request
  validation, orchestration, and response mapping
- Sanitized read contract: treat malformed, missing, or oversized runtime data
  as client-safe operator failures
- Deterministic aggregation order: keep sorted route outputs stable for the UI
  and tests

### Technology Stack

- Next.js 16 route handlers
- TypeScript 5 shared helper modules under `lib/`
- Node `fs/promises`, `path`, and built-in timers or maps for caching
- Existing OpenClaw path helpers and request-boundary utilities
- Vitest for helper and route regression coverage

---

## 6. Deliverables

### Files to Create

| File | Purpose | Est. Lines |
|------|---------|------------|
| `lib/openclaw-read-paths.ts` | Shared bounded async read helpers and keyed cache or dedupe utilities for heavy read routes | ~140 |
| `lib/openclaw-read-paths.test.ts` | Regression coverage for bounded directory scans, oversize-file handling, and in-flight cache behavior | ~120 |
| `app/api/stats-models/route.test.ts` | Route coverage for the model-stats read surface after async migration | ~90 |

### Files to Modify

| File | Changes | Est. Lines |
|------|---------|------------|
| `app/api/stats-all/route.ts` | Move aggregate stats reads onto bounded async helpers and stampede-safe caching | ~120 |
| `app/api/stats-all/route.test.ts` | Cover cache hits, oversize-session handling, and sanitized failures | ~80 |
| `app/api/stats-models/route.ts` | Move model stats reads onto bounded async helpers and deterministic aggregation | ~120 |
| `app/api/activity-heatmap/route.ts` | Replace sync heatmap scans with bounded async reads and cache reuse | ~100 |
| `app/api/activity-heatmap/route.test.ts` | Cover async cache reuse, bounded reads, and sanitized failures | ~70 |
| `app/api/stats/[agentId]/route.ts` | Replace per-agent sync reads with async bounded parsing and stable errors | ~110 |
| `app/api/stats/[agentId]/route.test.ts` | Extend coverage for async parsing and client-safe failures | ~70 |
| `lib/openclaw-skills.ts` | Convert skill discovery and content reads to bounded async helpers | ~140 |
| `lib/openclaw-skills.test.ts` | Add coverage for malformed snapshots, oversize skill files, and async reads | ~120 |
| `app/api/skills/route.ts` | Await async skill listing and return sanitized route-level failures | ~30 |
| `app/api/skills/route.test.ts` | Update route mocks and failure expectations for sanitized async behavior | ~40 |
| `app/api/skills/content/route.ts` | Await bounded content reads and keep error mapping explicit | ~40 |
| `app/api/skills/content/route.test.ts` | Extend route coverage for sanitized bounded content failures | ~50 |

---

## 7. Success Criteria

### Functional Requirements

- [ ] Targeted heavy routes no longer use synchronous filesystem reads on the
      request path
- [ ] Analytics routes enforce explicit file-count and file-size bounds before
      reading session data
- [ ] Expensive analytics routes reuse short-lived keyed caches with in-flight
      dedupe instead of recomputing on concurrent requests
- [ ] Skills listing and content routes stop surfacing raw thrown errors or
      internal path details to browser clients
- [ ] Existing page consumers keep receiving the same success-path fields they
      already rely on

### Testing Requirements

- [ ] Helper tests cover bounded scans, oversize-file handling, and keyed
      cache dedupe behavior
- [ ] Route tests cover cache hits, async helper adoption, oversize or
      malformed file handling, and sanitized failures for the targeted routes
- [ ] Manual testing covers the home, models, pixel-office, and skills pages
      with representative runtime data
- [ ] Manual testing confirms repeated reads use cached results without
      breaking expected operator-visible freshness

### Non-Functional Requirements

- [ ] No new package dependencies are added
- [ ] Cold-path analytics work is bounded by explicit file-count and file-size
      limits
- [ ] Client-visible failures never include raw filesystem paths, parser stack
      traces, or route-local `err.message` strings
- [ ] Cache TTLs and aggregation ordering remain deterministic enough for
      repeatable tests and operator debugging

### Quality Gates

- [ ] All files ASCII-encoded
- [ ] Unix LF line endings
- [ ] Code follows project conventions

---

## 8. Implementation Notes

### Key Considerations

- `stats-all`, `stats-models`, and `activity-heatmap` all scan session JSONL
  files across many agents and are the highest-value targets for shared bounded
  helpers and cache dedupe
- `stats/[agentId]` already validates `agentId`, so this session should reuse
  that boundary work and focus on async parsing plus bounded reads
- `lib/openclaw-skills.ts` is the right place to centralize async skill scans
  and content reads because both skills routes already depend on it
- `app/api/stats-models/route.ts` currently has no direct route-level
  regression coverage, so this session should add it while the route changes
  are still fresh

### Potential Challenges

- File-size and file-count limits must be strict enough to bound abuse without
  silently discarding routine operator data
- Cache TTLs that are too long can hide legitimate fresh runtime changes, but
  TTLs that are too short may not reduce enough filesystem churn
- Async migration must preserve the current success payloads so existing pages
  do not regress while the read internals change

### Relevant Considerations

- [P02] **Synchronous filesystem I/O in request paths**: move the targeted
  routes onto `fs/promises` and shared bounded helpers
- [P02] **Read-heavy endpoints still need bounds**: add file-size, file-count,
  and concurrency limits where analytics and skills scans fan out
- [P00] **Sanitized browser payloads**: keep operator-visible data useful
  without reintroducing raw path or internal-detail leakage
- [P00] **Co-located security tests**: keep regression coverage close to the
  helpers and routes that change

### Behavioral Quality Focus

Checklist active: Yes
Top behavioral risks for this session's deliverables:
- Cache dedupe or TTL choices keep stale analytics results around long enough
  to confuse operators
- Oversized or malformed runtime files still cause unbounded work or raw 500
  responses instead of safe partial failures
- Route contract drift breaks the home, models, pixel-office, or skills pages
  even though the backend hardening is correct

---

## 9. Testing Strategy

### Unit Tests

- Add helper tests for bounded directory scans, oversize-file handling, and
  keyed in-flight cache reuse
- Extend `lib/openclaw-skills.test.ts` for async listing, oversize content
  handling, and malformed recent-session snapshots

### Integration Tests

- Extend or add route tests for `stats-all`, `stats-models`,
  `activity-heatmap`, `stats/[agentId]`, `skills`, and `skills/content`
- Verify route success payloads stay stable while failures become sanitized

### Manual Testing

- Load the home page and confirm aggregate stats still render correctly
- Load the models page and confirm model rankings still render in order
- Load the pixel-office page and confirm activity heatmap data still appears
- Load the skills page, inspect skill metadata, and open a `SKILL.md` detail
  view successfully

### Edge Cases

- Oversized session files are skipped or rejected safely without blocking the
  entire response
- Malformed JSONL lines or malformed `skillsSnapshot` content do not crash the
  route
- Empty agent or skills directories return stable empty responses
- Concurrent requests for the same hot endpoint do not trigger duplicate
  expensive scans

---

## 10. Dependencies

### External Libraries

- None planned; reuse built-in Node APIs and existing project helpers

### Other Sessions

- **Depends on**: `phase02-session02-runtime-bridge-consolidation-and-safe-parsing`
- **Depended by**: `phase03-session01-state-cache-and-environment-hardening`,
  `phase03-session02-client-and-operational-cleanup`

---

## Next Steps

Run the implement workflow step to begin AI-led implementation.
