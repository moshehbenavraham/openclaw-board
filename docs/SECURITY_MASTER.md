# OpenClaw Dashboard Security Master Plan

## Purpose

This document is the living security plan for OpenClaw Dashboard. It turns the March 29-30, 2026 audit in `docs/ongoing-projects/` into an implementation policy, remediation sequence, and documentation standard for the repo.

Use this file as the top-level security source of truth. Use `docs/SECURITY_FINDINGS.md` as the living register for individual findings and statuses.

## Current Security Posture

- The audit found 35 unique findings after deduplication.
- The highest-risk themes are missing authentication, gateway token leakage, unprotected side effects, filesystem trust, and denial-of-service exposure.
- The dashboard's read-only operator value is worth preserving, but sensitive and mutating behavior must move behind safe defaults.

## Security Goals

1. Keep read-only monitoring available to operators.
2. Remove browser-visible secrets and token propagation.
3. Disable all state-changing, message-sending, and provider-probing behavior by default.
4. Require explicit root `.env` and `.env.example` toggles for any sensitive feature.
5. Implement fixable findings that do not remove core functionality.
6. Use `board.aiwithapex.com` behind Cloudflare Access plus Cloudflare Tunnel as the standard non-local access path.
7. Reuse the same owner-only Cloudflare Access pattern as the existing OpenClaw UI.
8. Keep Cloudflare Access sessions for the dashboard capped at 24 hours, with approved-email One-Time PIN as the primary login method for `moshehwebservices@live.com`.
9. Require a second app-side protection layer for sensitive routes after the Cloudflare boundary by using an operator code challenge and HTTP-only signed cookie.
10. Keep the operator code secret and cookie-signing secret in root `.env`, with matching placeholders in root `.env.example`.
11. Keep this plan and the findings register current as code changes land.

## Secure Default Policy

- Any route that writes state, sends messages, or triggers provider calls is sensitive.
- Sensitive routes must be disabled by default.
- Sensitive routes must be controlled by root env flags documented in `.env.example`.
- Sensitive routes must not expose `GET` aliases.
- Sensitive routes must enforce auth, origin checks, validation, and rate limiting before execution.
- Read-only routes must not leak secrets, absolute paths, or unnecessary operator metadata.
- The standard non-local deployment is `board.aiwithapex.com` routed through Cloudflare Access and Cloudflare Tunnel to a loopback-only origin.
- Cloudflare Access should reuse the same owner-only pattern already used for the OpenClaw UI.
- Approved-email One-Time PIN is the primary Cloudflare Access login method for the dashboard.
- The allowed login email is `moshehwebservices@live.com`.
- Direct public origin exposure is unsupported.
- Sensitive routes should keep an app-side protection layer in addition to the Cloudflare boundary.
- The app-side layer is an operator code challenge that mints an HTTP-only signed cookie for elevated actions.
- The operator code secret and cookie-signing secret must be stored only in root `.env`.

## Documentation Policy

- Update this file when remediation scope, env toggles, or security architecture changes.
- Update `docs/SECURITY_FINDINGS.md` whenever a finding changes status.
- Keep deployment guidance aligned with the current secure defaults.
- Link validation evidence to the finding register whenever a fix is marked verified.
- Document the dashboard hostname, allowed email, Cloudflare Access session duration, and approved-email One-Time PIN behavior whenever those settings change.

## Remediation Priorities

### Phase 0

Goal: Prevent immediate gateway compromise and uncontrolled side effects.

- Add route protection for sensitive endpoints.
- Strip gateway token leakage from API responses and browser-visible URLs.
- Remove `GET` aliases from side-effect routes.
- Change insecure network-exposure defaults in deployment guidance.

### Phase 1

Goal: Close remaining Critical and High findings while preserving operator workflows.

- Remove browser-side token propagation.
- Add centralized path validation and origin checks.
- Add security response headers.
- Rate limit or gate abuse-prone routes.
- Remove internal self-SSRF and placeholder side effects.

### Phase 2

Goal: Add input validation, resource bounds, and shared security utilities.

- Validate write payloads and bound payload sizes.
- Deduplicate bridge code and parsing logic.
- Convert sync I/O to async in request paths.
- Cache heavy analytics routes.
- Sanitize response errors and redact operator metadata.

### Phase 3

Goal: Finish hardening, cleanup, and residual-risk reduction.

- Make writes atomic where needed.
- Bound browser-side storage and tab amplification.
- Remove unsafe logging and convenience fallbacks.
- Harden remaining platform and environment edge cases.

## Required Living Artifacts

- `docs/SECURITY_MASTER.md`: policy, priorities, secure-default rules
- `docs/SECURITY_FINDINGS.md`: deduplicated finding register and status tracker
- `.spec_system/SECURITY-COMPLIANCE.md`: spec-system posture tracking
- `.spec_system/PRD/PRD.md`: product requirements that include the security hardening scope

## Update Triggers

Update this document when:

- a new sensitive route or feature flag is added
- a finding is fixed, deferred, accepted, or re-opened
- deployment defaults change
- the auth boundary changes
- validation evidence changes the practical risk of an existing finding

## Working Rules

- Protect secrets before preserving convenience behavior.
- Preserve read-only operator workflows when disabling sensitive features.
- Centralize feature-flag, auth, validation, and path-boundary logic.
- Do not mark a finding fixed until verification evidence exists.
