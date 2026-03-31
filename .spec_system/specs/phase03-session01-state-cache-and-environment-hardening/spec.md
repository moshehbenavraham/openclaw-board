# Session Specification

**Session ID**: `phase03-session01-state-cache-and-environment-hardening`
**Phase**: 03 - Residual Risk Cleanup and Closeout
**Status**: Complete
**Created**: 2026-03-31

---

## 1. Session Overview

This session opens Phase 03 by closing the remaining low-level runtime
integrity gaps that still sit underneath the hardened route and read-path
surface. The concrete risks are already mapped in the PRD as SYN-27,
SYN-28, and SYN-30: alert configuration writes still use non-atomic file
replacement, `lib/config-cache.ts` still exposes mutable shared references,
and filesystem roots derived from environment assumptions still need a
single hard boundary. The highest-value code paths are
`app/api/alerts/route.ts`, `app/api/alerts/check/route.ts`,
`lib/config-cache.ts`, `app/api/config/route.ts`, and
`lib/openclaw-paths.ts`.

The technical goal is to centralize alert configuration loading and
persistence behind one shared helper that uses rename-and-swap writes,
make the config cache safe to reuse without reference leaks, and validate
OpenClaw runtime roots before routes build paths or touch the filesystem.
That keeps the remaining runtime hazards aligned with the existing
centralized-helper strategy instead of fixing them piecemeal inside route
handlers.

Session 03-02 depends on these runtime guarantees before it tightens client
polling, storage retention, and destructive-action affordances. Session
03-03 depends on them for final verification evidence. Completing this
session should leave the remaining closeout work focused on browser
behavior and documentation rather than unresolved core integrity issues.

---

## 2. Objectives

1. Introduce shared alert-config read and write helpers that normalize
   defaults and persist updates atomically across alert write surfaces.
2. Make the config cache return safe cloned or immutable snapshots so
   callers cannot mutate canonical cached state by reference.
3. Validate OpenClaw runtime root assumptions and env-driven path
   resolution before any filesystem access occurs on the touched paths.
4. Add regression coverage for partial-write protection, cache isolation,
   and operator-safe failures when runtime path assumptions are invalid.

---

## 3. Prerequisites

### Required Sessions

- [x] `phase02-session02-runtime-bridge-consolidation-and-safe-parsing` -
  shared path-boundary and sanitized-failure patterns are already available
  for reuse
- [x] `phase02-session03-async-cached-sanitized-read-paths` - current
  read-path helpers and route-level sanitized error conventions should stay
  intact while runtime integrity is tightened
- [x] `phase01-session02-sensitive-route-enforcement-and-operator-failure-states`
  - alert mutation auth, method, and feature-flag controls already exist and
  must remain unchanged

### Required Tools/Knowledge

- Node filesystem persistence patterns, especially temp-file plus rename
  workflows
- Existing OpenClaw path-boundary helpers in `lib/openclaw-paths.ts`
- Current alert mutation and diagnostics behavior in `app/api/alerts/*`
- Existing config route caching behavior and its tests
- Vitest temp-directory and route-testing patterns already used in the repo

### Environment Requirements

- `OPENCLAW_HOME` points to a representative local runtime tree for manual
  verification
- Dashboard auth env variables are available for protected alert-route tests
- No new package dependencies are required; the solution should stay on
  built-in Node APIs and existing project utilities

---

## 4. Scope

### In Scope (MVP)

- Server can read and persist alert config through one shared helper that
  uses atomic rename-and-swap writes and preserves current default rule
  normalization
- Server can persist live-send `lastAlerts` updates through the same atomic
  helper used by direct alert writes
- Cache consumers can read config snapshots without receiving a mutable
  reference to the canonical cached object
- Runtime path helpers can validate OpenClaw root assumptions and reject
  env-driven or config-derived paths that escape approved boundaries
- Touched routes keep operator-safe success payloads and sanitized failure
  responses

### Out of Scope (Deferred)

- Browser storage pruning, polling dedupe, and destructive-action
  confirmations - *Reason: Session 03-02 owns the remaining client and
  operational cleanup scope*
- Final validation matrix execution and documentation reconciliation -
  *Reason: Session 03-03 owns project closeout evidence and docs alignment*
- New auth boundaries, deployment redesign, or Cloudflare Access changes -
  *Reason: the closeout phase preserves the current hardened deployment
  model instead of replacing it*
- Lower-priority read-route cleanup outside the targeted runtime hazards,
  such as `agent-status` or pixel-office polling refinements - *Reason:
  keep this session within the 2-4 hour cap and focused on SYN-27, SYN-28,
  and SYN-30*

---

## 5. Technical Approach

### Architecture

Create a shared `lib/alert-config.ts` module that owns default-rule
normalization, config loading, and atomic persistence for `alerts.json`.
Both `app/api/alerts/route.ts` and `app/api/alerts/check/route.ts` should
depend on that helper instead of duplicating load and save behavior. The
write path should use a temp file in the same directory plus `renameSync`
or equivalent same-volume replacement so interrupted writes do not leave a
partial config behind.

Harden `lib/config-cache.ts` at the cache boundary rather than relying on
callers to treat shared data as read-only. The cache should store a
canonical internal copy and return defensive clones or an immutable
snapshot on every read so `app/api/config/route.ts` can reuse cache hits
without exposing a mutable reference that later code can corrupt.

Extend `lib/openclaw-paths.ts` to resolve OpenClaw roots and derived files
through validated helpers instead of open-coding `path.join(OPENCLAW_HOME,
...)` in the touched routes. `app/api/config/route.ts` and the alert routes
should fail safely when runtime root assumptions are invalid, preserving
sanitized operator-facing error responses instead of leaking raw paths or
throw details.

### Design Patterns

- Shared atomic persistence helper: centralize `alerts.json` load and save
  behavior so write-safety fixes land once
- Defensive cache boundary: clone or freeze at the cache layer instead of
  trusting every caller
- Validated root resolver: resolve filesystem roots once and reject escape
  attempts at the boundary closest to the filesystem
- Thin route handlers: keep route files focused on auth, feature flags,
  orchestration, and response mapping
- Sanitized failure contracts: preserve stable operator-facing 4xx and 5xx
  responses when env assumptions or writes fail

### Technology Stack

- Next.js 16 route handlers
- TypeScript 5 shared helpers under `lib/`
- Node `fs`, `path`, and `structuredClone` or equivalent defensive-copy
  utilities
- Existing OpenClaw path helpers and security guard utilities
- Vitest for helper and route regression coverage

---

## 6. Deliverables

### Files to Create

| File | Purpose | Est. Lines |
|------|---------|------------|
| `lib/alert-config.ts` | Shared alert-config defaults, load helpers, and atomic persistence used by alert routes | ~140 |
| `lib/alert-config.test.ts` | Regression coverage for default fallback, legacy-rule normalization, and atomic-write failure cleanup | ~120 |

### Files to Modify

| File | Changes | Est. Lines |
|------|---------|------------|
| `app/api/alerts/route.ts` | Replace route-local alert config load/save logic with the shared atomic helper and sanitized failure mapping | ~80 |
| `app/api/alerts/route.test.ts` | Extend route coverage for atomic persistence, failure cleanup, and stable client-safe errors | ~90 |
| `app/api/alerts/check/route.ts` | Reuse the shared atomic helper for live-send `lastAlerts` persistence and validated config reads | ~90 |
| `app/api/alerts/check/route.test.ts` | Add coverage for live-send persistence and safe failure behavior | ~100 |
| `lib/config-cache.ts` | Harden cache storage and reads with defensive cloning or immutability | ~40 |
| `lib/config-cache.test.ts` | Add isolation coverage proving callers cannot mutate canonical cached state | ~60 |
| `lib/openclaw-paths.ts` | Add validated OpenClaw root and derived-path helpers for env-boundary enforcement | ~70 |
| `lib/openclaw-paths.test.ts` | Extend path-boundary coverage for invalid roots and override handling | ~90 |
| `app/api/config/route.ts` | Serve safe cached snapshots and validated runtime-derived paths with sanitized failures | ~80 |
| `app/api/config/route.test.ts` | Add cache-isolation and invalid-root regression coverage for the config route | ~70 |

---

## 7. Success Criteria

### Functional Requirements

- [ ] Alert config writes never leave a partial `alerts.json` behind on write
      failure or process interruption during replacement
- [ ] Live-send alert diagnostics persist `lastAlerts` through the same safe
      atomic write path used by alert mutation routes
- [ ] Cache consumers cannot mutate the canonical config cache object by
      reference
- [ ] Invalid OpenClaw root assumptions are rejected before touched routes
      read or write runtime files
- [ ] Existing alert and config success payloads remain compatible with the
      current dashboard consumers

### Testing Requirements

- [ ] Helper tests cover atomic-write replacement, failure cleanup, and
      legacy-rule normalization for alert config
- [ ] Cache tests prove callers receive isolated snapshots instead of mutable
      shared references
- [ ] Route tests cover alert writes, alert diagnostics persistence, and
      config reads when runtime roots are invalid or unavailable
- [ ] Manual testing covers alert configuration updates, alert diagnostics,
      and config-page reads against a representative local runtime

### Non-Functional Requirements

- [ ] No new package dependencies are added
- [ ] Client-visible failures do not expose raw filesystem paths, temp-file
      names, or thrown `err.message` values
- [ ] Runtime file access remains constrained to validated OpenClaw roots
- [ ] Cached config reads remain deterministic enough for repeatable tests
      and operator debugging

### Quality Gates

- [ ] All files ASCII-encoded
- [ ] Unix LF line endings
- [ ] Code follows project conventions

---

## 8. Implementation Notes

### Key Considerations

- `app/api/alerts/route.ts` and `app/api/alerts/check/route.ts` currently
  duplicate alert-config defaults, legacy-rule normalization, and write
  behavior; this session should fix that once in a shared helper
- `app/api/config/route.ts` is the primary cache consumer today, but the fix
  belongs in `lib/config-cache.ts` so future callers inherit the same safety
- `lib/openclaw-paths.ts` already owns path-boundary helpers, so OpenClaw
  root validation should land there rather than inside route handlers
- The touched routes already have sanitized error contracts and should keep
  them when path or persistence assumptions fail

### Potential Challenges

- Atomic replacement must leave no stale temp files behind when writes or
  renames fail
- Defensive cloning must preserve JSON-like config data without introducing
  surprising behavior for existing cache consumers
- Stricter root validation can break tests or local workflows if the failure
  contract is not explicit and operator-safe

### Relevant Considerations

- [P03] **Atomic alert config writes**: replace direct `writeFileSync` alert
  persistence with crash-safe rename-and-swap behavior
- [P03] **Mutable config cache**: treat cached config as an internal
  implementation detail and return safe copies to callers
- [P03] **Environment path overrides need a hard boundary**: validate
  OpenClaw root assumptions before routes derive file paths
- [P02] **Boundary-checked runtime path resolvers**: extend the existing
  shared-path pattern instead of adding route-local fallback joins
- [P02] **Stable sanitized failure contracts**: preserve client-safe route
  responses even when file access or runtime assumptions fail

### Behavioral Quality Focus

Checklist active: Yes
Top behavioral risks for this session's deliverables:

- Partial alert-config replacement can corrupt operational state if a write
  fails mid-update
- Mutable cache snapshots can cause stale or inconsistent config responses
  after later code mutates shared objects
- Overly permissive or overly strict root validation can either reopen path
  hazards or break healthy local runtime behavior without clear operator
  feedback

---

## 9. Testing Strategy

### Unit Tests

- Cover shared alert-config load, legacy-rule normalization, atomic writes,
  and failure cleanup in `lib/alert-config.test.ts`
- Cover config-cache clone isolation and overwrite behavior in
  `lib/config-cache.test.ts`
- Cover validated root resolution and override rejection in
  `lib/openclaw-paths.test.ts`

### Integration Tests

- Cover POST and PUT alert writes through the shared atomic helper in
  `app/api/alerts/route.test.ts`
- Cover live-send `lastAlerts` persistence and sanitized failures in
  `app/api/alerts/check/route.test.ts`
- Cover cached config reads and invalid-root handling in
  `app/api/config/route.test.ts`

### Manual Testing

- Update alert settings from the alerts page and confirm reloads preserve the
  saved config
- Run alert diagnostics in dry-run and live-send modes against a local test
  runtime and confirm state stays consistent
- Load config-dependent dashboard surfaces after cache hits and invalid-root
  scenarios to confirm operator-safe behavior

### Edge Cases

- Existing `alerts.json` missing or malformed
- Temp-file creation or rename failure during alert-config persistence
- Invalid or empty `OPENCLAW_HOME` assumptions for touched runtime paths
- Cache consumer mutates a returned snapshot and the canonical cache remains
  unchanged

---

## 10. Dependencies

### External Libraries

- None new; stay on built-in Node and existing project utilities

### Other Sessions

- **Depends on**:
  `phase01-session02-sensitive-route-enforcement-and-operator-failure-states`,
  `phase02-session02-runtime-bridge-consolidation-and-safe-parsing`,
  `phase02-session03-async-cached-sanitized-read-paths`
- **Depended by**:
  `phase03-session02-client-and-operational-cleanup`,
  `phase03-session03-verification-and-closeout`

---

## Next Steps

Run the `implement` workflow step to begin AI-led implementation.
