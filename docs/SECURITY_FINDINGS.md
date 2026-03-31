# OpenClaw Dashboard Security Findings Register

## Status Values

- `Open`: confirmed and not yet fixed
- `In Progress`: implementation started but not yet verified
- `Fixed`: code or docs changed, awaiting verification
- `Verified`: fix validated
- `Accepted`: risk intentionally accepted with rationale
- `Deferred`: planned for later work

## Canonical Scope

Canonical finding definitions and delivery mapping live in `.spec_system/PRD/PRD.md`, Appendix A and Appendix B. This file tracks status only.

## Register

| ID | Severity | Title | Status | Planned Session |
|----|----------|-------|--------|-----------------|
| SYN-01 | Critical | Gateway auth token leaked to any network client | Fixed | 00-02 |
| SYN-02 | Critical | No application-level authentication | Open | 00-01 |
| SYN-03 | Critical | Unauthenticated permanent runtime configuration mutation | Open | 00-01 / 00-03 / 01-02 |
| SYN-04 | Critical | Unauthenticated outbound messaging to real users | Open | 00-03 / 01-03 |
| SYN-05 | Critical | Zero-click side-effect triggering via `GET` aliases | Fixed | 00-03 |
| SYN-06 | High | Path traversal via unvalidated `[agentId]` URL segments | Open | 01-01 |
| SYN-07 | High | CSRF on all mutating endpoints | Open | 01-02 |
| SYN-08 | High | LLM API credit exhaustion and self-SSRF amplification | Open | 01-03 |
| SYN-09 | High | External platform rate limit lockout | Open | 01-03 |
| SYN-10 | High | Docker default binds to all network interfaces | Fixed | 00-03 |
| SYN-11 | High | Attacker-controlled inputs forwarded to gateway | Open | 01-01 / 01-02 |
| SYN-12 | High | AlertMonitor auto-triggers full attack pipeline on every page load | Open | 01-03 / 03-02 |
| SYN-13 | High | Uncached heavy endpoints with cascading unbounded reads | Verified | 01-03 / 02-03 |
| SYN-14 | Medium | Missing security response headers | Open | 01-03 |
| SYN-15 | Medium | Platform identity metadata and user IDs disclosed | Verified | 00-02 / 02-03 |
| SYN-16 | Medium | Absolute filesystem paths in skill listings | Verified | 00-02 / 02-03 |
| SYN-17 | Medium | Synchronous I/O blocks Node.js event loop | Verified | 02-03 |
| SYN-18 | Medium | No input validation on write payloads | Verified | 02-01 |
| SYN-19 | Medium | Duplicate CLI bridge with divergent behavior | Verified | 02-02 |
| SYN-20 | Medium | CLI output injection via `parseJsonFromMixedOutput` | Verified | 02-02 |
| SYN-21 | Medium | Unbounded file reads without size limits | Verified | 02-03 |
| SYN-22 | Medium | `resolveCronStorePath` follows arbitrary config-sourced paths | Verified | 01-01 / 02-02 |
| SYN-23 | Medium | Random-based cron alert logic sends real notifications | Open | 01-03 |
| SYN-24 | Medium | Platform credentials exercised without auth | Open | 00-03 / 01-03 |
| SYN-25 | Medium | GitHub API rate limit exhaustible via cache bypass | Open | 01-03 |
| SYN-26 | Low | Error responses leak internal filesystem paths | Verified | 02-01 / 02-03 |
| SYN-27 | Low | Non-atomic alert config write | Open | 03-01 |
| SYN-28 | Low | Config cache returns mutable reference | Open | 03-01 |
| SYN-29 | Low | Dormant Windows shell injection in `quoteShellArg` | Open | 02-02 |
| SYN-30 | Low | Environment variable overrides redirect all filesystem reads | Open | 03-01 |
| SYN-31 | Low | Uncaught `JSON.parse` crashes skills route | Verified | 02-02 |
| SYN-32 | Low | `localStorage` accumulates indefinitely | Open | 03-02 |
| SYN-33 | Low | Operational and reconnaissance intelligence leakage | Open | 02-03 / 03-02 |
| SYN-34 | Low | Code quality issues with security implications | Open | 02-02 / 03-02 |
| SYN-35 | Low | Cron and operational metadata exposed | Open | 02-03 / 03-02 |

## Verification Notes

- Phase 02 validation completed on 2026-03-31 and supports the Verified statuses for SYN-13, SYN-15, SYN-16, SYN-17, SYN-18, SYN-19, SYN-20, SYN-21, SYN-22, SYN-26, and SYN-31.
- See the phase 02 validation reports in `.spec_system/specs/phase02-session01-payload-validation-and-write-path-safety/validation.md`, `.spec_system/specs/phase02-session02-runtime-bridge-consolidation-and-safe-parsing/validation.md`, and `.spec_system/specs/phase02-session03-async-cached-sanitized-read-paths/validation.md`.

## Maintenance Rules

- Keep this register in sync with the latest PRD-backed understanding of the repo.
- When a finding changes status, add a short note or link in the related PR or spec session.
- Do not mark a finding `Verified` until the validation evidence exists.
- If a finding is split into smaller tasks, keep the parent SYN ID visible so the audit lineage is not lost.
