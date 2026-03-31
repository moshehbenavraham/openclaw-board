# Session Specification

**Session ID**: `phase02-session02-runtime-bridge-consolidation-and-safe-parsing`
**Phase**: 02 - Runtime Boundary and Read Path Hardening
**Status**: Not Started
**Created**: 2026-03-31

---

## 1. Session Overview

This session moves the remaining OpenClaw runtime bridge logic onto one shared,
defensible helper surface so parser and subprocess fixes land once instead of
drifting across route-local copies. `lib/openclaw-cli.ts` already provides the
canonical execution path, but `lib/model-probe.ts` and
`app/api/gateway-health/route.ts` still carry duplicated CLI execution and
mixed-output parsing logic with different failure behavior.

The main goal is to harden the shared bridge against malformed mixed stdout or
stderr, route downstream consumers through that helper surface, and validate
the runtime file paths those consumers rely on before reading config-derived
OpenClaw data. That directly targets Pre-S19, Pre-S20, the runtime-path slice
of Pre-S22 and Pre-S30, and the malformed-runtime-data slice of Pre-S26.

This is the dependency session for the read-heavy work in Session 03. Async
read-path caching is safer once the bridge consumers already fail closed on
bad runtime output, share one parser contract, and stop trusting ad hoc
runtime path resolution.

---

## 2. Objectives

1. Consolidate OpenClaw CLI execution and mixed-output parsing behind one
   canonical helper surface in `lib/openclaw-cli.ts`.
2. Validate runtime file paths used by bridge consumers before reading
   `models.json` or other OpenClaw runtime files derived from env or config.
3. Route model-probe and gateway-health consumers through the shared bridge
   helper with sanitized malformed-output and command-failure handling.
4. Add regression coverage that proves malformed runtime output, invalid
   runtime paths, and missing probe matches fail closed without leaking raw
   internal details.

---

## 3. Prerequisites

### Required Sessions

- [x] `phase02-session01-payload-validation-and-write-path-safety` - bounded
  request parsing is already in place on the write routes that also depend on
  runtime helper behavior
- [x] `phase01-session01-route-boundary-validation` - shared path-boundary and
  invalid-request patterns already exist for reuse
- [x] `phase01-session03-abuse-resistance-and-deterministic-diagnostics` -
  diagnostic routes already have rate-limit and failure-state conventions

### Required Tools/Knowledge

- Node `child_process` and `execFile` behavior across supported platforms
- TypeScript helper design under `lib/`
- OpenClaw CLI probe commands and current consumer call sites
- Vitest module-mocking patterns for subprocess, DNS, and fetch behavior

### Environment Requirements

- `openclaw` CLI remains available on the server PATH for runtime bridge calls
- `OPENCLAW_HOME` points to the intended runtime root during local verification
- Sensitive route guards and feature-flag checks stay ahead of any bridge call
  sites touched in this session

---

## 4. Scope

### In Scope (MVP)

- Server can execute OpenClaw CLI commands through one shared helper surface
  with consistent timeout, parse, and error behavior
- Server can validate bridge-consumer runtime file paths before reading
  `models.json` or similar OpenClaw runtime files
- Server can reject malformed runtime JSON or missing probe matches with
  sanitized operator-facing failures instead of raw parser crashes
- Operator can keep using gateway health and provider probe diagnostics with
  the same success-path behavior after the shared bridge migration lands

### Out of Scope (Deferred)

- Async read-path caching and concurrency limits - *Reason: Session 03 owns
  the heavy read-surface hardening work*
- Non-atomic alert writes and mutable cache cleanup - *Reason: Phase 03 owns
  the remaining write-integrity cleanup*
- Broad client-side monitor cleanup and localStorage retention limits -
  *Reason: Phase 03 owns the residual client and operational cleanup*
- Final documentation closeout and accepted-risk decisions - *Reason: Phase 03
  owns project verification and documentation synchronization*

---

## 5. Technical Approach

### Architecture

Keep `lib/openclaw-cli.ts` as the one canonical bridge module. Expand it with a
stricter mixed-output parsing contract, typed result extraction, and reusable
helpers for common OpenClaw CLI probes so downstream consumers stop invoking
`child_process` or reimplementing parser loops on their own.

Use `lib/openclaw-paths.ts` for runtime-path validation instead of joining
OpenClaw file paths inline inside bridge consumers. `lib/model-probe.ts`
should resolve its `models.json` path through a boundary-checked helper before
reading any provider config, and `app/api/gateway-health/route.ts` should reuse
the shared bridge helpers for version and gateway-status probes while keeping
its route-local HTTP and web fallback sequencing intact.

The failure contract needs to stay explicit. Malformed CLI output, invalid
runtime paths, missing probe matches, or command failures should produce typed
or sanitized failures that downstream consumers can map to stable operator
responses without surfacing raw stderr, filesystem paths, or parser internals.

### Design Patterns

- Canonical bridge module: keep CLI execution and mixed-output parsing in one
  shared module instead of route-local copies
- Boundary-checked runtime file access: resolve runtime files through approved
  OpenClaw path helpers before reading them
- Fail-closed parser contract: treat malformed CLI output as invalid runtime
  data, not best-effort JSON
- Thin route consumers: keep `app/api/*/route.ts` focused on sequencing and
  response mapping, not subprocess details

### Technology Stack

- Next.js 16 route handlers
- TypeScript 5 shared helper modules under `lib/`
- Node `child_process`, `path`, and existing filesystem utilities
- Vitest for helper and route regression coverage

---

## 6. Deliverables

### Files to Create

| File | Purpose | Est. Lines |
|------|---------|------------|
| `None planned` | Reuse and harden the existing bridge and path modules instead of adding a second bridge surface | 0 |

### Files to Modify

| File | Changes | Est. Lines |
|------|---------|------------|
| `lib/openclaw-cli.ts` | Centralize stricter OpenClaw CLI execution, parse, and typed probe helpers | ~120 |
| `lib/openclaw-cli.test.ts` | Add malformed-output, stderr-fallback, and shared-helper regression coverage | ~140 |
| `lib/openclaw-paths.ts` | Add validated runtime file-path resolvers for bridge consumers | ~50 |
| `lib/openclaw-paths.test.ts` | Cover invalid runtime-path and boundary edge cases for the new resolvers | ~70 |
| `lib/model-probe.ts` | Remove duplicated CLI execution and parser logic, validate runtime config paths, and reuse the shared bridge helper | ~120 |
| `lib/model-probe.test.ts` | Cover malformed CLI output, invalid runtime paths, and fallback behavior after consolidation | ~140 |
| `app/api/gateway-health/route.ts` | Reuse the shared bridge helper for version and CLI health probes with sanitized failure mapping | ~90 |
| `app/api/gateway-health/route.test.ts` | Lock in CLI fallback success, malformed-output denial, and sanitized down-state behavior | ~90 |
| `lib/session-test-fallback.ts` | Align fallback parsing with the hardened shared bridge contract | ~30 |
| `lib/session-test-fallback.test.ts` | Cover malformed output and fallback parsing behavior after helper changes | ~40 |

---

## 7. Success Criteria

### Functional Requirements

- [ ] Duplicate OpenClaw CLI execution and mixed-output parsing are removed from
      `lib/model-probe.ts` and `app/api/gateway-health/route.ts`
- [ ] Bridge consumers read runtime files only through validated OpenClaw path
      helpers instead of ad hoc joins
- [ ] Malformed runtime output, missing probe matches, and invalid runtime
      paths fail closed with sanitized operator-visible errors
- [ ] Gateway health and provider probe success responses preserve their
      current operator-visible shape after consolidation

### Testing Requirements

- [ ] Unit tests cover malformed mixed output, stderr fallback, typed helper
      contracts, and runtime-path boundary rejection
- [ ] Model-probe tests cover malformed CLI output, invalid runtime paths, and
      safe fallback behavior
- [ ] Gateway-health tests cover CLI fallback success, malformed CLI output,
      and sanitized down-state behavior
- [ ] Manual testing covers one successful gateway health check plus one
      provider probe success and one malformed-runtime failure path

### Non-Functional Requirements

- [ ] No new runtime bridge consumer shells out outside `lib/openclaw-cli.ts`
- [ ] Client-visible errors never expose raw stderr, parser stack traces, or
      internal filesystem paths
- [ ] Shared helper changes do not add new package dependencies

### Quality Gates

- [ ] All files ASCII-encoded
- [ ] Unix LF line endings
- [ ] Code follows project conventions

---

## 8. Implementation Notes

### Key Considerations

- `lib/openclaw-cli.ts` already exists and should remain the single bridge
  module; the goal is to expand and reuse it, not introduce another duplicate
  helper layer
- `lib/model-probe.ts` currently duplicates both subprocess execution and mixed
  JSON parsing, then reads `models.json` from a path derived from
  `OPENCLAW_HOME` without a dedicated runtime-file resolver
- `app/api/gateway-health/route.ts` repeats CLI execution and parsing for
  version and status probes even though the shared bridge already owns that
  logic

### Potential Challenges

- OpenClaw CLI output may mix JSON with warnings on stdout or stderr, so the
  shared parser needs to reject malformed candidates without breaking valid
  mixed output
- Route consumers need enough structured failure detail to decide between
  healthy, degraded, and down states without passing raw command errors to the
  client
- Runtime-path validation must stay strict enough to reject unsafe overrides
  without blocking legitimate OpenClaw home layouts

### Relevant Considerations

- [P01] **Duplicate CLI bridge code**: remove mirrored execution and parsing
  logic instead of hardening multiple copies
- [P02] **Config-sourced path overrides still need an allowlist boundary**:
  keep runtime file resolution behind shared path helpers
- [P00] **Duplicating bridge/CLI code across files**: future fixes need one
  landing zone, not route-local drift
- [P00] **Trusting config-sourced file paths without validation**: treat every
  runtime file path as untrusted until it passes the shared boundary helper

### Behavioral Quality Focus

Checklist active: Yes
Top behavioral risks for this session's deliverables:
- Malformed CLI output crashes diagnostics or leaks raw stderr instead of
  returning a stable operator-facing failure
- Runtime path overrides escape the intended OpenClaw boundary and read the
  wrong file
- Gateway health misclassifies fallback states after the bridge helpers change

---

## 9. Testing Strategy

### Unit Tests

- Harden `lib/openclaw-cli.test.ts` around malformed mixed output, stderr-only
  JSON, empty output, and typed helper response contracts
- Extend `lib/openclaw-paths.test.ts` for runtime file resolver allowlist and
  boundary rejection behavior

### Integration Tests

- Extend `lib/model-probe.test.ts` to verify shared-helper reuse, invalid
  runtime-path rejection, and safe fallback handling
- Extend `app/api/gateway-health/route.test.ts` to verify version and CLI
  probes route through the shared helper and return sanitized failures

### Manual Testing

- Run one healthy `/api/gateway-health` probe against a local runtime
- Run one successful `/api/test-model` provider probe and one malformed-runtime
  failure path
- Confirm no response body exposes raw stderr, raw parser text, or absolute
  filesystem paths

### Edge Cases

- Mixed stdout and stderr where the first brace-delimited chunk is not valid
  JSON
- Provider probe output that returns no matching result for the requested
  provider or model
- Missing or invalid `models.json` path resolution under `OPENCLAW_HOME`
- Gateway CLI probe succeeds after HTTP and web fallback probes fail

---

## 10. Dependencies

### External Libraries

- None planned: reuse Node built-ins and existing project helpers

### Other Sessions

- **Depends on**: `phase02-session01-payload-validation-and-write-path-safety`
- **Depended by**: `phase02-session03-async-cached-sanitized-read-paths`

---

## Next Steps

Run the `implement` workflow step to begin AI-led implementation.
