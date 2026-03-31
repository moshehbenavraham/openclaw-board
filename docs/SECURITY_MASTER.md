# OpenClaw Dashboard Security Master Plan

## Purpose

This document is the living security plan for OpenClaw Dashboard. The
canonical in-scope backlog lives in `.spec_system/PRD/PRD.md`.
`docs/ongoing-projects/security-items-outside-prd-scope.md` is reserved for
work intentionally excluded from that PRD.

Use this file as the top-level security policy source. Use
`docs/SECURITY_FINDINGS.md` as the live register for individual finding
statuses and closeout evidence.

## Current Security Posture

- The audit baseline captured 35 unique findings after deduplication.
- Closeout verification on 2026-03-31 left 34 findings Verified and 1 finding
  Accepted with explicit rationale.
- The dashboard now enforces operator auth, same-origin mutation guards,
  server-only feature flags, token-free browser contracts, bounded read paths,
  bounded browser persistence, shared polling controls, and tightened security
  headers.
- The standard non-local deployment remains `board.aiwithapex.com` behind
  Cloudflare Access plus Cloudflare Tunnel to a loopback-only origin.

| Metric | Value |
|--------|-------|
| Total Findings | 35 |
| Verified | 34 |
| Accepted | 1 |
| Open | 0 |
| Fresh Closeout Evidence | `npm test`, `npm run build`, live page and route probes on 2026-03-31 |

## Security Goals

1. Keep read-only monitoring available to operators.
2. Remove browser-visible secrets and token propagation.
3. Disable all state-changing, message-sending, and provider-probing behavior
   by default.
4. Require explicit root `.env` and `.env.example` toggles for any sensitive
   feature.
5. Implement fixable findings that do not remove core functionality.
6. Use `board.aiwithapex.com` behind Cloudflare Access plus Cloudflare Tunnel
   as the standard non-local access path.
7. Reuse the same owner-only Cloudflare Access pattern as the existing
   OpenClaw UI.
8. Keep Cloudflare Access sessions for the dashboard capped at 24 hours, with
   approved-email One-Time PIN as the primary login method for
   `moshehwebservices@live.com`.
9. Require a second app-side protection layer for sensitive routes after the
   Cloudflare boundary by using an operator code challenge and HTTP-only signed
   cookie.
10. Keep the operator code secret and cookie-signing secret in root `.env`,
    with matching placeholders in root `.env.example`.
11. Keep this plan, the PRD, and the findings register current as code changes
    land.

## Secure Default Policy

- Any route that writes state, sends messages, or triggers provider calls is
  sensitive.
- Sensitive routes must be disabled by default.
- Sensitive routes must be controlled by root env flags documented in
  `.env.example`.
- Sensitive routes must not expose `GET` aliases.
- Sensitive routes must enforce auth, origin checks, validation, and rate
  limiting before execution.
- Read-only routes must not leak secrets, absolute paths, or unnecessary
  operator metadata.
- The standard non-local deployment is `board.aiwithapex.com` routed through
  Cloudflare Access and Cloudflare Tunnel to a loopback-only origin.
- Cloudflare Access should reuse the same owner-only pattern already used for
  the OpenClaw UI.
- Approved-email One-Time PIN is the primary Cloudflare Access login method for
  the dashboard.
- The allowed login email is `moshehwebservices@live.com`.
- Direct public origin exposure is unsupported.
- Sensitive routes should keep an app-side protection layer in addition to the
  Cloudflare boundary.
- The app-side layer is an operator code challenge that mints an HTTP-only
  signed cookie for elevated actions.
- The operator code secret and cookie-signing secret must be stored only in
  root `.env`.

## Closeout Status

### Verified Delivery Coverage

- Phase 00 established the auth, token-containment, same-origin launch, secure
  defaults, and loopback deployment baseline.
- Phase 01 validated request-boundary enforcement, same-origin mutation guards,
  rate limits, deterministic diagnostics, and the first security-header pass.
- Phase 02 validated payload safety, shared runtime bridge hardening, bounded
  async read paths, and sanitized read-route contracts.
- Phase 03 validated atomic alert persistence, cache isolation, runtime path
  boundary enforcement, bounded browser persistence, shared client polling,
  destructive-action confirmation, telemetry trimming, and the final evidence
  pass.

### Accepted Residual Risk

- SYN-29 remains accepted for the current closeout because the remaining
  `quoteShellArg` path is limited to the `win32` `cmd.exe` fallback in
  `lib/openclaw-cli.ts`, while the documented supported deployment model is
  localhost or Linux server hosting behind Cloudflare Access plus Tunnel.

## Documentation Policy

- Update `.spec_system/PRD/PRD.md` whenever remediation scope, session
  ownership, env toggles, or security architecture changes.
- Update `docs/SECURITY_FINDINGS.md` whenever a finding changes status.
- Keep deployment guidance aligned with the current secure defaults.
- Link validation evidence to the finding register whenever a fix is marked
  Verified.
- Keep `docs/ongoing-projects/security-items-outside-prd-scope.md` limited to
  work explicitly excluded from the PRD.
- Document the dashboard hostname, allowed email, Cloudflare Access session
  duration, and approved-email One-Time PIN behavior whenever those settings
  change.

## Required Living Artifacts

- `docs/SECURITY_MASTER.md`: policy, priorities, and secure-default rules
- `docs/SECURITY_FINDINGS.md`: deduplicated finding register and status tracker
- `.spec_system/SECURITY-COMPLIANCE.md`: cumulative posture tracking
- `.spec_system/PRD/PRD.md`: canonical in-scope remediation scope and backlog
  mapping
- `docs/ongoing-projects/security-items-outside-prd-scope.md`: detailed notes
  for excluded work only

## Update Triggers

Update this document when:

- a new sensitive route or feature flag is added
- a finding is fixed, deferred, accepted, or re-opened
- deployment defaults change
- the auth boundary changes
- validation evidence changes the practical risk of an existing finding
- work moves into or out of the PRD scope

## Working Rules

- Protect secrets before preserving convenience behavior.
- Preserve read-only operator workflows when disabling sensitive features.
- Centralize feature-flag, auth, validation, and path-boundary logic.
- Do not mark a finding Verified until validation evidence exists.
