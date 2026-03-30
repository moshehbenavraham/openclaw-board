# OpenClaw Dashboard - Product Requirements Document

## Overview

OpenClaw Dashboard is an operator dashboard for inspecting OpenClaw agents, models, sessions, alerts, skills, statistics, and pixel-office state from the local runtime and gateway environment. It is intended for operators who need one place to observe health, review activity, and perform controlled maintenance actions across an OpenClaw deployment.

The current product already delivers that operator value, but the March 29-30, 2026 security audit found that convenience features also expose gateway secrets, unauthenticated writes, outbound messaging abuse, filesystem trust issues, and denial-of-service risk. This PRD defines the requirements for preserving the dashboard's operator value while moving all sensitive or side-effect behavior behind explicit, safe-by-default controls. The current deployment direction is `board.aiwithapex.com` behind Cloudflare Access plus Cloudflare Tunnel for non-local access.

## Goals

1. Preserve the dashboard's read-only monitoring value for OpenClaw operators.
2. Remove browser-visible secret leakage and unauthorized access to runtime configuration, filesystem data, and operational metadata.
3. Ensure every feature that can send messages, trigger provider calls, or change persisted state is disabled by default and only enabled through documented root `.env` and `.env.example` toggles.
4. Implement audit findings that can be fixed without removing core operator functionality, and document any accepted or deferred exceptions.
5. Maintain a living security program in `docs/SECURITY_MASTER.md` and `docs/SECURITY_FINDINGS.md` that stays aligned with code and deployment guidance.

## Non-Goals

- Replacing the OpenClaw gateway or redesigning its underlying authentication model.
- Turning the dashboard into a multi-tenant or public SaaS product.
- Adding a database or moving runtime state out of the local OpenClaw filesystem.
- Building a full app-native user account and session product surface for Phase 00 when authenticated reverse-proxy deployment and minimal server-side guards meet the operator use case.
- Expanding operator features that are unrelated to the audited security posture.
- Preserving unsafe convenience behavior when it conflicts with secret protection or safe defaults.

## Users and Use Cases

### Primary Users

- **OpenClaw operator**: Maintains a local or self-hosted OpenClaw deployment and needs visibility into agents, sessions, models, alerts, and health.
- **Security maintainer**: Reviews findings, tracks remediation status, and verifies that safe defaults remain enforced over time.

### Key Use Cases

1. Operator can inspect agents, sessions, stats, skills, alerts, and gateway health without exposing gateway tokens or platform credentials to the browser.
2. Operator can reach the dashboard remotely at `board.aiwithapex.com` through Cloudflare Access while the origin stays private behind Cloudflare Tunnel.
3. Operator can explicitly enable, use, and disable mutating or message-sending features through root environment toggles when maintenance tasks require them.
4. Security maintainer can review a deduplicated findings register and remediation plan in `docs/` and keep those records aligned with the codebase.
5. Operator can continue using the dashboard when all state-changing and outbound-test features are disabled.

## Requirements

### MVP Requirements

- Operator can view dashboard read-only data without receiving `gateway.token`, tokenized gateway URLs, absolute filesystem paths, or raw platform identifiers in browser-visible responses.
- Operator can enable mutating or side-effect features only through explicit root `.env` and `.env.example` flags that default to disabled.
- Operator can rely on server-only env flags for sensitive behavior; these controls must never use `NEXT_PUBLIC_` variables or any other browser-visible env path.
- Operator can access non-local deployments through the dedicated Cloudflare Access-protected subdomain `board.aiwithapex.com`, which reaches a loopback-only origin over Cloudflare Tunnel.
- Operator can use the same Cloudflare Access pattern as the existing OpenClaw UI for this dashboard.
- Operator can use approved-email One-Time PIN as the primary Cloudflare Access login method for the dashboard.
- Operator can rely on a Cloudflare Access application or policy session duration capped at 24 hours for the dashboard.
- Operator access through Cloudflare Access can be restricted to `moshehwebservices@live.com`.
- Server can enforce a second protection layer for sensitive routes after Cloudflare Access by requiring an operator code challenge that issues an HTTP-only signed cookie for elevated actions.
- Server can keep the operator code secret and cookie-signing secret in root `.env`, with documented placeholders in root `.env.example`.
- Server can scope the elevated operator session for sensitive routes to 12 hours or less.
- Operator can use dry-run diagnostics as the default maintenance path for outbound test actions, while live-send diagnostics remain explicit opt-in behavior behind env flags.
- Operator can keep model changes, alert writes, pixel-office layout writes, provider probes, outbound messaging tests, and any future state-changing or message-sending route disabled by default in every environment.
- Operator can keep all state-changing and outbound-test features disabled by default in local development as well as production-like deployments.
- Server can reject any state-changing or side-effect route request when its corresponding env flag is disabled.
- Server can reject side-effect requests sent via `GET` and only accept the intended non-GET methods.
- Server can validate route params and request bodies before filesystem access, gateway access, or persistent writes.
- Server can constrain agent and cron-store path resolution to approved OpenClaw directories.
- Server can sanitize client-facing error responses and avoid exposing internal paths, secrets, or raw provider errors.
- Server can add security response headers and remove browser-visible token propagation from DOM links, request bodies, and cached client state.
- Server can cache or rate-limit heavy and abuse-prone endpoints so that read-only monitoring remains usable under normal operator load.
- Maintainer can keep a living master security plan in `docs/SECURITY_MASTER.md`.
- Maintainer can keep a living deduplicated findings register in `docs/SECURITY_FINDINGS.md`.
- Maintainer can mark each audit finding as open, in progress, fixed, or verified without losing the link back to the source audit chunks.
- Maintainer can implement fixable audit findings when the fix does not remove documented operator functionality.
- Maintainer can document any finding that is deferred, accepted, or partially mitigated with rationale and validation notes.

### Deferred Requirements

- Operator can rotate or scope gateway credentials independently of the dashboard.
- Operator can rely on session archival and data-retention controls for very large local stores.

## Non-Functional Requirements

- **Performance**: Read-only operator pages remain functional with mutating features disabled, cached analytics endpoints serve repeat requests within 500 ms, and no production route performs unbounded filesystem scans without cache or rate limiting.
- **Security**: All routes that change state, send messages, or exercise external or provider credentials are disabled by default in all environments, require explicit server-only env enablement in root `.env` and `.env.example`, reject `GET`, and return 401/403 or 405 when not allowed. No browser-visible response, DOM node, or client request payload may contain `gateway.token`.
- **Reliability**: With all sensitive feature flags disabled, the current read-only dashboard routes continue returning successful operator responses and do not require outbound messaging or config mutation to function.
- **Accessibility**: Primary operator actions keep visible text labels and keyboard-triggerable controls after hardening, and any newly added security controls expose clear operator-facing failure states.

## Constraints and Dependencies

- The dashboard is a Next.js App Router application with React, TypeScript, and Tailwind CSS already in place.
- Runtime state is sourced from the local OpenClaw filesystem and gateway bridge rather than a database.
- Sensitive behavior must be controlled from root `.env` and `.env.example`, not hidden inside code-only defaults.
- Sensitive behavior must be driven by server-only env variables rather than `NEXT_PUBLIC_` variables or any other browser-visible configuration path.
- The March 29-30, 2026 audit in `docs/ongoing-projects/` is the authoritative starting source for the current security backlog.
- Fixes must preserve the documented read-only monitoring value of the existing product.
- Docker remains an in-scope deployment path and must receive secure default guidance.
- Security documentation must explicitly cover localhost-only development and the primary non-local deployment mode of `board.aiwithapex.com` behind Cloudflare Access and Cloudflare Tunnel to a loopback-bound origin.
- Cloudflare Access is the preferred operator auth boundary for non-local access.
- Cloudflare Access session duration for the dashboard should be capped at 24 hours.
- Approved-email One-Time PIN access is the primary Cloudflare Access login method for the dashboard.
- Cloudflare Access for the dashboard should allow `moshehwebservices@live.com`.
- A second protection layer after Cloudflare Access is required for sensitive routes, and the chosen mechanism is an app-side operator code with an HTTP-only signed cookie for elevated actions.
- The operator code secret and cookie-signing secret must live in root `.env`, with corresponding keys documented in root `.env.example`.
- The elevated operator session for sensitive routes should last no more than 12 hours.
- Direct internet exposure without authenticated reverse-proxy protection is unsupported.
- Secondary authenticated reverse-proxy recipes may be documented later, but Cloudflare Access plus Tunnel is the current standard deployment plan.
- A full app-native session product is out of scope unless future product requirements add true multi-user access.

## Phases

This system delivers the product via phases. Each phase is implemented via multiple 2-4 hour sessions (12-25 tasks each).

| Phase | Name | Sessions | Status |
|-------|------|----------|--------|
| 00 | Foundation | TBD | Not Started |

## Phase 00: Foundation

### Objectives

1. Establish secure defaults and root env toggles for all mutating, provider-probing, and message-sending behavior.
2. Remove secret leakage and resolve fixable high-risk audit findings without breaking read-only monitoring flows.
3. Create living security planning and findings documents in `docs/` and keep them aligned with implementation progress.

### Sessions (To Be Defined)

Sessions are defined via phasebuild as `session_NN_name.md` stubs under `.spec_system/PRD/phase_00/`.

**Note**: This command does NOT create phase directories or session stubs. Run phasebuild after creating the PRD.

## Technical Stack

- Next.js 16 App Router - current UI shell and API routing model
- React 19 - client-side operator interactions
- TypeScript 5 - typed route, utility, and component changes
- Tailwind CSS 4 - current styling system
- Local OpenClaw filesystem and gateway APIs - runtime source of truth
- Docker - packaged deployment path and exposure surface

## Success Criteria

- [ ] `gateway.token` is absent from browser-visible API payloads, DOM links, and client request bodies.
- [ ] All state-changing and message-sending routes are disabled by default and documented in root `.env.example`.
- [ ] Sensitive feature flags are server-only and do not rely on `NEXT_PUBLIC_` variables.
- [ ] GET requests to side-effect routes return `405 Method Not Allowed`.
- [ ] Non-local access is documented and supported through `board.aiwithapex.com` behind Cloudflare Access and Cloudflare Tunnel to a loopback-only origin.
- [ ] Cloudflare Access session duration for the dashboard is set to 24 hours or less.
- [ ] Cloudflare Access allows `moshehwebservices@live.com` for the dashboard.
- [ ] Approved-email One-Time PIN is the primary Cloudflare Access login method for the dashboard.
- [ ] Sensitive routes require the app-side operator code layer in addition to Cloudflare Access.
- [ ] The operator code secret and cookie-signing secret live in root `.env` and are documented in root `.env.example`.
- [ ] The elevated operator session for sensitive routes lasts 12 hours or less.
- [ ] Dry-run diagnostics exist for outbound test workflows before any live-send path is enabled by default.
- [ ] Read-only dashboard pages continue working when all sensitive feature flags are off.
- [ ] Security documentation covers localhost-only and Cloudflare Access plus Tunnel deployment, and marks direct unauthenticated internet exposure unsupported.
- [ ] `docs/SECURITY_MASTER.md` and `docs/SECURITY_FINDINGS.md` exist and are linked to the audit backlog.
- [ ] Fixable audit findings are either implemented or explicitly tracked as deferred or accepted with rationale.

## Risks

- Security fixes may remove convenience behavior that operators currently use informally.
- Root env toggle design may become inconsistent if not centralized and documented rigorously.
- Some mitigations depend on choosing an authentication boundary that matches real deployment patterns.
- Read-only and side-effect behavior may stay coupled unless server and client responsibilities are separated carefully.
- Heavy local data sets may still require follow-up work after the first hardening pass.

## Assumptions

- The dashboard remains an operator-facing tool for trusted environments rather than a public multi-user product.
- Read-only monitoring flows are core functionality and must remain available even when all sensitive toggles are disabled.
- The audit chunk documents in `docs/ongoing-projects/` are accurate enough to seed the initial remediation backlog.
- Root `.env` and `.env.example` toggles are an acceptable control point for sensitive features in this codebase.
- Non-local deployments can rely on Cloudflare Access plus Cloudflare Tunnel as the primary operator-access boundary.
- `board.aiwithapex.com` will reuse the same owner-only Access pattern already used by the OpenClaw UI.

## Remaining Open Questions

- None at the PRD level. Remaining choices are implementation details such as exact cookie naming, the precise elevated-session TTL, and whether Cloudflare Access JWT validation is enforced in the same pass as the operator code layer.
