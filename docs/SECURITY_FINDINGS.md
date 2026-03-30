# OpenClaw Dashboard Security Findings Register

## Status Values

- `Open`: confirmed and not yet fixed
- `In Progress`: implementation started but not yet verified
- `Fixed`: code or docs changed, awaiting verification
- `Verified`: fix validated
- `Accepted`: risk intentionally accepted with rationale
- `Deferred`: planned for later work

## Register

| ID | Severity | Title | Status | Source |
|----|----------|-------|--------|--------|
| SYN-01 | Critical | Gateway auth token leaked to any network client | Open | `docs/ongoing-projects/security-audit-chunk-11-findings.md` |
| SYN-02 | Critical | No application-level authentication | Open | `docs/ongoing-projects/security-audit-chunk-11-findings.md` |
| SYN-03 | Critical | Unauthenticated permanent runtime configuration mutation | Open | `docs/ongoing-projects/security-audit-chunk-11-findings.md` |
| SYN-04 | Critical | Unauthenticated outbound messaging to real users | Open | `docs/ongoing-projects/security-audit-chunk-11-findings.md` |
| SYN-05 | Critical | Zero-click side-effect triggering via GET aliases | Open | `docs/ongoing-projects/security-audit-chunk-11-findings.md` |
| SYN-06 | High | Path traversal via unvalidated `[agentId]` URL segments | Open | `docs/ongoing-projects/security-audit-chunk-11-findings.md` |
| SYN-07 | High | CSRF on all mutating endpoints | Open | `docs/ongoing-projects/security-audit-chunk-11-findings.md` |
| SYN-08 | High | LLM API credit exhaustion and self-SSRF amplification | Open | `docs/ongoing-projects/security-audit-chunk-11-findings.md` |
| SYN-09 | High | External platform rate limit lockout | Open | `docs/ongoing-projects/security-audit-chunk-11-findings.md` |
| SYN-10 | High | Docker default binds to all network interfaces | Open | `docs/ongoing-projects/security-audit-chunk-11-findings.md` |
| SYN-11 | High | Attacker-controlled inputs forwarded to gateway | Open | `docs/ongoing-projects/security-audit-chunk-11-findings.md` |
| SYN-12 | High | AlertMonitor auto-triggers full attack pipeline on every page load | Open | `docs/ongoing-projects/security-audit-chunk-11-findings.md` |
| SYN-13 | High | Uncached heavy endpoints with cascading unbounded reads | Open | `docs/ongoing-projects/security-audit-chunk-11-findings.md` |
| SYN-14 | Medium | Missing security response headers | Open | `docs/ongoing-projects/security-audit-chunk-11-findings.md` |
| SYN-15 | Medium | Platform identity metadata and user IDs disclosed | Open | `docs/ongoing-projects/security-audit-chunk-11-findings.md` |
| SYN-16 | Medium | Absolute filesystem paths in skill listings | Open | `docs/ongoing-projects/security-audit-chunk-11-findings.md` |
| SYN-17 | Medium | Synchronous I/O blocks Node.js event loop | Open | `docs/ongoing-projects/security-audit-chunk-11-findings.md` |
| SYN-18 | Medium | No input validation on write payloads | Open | `docs/ongoing-projects/security-audit-chunk-11-findings.md` |
| SYN-19 | Medium | Duplicate CLI bridge with divergent behavior | Open | `docs/ongoing-projects/security-audit-chunk-11-findings.md` |
| SYN-20 | Medium | CLI output injection via `parseJsonFromMixedOutput` | Open | `docs/ongoing-projects/security-audit-chunk-11-findings.md` |
| SYN-21 | Medium | Unbounded file reads without size limits | Open | `docs/ongoing-projects/security-audit-chunk-11-findings.md` |
| SYN-22 | Medium | `resolveCronStorePath` follows arbitrary config-sourced paths | Open | `docs/ongoing-projects/security-audit-chunk-11-findings.md` |
| SYN-23 | Medium | Random-based cron alert logic sends real notifications | Open | `docs/ongoing-projects/security-audit-chunk-11-findings.md` |
| SYN-24 | Medium | Platform credentials exercised without auth | Open | `docs/ongoing-projects/security-audit-chunk-11-findings.md` |
| SYN-25 | Medium | GitHub API rate limit exhaustible via cache bypass | Open | `docs/ongoing-projects/security-audit-chunk-11-findings.md` |
| SYN-26 | Low | Error responses leak internal filesystem paths | Open | `docs/ongoing-projects/security-audit-chunk-11-findings.md` |
| SYN-27 | Low | Non-atomic alert config write | Open | `docs/ongoing-projects/security-audit-chunk-11-findings.md` |
| SYN-28 | Low | Config cache returns mutable reference | Open | `docs/ongoing-projects/security-audit-chunk-11-findings.md` |
| SYN-29 | Low | Dormant Windows shell injection in `quoteShellArg` | Open | `docs/ongoing-projects/security-audit-chunk-11-findings.md` |
| SYN-30 | Low | Environment variable overrides redirect all filesystem reads | Open | `docs/ongoing-projects/security-audit-chunk-11-findings.md` |
| SYN-31 | Low | Uncaught `JSON.parse` crashes skills route | Open | `docs/ongoing-projects/security-audit-chunk-11-findings.md` |
| SYN-32 | Low | `localStorage` accumulates indefinitely | Open | `docs/ongoing-projects/security-audit-chunk-11-findings.md` |
| SYN-33 | Low | Operational and reconnaissance intelligence leakage | Open | `docs/ongoing-projects/security-audit-chunk-11-findings.md` |
| SYN-34 | Low | Code quality issues with security implications | Open | `docs/ongoing-projects/security-audit-chunk-11-findings.md` |
| SYN-35 | Low | Cron and operational metadata exposed | Open | `docs/ongoing-projects/security-audit-chunk-11-findings.md` |

## Maintenance Rules

- Keep this register in sync with the latest audit-backed understanding of the repo.
- When a finding changes status, add a short note or link in the related PR or spec session.
- Do not mark a finding `Verified` until the validation evidence exists.
- If a finding is split into smaller tasks, keep the parent SYN ID visible so the audit lineage is not lost.
