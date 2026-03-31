# OpenClaw Dashboard Security Findings Register

## Status Values

- `Open`: confirmed and not yet fixed
- `In Progress`: implementation started but not yet verified
- `Fixed`: code or docs changed, awaiting verification
- `Verified`: fix validated
- `Accepted`: risk intentionally accepted with rationale
- `Deferred`: planned for later work

## Canonical Scope

Canonical finding definitions and delivery mapping live in
`.spec_system/PRD/PRD.md`, Appendix A and Appendix B. This file tracks live
status and closeout evidence only.

## Closeout Summary

| Metric | Value |
|--------|-------|
| Total Findings | 35 |
| Verified | 34 |
| Accepted | 1 |
| Open | 0 |

## Register

| ID | Severity | Title | Status | Planned Session |
|----|----------|-------|--------|-----------------|
| SYN-01 | Critical | Gateway auth token leaked to any network client | Verified | 00-02 |
| SYN-02 | Critical | No application-level authentication | Verified | 00-01 |
| SYN-03 | Critical | Unauthenticated permanent runtime configuration mutation | Verified | 00-01 / 00-03 / 01-02 |
| SYN-04 | Critical | Unauthenticated outbound messaging to real users | Verified | 00-03 / 01-03 |
| SYN-05 | Critical | Zero-click side-effect triggering via `GET` aliases | Verified | 00-03 |
| SYN-06 | High | Path traversal via unvalidated `[agentId]` URL segments | Verified | 01-01 |
| SYN-07 | High | CSRF on all mutating endpoints | Verified | 01-02 |
| SYN-08 | High | LLM API credit exhaustion and self-SSRF amplification | Verified | 01-03 |
| SYN-09 | High | External platform rate limit lockout | Verified | 01-03 |
| SYN-10 | High | Docker default binds to all network interfaces | Verified | 00-03 |
| SYN-11 | High | Attacker-controlled inputs forwarded to gateway | Verified | 01-01 / 01-02 |
| SYN-12 | High | AlertMonitor auto-triggers full attack pipeline on every page load | Verified | 01-03 / 03-02 |
| SYN-13 | High | Uncached heavy endpoints with cascading unbounded reads | Verified | 01-03 / 02-03 |
| SYN-14 | Medium | Missing security response headers | Verified | 01-03 / 03-02 |
| SYN-15 | Medium | Platform identity metadata and user IDs disclosed | Verified | 00-02 / 02-03 |
| SYN-16 | Medium | Absolute filesystem paths in skill listings | Verified | 00-02 / 02-03 |
| SYN-17 | Medium | Synchronous I/O blocks Node.js event loop | Verified | 02-03 |
| SYN-18 | Medium | No input validation on write payloads | Verified | 02-01 |
| SYN-19 | Medium | Duplicate CLI bridge with divergent behavior | Verified | 02-02 |
| SYN-20 | Medium | CLI output injection via `parseJsonFromMixedOutput` | Verified | 02-02 |
| SYN-21 | Medium | Unbounded file reads without size limits | Verified | 02-03 |
| SYN-22 | Medium | `resolveCronStorePath` follows arbitrary config-sourced paths | Verified | 01-01 / 02-02 |
| SYN-23 | Medium | Random-based cron alert logic sends real notifications | Verified | 01-03 |
| SYN-24 | Medium | Platform credentials exercised without auth | Verified | 00-03 / 01-03 |
| SYN-25 | Medium | GitHub API rate limit exhaustible via cache bypass | Verified | 01-03 |
| SYN-26 | Low | Error responses leak internal filesystem paths | Verified | 02-01 / 02-03 |
| SYN-27 | Low | Non-atomic alert config write | Verified | 03-01 |
| SYN-28 | Low | Config cache returns mutable reference | Verified | 03-01 |
| SYN-29 | Low | Dormant Windows shell injection in `quoteShellArg` | Accepted | 02-02 |
| SYN-30 | Low | Environment variable overrides redirect all filesystem reads | Verified | 03-01 |
| SYN-31 | Low | Uncaught `JSON.parse` crashes skills route | Verified | 02-02 |
| SYN-32 | Low | `localStorage` accumulates indefinitely | Verified | 03-02 |
| SYN-33 | Low | Operational and reconnaissance intelligence leakage | Verified | 02-03 / 03-02 |
| SYN-34 | Low | Code quality issues with security implications | Verified | 02-02 / 03-02 |
| SYN-35 | Low | Cron and operational metadata exposed | Verified | 02-03 / 03-02 |

## Verification Notes

- Phase 00 validation reports on 2026-03-31 support the Verified status for
  SYN-01, SYN-02, SYN-03, SYN-04, SYN-05, SYN-10, SYN-15, SYN-16, and
  SYN-24.
- Phase 01 validation reports on 2026-03-31 support the Verified status for
  SYN-06, SYN-07, SYN-08, SYN-09, SYN-11, SYN-12, SYN-14, SYN-23, and
  SYN-25.
- Phase 02 validation reports on 2026-03-31 support the Verified status for
  SYN-13, SYN-17, SYN-18, SYN-19, SYN-20, SYN-21, SYN-22, SYN-26, SYN-31,
  SYN-33, SYN-34, and SYN-35.
- Phase 03 validation reports on 2026-03-31 support the Verified status for
  SYN-12, SYN-14, SYN-27, SYN-28, SYN-30, SYN-32, SYN-33, SYN-34, and
  SYN-35.
- Closeout evidence recorded in
  `.spec_system/specs/phase03-session03-verification-and-closeout/implementation-notes.md`
  adds a fresh `npm test`, `npm run build`, page-smoke, token-free config,
  sanitized gateway-health, 405 method enforcement, 400 traversal rejection,
  and protected-route denial pass on 2026-03-31.

## Accepted Risk Notes

- SYN-29 is accepted for the current closeout because the remaining
  `quoteShellArg` path only exists in the `win32` `cmd.exe` fallback inside
  `lib/openclaw-cli.ts`, while the documented supported deployment model is
  localhost or Linux server hosting behind Cloudflare Access plus Tunnel.
  Re-open this item if Windows becomes a supported deployment target or if a
  future bridge change expands that shell path.

## Maintenance Rules

- Keep this register in sync with the latest PRD-backed understanding of the
  repo.
- When a finding changes status, add a short note or link in the related PR or
  spec session.
- Do not mark a finding `Verified` until validation evidence exists.
- If a finding is split into smaller tasks, keep the parent SYN ID visible so
  the audit lineage is not lost.
