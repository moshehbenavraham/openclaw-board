# Security & Compliance

> Cumulative security posture and GDPR compliance record. Updated between phases via /carryforward.
> **Line budget**: 1000 max | **Last updated**: Phase 02 (2026-03-31)

---

## Current Security Posture

### Overall: AT RISK

Phase 02 closed the scoped write, bridge, and heavy read-path issues, but the project still carries a substantial set of open auth, abuse, and cleanup findings.

| Metric | Value |
|--------|-------|
| Open Findings | 24 |
| Critical/High | 10 |
| Medium/Low | 14 |
| Phases Audited | 3 |
| Last Clean Phase | -- |

---

## Open Findings

Active security or GDPR issues requiring attention. Ordered by severity.

| ID | Severity | File | Description | Remediation | Opened |
|----|----------|------|-------------|-------------|--------|
| SYN-02 | Critical | `app/api/` (most GET routes) | Sensitive read routes still expose operational data without a universal application-level auth boundary. | Apply `requireSensitiveRouteAccess` or an equivalent guard to every sensitive route and keep the allowlist under review. | Pre (2026-03-30) |
| SYN-03 | Critical | `app/api/config/agent-model/route.ts`, `app/api/alerts/route.ts` | The broader write surface still needs complete enforcement even after the phase 00 baseline. | Enforce `requireSensitiveRouteAccess` plus feature flags on every mutation endpoint and verify no unauthenticated write path remains. | Pre (2026-03-30) |
| SYN-04 | Critical | `app/api/test-session/route.ts`, `app/api/test-dm-sessions/route.ts` | Outbound messaging remains a high-risk capability that must stay tightly gated and reviewable. | Keep live-send behind `ENABLE_OUTBOUND_TESTS` plus `requireSensitiveRouteAccess`, with dry-run as the default path. | Pre (2026-03-30) |
| SYN-06 | High | `app/api/sessions/[agentId]/route.ts`, `app/api/stats/[agentId]/route.ts` | `agentId` values still need strict validation before any filesystem path construction. | Enforce an allowlist or strict pattern and reject traversal sequences. | Pre (2026-03-30) |
| SYN-07 | High | All POST/PUT/PATCH/DELETE routes | Mutation routes still need explicit origin or CSRF defenses. | Add Origin validation or a dedicated CSRF strategy and reject cross-origin mutations. | Pre (2026-03-30) |
| SYN-08 | High | `lib/model-probe.ts`, `app/api/alerts/check/route.ts` | Provider probe and alert-check flows still require stronger throttling and SSRF resistance. | Keep these routes behind feature flags and auth, add rate limits, and remove self-SSRF patterns. | Pre (2026-03-30) |
| SYN-09 | High | `app/api/test-session/route.ts`, `app/api/test-dm-sessions/route.ts` | Diagnostic traffic can still threaten external platform rate limits if it is not bounded tightly enough. | Keep rate limits in place and preserve the auth and feature-flag gate. | Pre (2026-03-30) |
| SYN-11 | High | `app/api/config/agent-model/route.ts`, session and test routes | Route inputs still need strict sanitization before they are forwarded to gateway calls. | Validate and sanitize all user inputs before gateway invocation; use allowlists for known parameters. | Pre (2026-03-30) |
| SYN-12 | High | `app/alert-monitor.tsx` | Client-side polling remains an abuse multiplier until it is fully auth-aware and backoff-limited. | Gate polling behind auth status checks, deduplicate across tabs, and add backoff. | Pre (2026-03-30) |
| SYN-13 | High | `app/api/stats-all/route.ts`, `app/api/activity-heatmap/route.ts` | Read-heavy analytics endpoints still need bounded caching and concurrency control. | Add response caching with stampede protection and impose file-count and size limits. | Pre (2026-03-30) |
| SYN-14 | Medium | `middleware.ts` (partial coverage) | Header coverage is still incomplete. | Tighten the response-header set after the remaining route hardening stabilizes. | Pre (2026-03-30) |
| SYN-17 | Medium | Multiple route handlers | Hot-path sync reads still block the event loop in parts of the repo that phase 02 did not touch. | Move the remaining request-time reads to `fs/promises`. | Pre (2026-03-30) |
| SYN-23 | Medium | `app/api/alerts/check/route.ts` | Randomized notification behavior still needs deterministic control. | Remove random-send behavior or keep it behind explicit opt-in test controls. | Pre (2026-03-30) |
| SYN-24 | Medium | Test and probe routes | Diagnostic routes still represent a sensitive credential-exercising surface. | Keep them behind auth and feature flags, and preserve dry-run defaults. | Pre (2026-03-30) |
| SYN-25 | Medium | `app/api/pixel-office/version/route.ts` | Release checks still need persistent cache discipline. | Add cache protection and avoid repeated release probes on demand. | Pre (2026-03-30) |
| SYN-26 | Low | Multiple error handlers | Some errors still reveal internal path details. | Normalize client-facing errors and redact internal paths. | Pre (2026-03-30) |
| SYN-27 | Low | `app/api/alerts/route.ts` | Alert writes still need crash-safe persistence. | Switch to rename-and-swap writes. | Pre (2026-03-30) |
| SYN-28 | Low | `lib/config-cache.ts` | Shared cache objects can still be mutated by callers. | Return clones or enforce immutability before mutation points. | Pre (2026-03-30) |
| SYN-29 | Low | `lib/openclaw-cli.ts` | Windows shell escaping remains fragile. | Harden the helper or remove the shell path entirely. | Pre (2026-03-30) |
| SYN-30 | Low | `lib/openclaw-paths.ts` | Environment overrides still need a path boundary. | Validate overrides against approved directories before any read. | Pre (2026-03-30) |
| SYN-32 | Low | Client-side state management | Browser state still needs bounding and pruning. | Add expiration and size limits. | Pre (2026-03-30) |
| SYN-33 | Low | Stats, config, and health responses | Responses still reveal more operational metadata than the dashboard needs. | Continue trimming browser-visible telemetry and internal detail. | Pre (2026-03-30) |
| SYN-34 | Low | Multiple files | Small quality issues still carry security impact when they sit on request paths. | Keep cleanup tied to security-sensitive code changes. | Pre (2026-03-30) |
| SYN-35 | Low | `app/api/stats-all/route.ts`, `app/api/stats-models/route.ts`, `app/api/activity-heatmap/route.ts`, `app/api/skills/*` | Operational and cron-adjacent metadata can still leak through read routes. | Trim browser-visible telemetry and keep the read-path sanitization policy consistent. | Pre (2026-03-30) |

---

## Resolved Findings

Phase 02 closures are summarized below. Older phase-00 closures remain documented in the prior phase history and are not repeated here.

| ID | Item | Resolution | Date | Phase |
|----|------|------------|------|-------|
| SYN-18 | No input validation on write payloads | Added bounded JSON parsing and route-specific payload ceilings before privileged work could begin. | 2026-03-31 | P02 |
| SYN-19 | Duplicate CLI bridge with divergent behavior | Consolidated consumers onto shared bridge helpers and removed route-local parser drift. | 2026-03-31 | P02 |
| SYN-20 | CLI output injection via `parseJsonFromMixedOutput` | Hardened the mixed-output parse contract and kept bridge failures sanitized. | 2026-03-31 | P02 |
| SYN-21 | Unbounded file reads without size limits | Added bounded async read helpers and entry and byte ceilings on heavy read routes. | 2026-03-31 | P02 |
| SYN-22 | `resolveCronStorePath` follows arbitrary config-sourced paths | Moved config-backed runtime path resolution behind boundary checks. | 2026-03-31 | P02 |
| SYN-31 | Uncaught `JSON.parse` crashes skills route | Moved skills discovery and content reads onto safe async helpers with explicit error mapping. | 2026-03-31 | P02 |

---

## Personal Data Inventory

No new personal-data collection, storage, or third-party sharing paths were introduced in phase 02.

| Data Element | Package | Status | Notes |
|--------------|---------|--------|-------|
| None newly introduced | N/A | Unchanged | The touched routes read local runtime files and return operator-facing summaries only. |

---

## Dependency Audit

Current state only. Phase 02 added no new packages.

| Dependency / Surface | Current State | Note |
|----------------------|---------------|------|
| npm packages | Unchanged | No dependency changes were introduced in the phase 02 sessions. |
| Cloudflare Access / Tunnel | Still required | Non-local operator access still depends on the documented Access plus Tunnel deployment model. |
| GitHub API usage | Still rate-limit sensitive | Cache discipline remains important for release-check and metadata routes. |
| OpenClaw gateway / CLI bridge | Hardened but still high value | The shared bridge now fails closed, but the upstream runtime remains a privileged dependency. |

---

## Phase History

Keep the last five phases of detail. Current view includes the three completed phases in this project.

| Phase | Name | Sessions | Summary |
|-------|------|----------|---------|
| P00 | Foundation | 3 | Closed the token-leak, side-effect alias, and secure-default baseline issues while establishing the operator auth model. |
| P01 | Sensitive Route Hardening | 3 | Added consistent route guards, boundary validation, and abuse-resistance controls across the sensitive surfaces. |
| P02 | Runtime Boundary and Read Path Hardening | 3 | Added bounded write parsing, shared runtime bridge helpers, and bounded async read paths with sanitized failures. |

---

## GDPR Review

### Status: N/A

The phase 02 sessions did not introduce new personal-data collection, storage, logging, or third-party sharing paths.

---

## Behavioral Quality Spot-Check

### Result: PASS

The phase 02 deliverables were reviewed at the session level and passed their targeted validation runs. No new security findings were introduced by the scoped write, bridge, or read-path changes.

---

*Auto-generated by carryforward. Manual edits allowed but may be overwritten.*
