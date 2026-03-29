# OpenClaw Dashboard Security Audit Plan

Date: 2026-03-29
Repo: `OpenClaw-bot-review`
Scope: Comprehensive application security audit, divided into approximately 120k-context review chunks

## Objective

Perform a comprehensive security audit of the dashboard codebase, focusing on:

- Secret exposure to browser clients
- Missing authentication and authorization
- Unsafe state-changing endpoints
- Abuse of local filesystem and local process bridges
- Network side effects and outbound messaging abuse
- DoS risks from large file parsing and heavy endpoints
- Deployment and runtime exposure assumptions

## Current Risk Posture

Quick triage already identified issues that likely need full findings during audit:

- `/api/config` returns the gateway token in API responses.
- `/api/gateway-health` returns a tokenized gateway URL.
- Client components propagate gateway tokens into browser-visible links.
- Several side-effect endpoints expose `GET` aliases that trigger actions.
- The application appears to have no application-level auth or middleware.
- The deployment container binds the service to `0.0.0.0`.

These observations mean the audit should treat the app as potentially internet-reachable unless deployment proves otherwise.

## Estimated Audit Size

Approximate code size:

- `app/` + `lib/`: about `23.9k` LOC
- `app/api`: about `5.1k` LOC across `25` route files
- Total source footprint in `app/` + `lib/`: about `964k` source characters

Recommended audit strategy:

- Do not fill each 120k window entirely with source code.
- Target roughly `80k-90k` source characters plus `20k-40k` for reasoning, exploit hypotheses, notes, and overlap.
- Plan for `11` chunks total (9 source review + 1 dynamic verification + 1 synthesis).

## Chunking Method and Per-Chunk Deliverables

Each source-review chunk (1-9) should produce:

1. Files reviewed and threat model summary for that surface
2. Trust boundaries and attacker-controlled inputs
3. Concrete exploit hypotheses
4. Confirmed findings with severity estimate
5. Suspected findings needing dynamic validation
6. Open questions, assumptions, and follow-up items for dynamic verification

## Chunk Plan

### Chunk 1: Threat Model and Exposure Assumptions -- COMPLETED 2026-03-29

Purpose:

- Establish intended trust boundary: localhost-only tool or remotely reachable dashboard
- Identify sensitive assets exposed through the UI
- Review deployment defaults and operator guidance

Primary files:

- `README.md`
- `Dockerfile`
- `next.config.mjs`
- `app/layout.tsx`

Key questions:

- Is the app assumed to be private, local-only, or internet-exposed?
- Are dangerous routes acceptable only under localhost assumptions?
- Are deployment docs understating exposure risk?

**Findings:** See `docs/ongoing-projects/security-audit-chunk-1-findings.md`

**Key results:**

- 5 confirmed findings (3 Critical, 1 High, 1 Medium)
- 3 suspected findings requiring validation in later chunks
- 5 open questions documented
- App has zero authentication -- gateway auth token leaked to any network client via `/api/config` and `/api/gateway-health`
- Dockerfile binds to `0.0.0.0` with no security warnings in deployment docs

### Chunk 2: Secret Exposure and Read-Only Data Leakage -- COMPLETED 2026-03-29

Purpose:

- Review routes that expose config, tokens, internal URLs, session metadata, and skill content

Primary files:

- `app/api/config/route.ts`
- `app/api/gateway-health/route.ts`
- `app/api/skills/content/route.ts`
- `app/api/sessions/[agentId]/route.ts`
- `lib/openclaw-skills.ts`
- `lib/openclaw-paths.ts`

Key questions:

- Which secrets reach the browser?
- Which internal runtime files are exposed via API?
- Can route parameters be abused to enumerate or read sensitive local data?

**Findings:** See `docs/ongoing-projects/security-audit-chunk-2-findings.md`

**Key results:**

- 10 confirmed findings (2 Critical, 3 High, 4 Medium, 1 Low -- some cross-ref Chunk 1)
- 3 suspected findings requiring dynamic validation
- Path traversal confirmed via unvalidated `[agentId]` URL segments
- Absolute filesystem paths leaked in skill listings
- Full cron job payloads, platform user IDs, and skill source code exposed without auth

### Chunk 3: Mutating Endpoints and CSRF/Unauthenticated Writes -- COMPLETED 2026-03-29

Purpose:

- Review state-changing routes for missing authz, weak validation, and persistence safety

Primary files:

- `app/api/config/agent-model/route.ts`
- `app/api/alerts/route.ts`
- `app/api/alerts/check/route.ts` (cross-ref with Chunk 7)
- `app/api/pixel-office/layout/route.ts`
- `lib/config-cache.ts`
- `lib/openclaw-cli.ts`
- `lib/openclaw-paths.ts`

Key questions:

- Can any remote caller change runtime behavior?
- Are write operations protected from cross-site triggering?
- Are filesystem writes atomic, constrained, and validated enough?

**Findings:** See `docs/ongoing-projects/security-audit-chunk-3-findings.md`

**Key results:**

- 9 confirmed findings (1 Critical, 3 High, 3 Medium, 2 Low)
- 3 suspected findings requiring dynamic validation
- Any network caller can permanently change agent models via unauthenticated PATCH to gateway `config.patch`
- Alert configuration (enable/disable, recipient, thresholds) writable without auth -- attacker can suppress all monitoring
- No CSRF protection on any mutating endpoint; CORS preflight does not prevent server-side mutation
- Positive: `execFile` used correctly on Linux (no shell injection); model validated against known list
- Exploit chain documented: 3 unauthenticated requests to change model + disable alerting + redirect alerts

### Chunk 4: Side-Effect Test Endpoints and Outbound Messaging Abuse -- COMPLETED 2026-03-29

Purpose:

- Review all routes that can send messages, probe providers, or hit local gateway operations

Primary files:

- `app/api/test-platforms/route.ts`
- `app/api/test-sessions/route.ts`
- `app/api/test-dm-sessions/route.ts`
- `app/api/test-session/route.ts`
- `app/api/test-model/route.ts`
- `app/api/test-bound-models/route.ts`
- `lib/session-test-fallback.ts`
- `lib/model-probe.ts`

Key questions:

- Can an attacker induce external messages or provider requests?
- Are there paths to SSRF, internal network probing, or credential misuse?
- Do any `GET` handlers perform actions that should be `POST`-only?

**Findings:** See `docs/ongoing-projects/security-audit-chunk-4-findings.md`

**Key results:**

- 11 confirmed findings (2 Critical, 3 High, 4 Medium, 2 Low)
- 3 suspected findings requiring dynamic validation
- Any network caller can send real DMs to real users across all platforms without authentication
- 4 of 6 endpoints expose GET aliases, enabling zero-click attack via `<img>` tags or link prefetch
- All configured LLM provider credentials exercised via unauthenticated model probing; API credits consumable without limit
- Repeated platform test calls can lock out the bot via external rate limiting (denial of service through the dashboard itself)
- Attacker-controlled `sessionKey` and `agentId` accepted by `/api/test-session` without validation
- Exploit chains documented: zero-click messaging abuse, credit exhaustion, and full reconnaissance + disable + flood (cross-chunk)

### Chunk 5: Filesystem and Local Runtime Bridge Review

Purpose:

- Review the code that bridges web routes to local OpenClaw files and CLI actions

Primary files:

- `lib/openclaw-cli.ts`
- `lib/openclaw-paths.ts`
- `lib/openclaw-skills.ts`
- `lib/json.ts`
- `lib/gateway-url.ts`

Key questions:

- Are command invocations safe and parameter-constrained?
- Are path selections trusted too broadly?
- Could malicious local data or config shape trigger unsafe behavior?

### Chunk 6: Heavy Parsers, Session Analytics, and DoS Risk

Purpose:

- Review endpoints that read many files, parse JSONL, or scan large local stores

Primary files:

- `app/api/agent-activity/route.ts`
- `app/api/config/route.ts`
- `app/api/stats-all/route.ts`
- `app/api/stats/[agentId]/route.ts`
- `app/api/stats-models/route.ts`
- `app/api/activity-heatmap/route.ts`
- `app/api/pixel-office/idle-rank/route.ts`

Key questions:

- Can remote callers trigger expensive scans repeatedly?
- Are file reads bounded enough for hostile workloads?
- Can malformed JSONL or oversized runtime state crash the process?

### Chunk 7: Alerting and Internal Monitoring Flows

Purpose:

- Review whether health and alert features expand attack surface or chain into higher-risk operations

Primary files:

- `app/api/alerts/check/route.ts`
- `app/alert-monitor.tsx`
- `app/gateway-status.tsx`

Key questions:

- Can monitoring endpoints create notification spam or side effects?
- Do they amplify secret exposure or internal probing?
- Are alerting paths protected from abuse loops?

### Chunk 8: Client-Side Propagation of Sensitive Data

Purpose:

- Review browser-side handling of tokens, links, persisted results, and admin-style actions

Primary files:

- `app/page.tsx`
- `app/components/agent-card.tsx`
- `app/sidebar.tsx`
- `app/sessions/page.tsx`
- `app/models/page.tsx`
- `app/pixel-office/page.tsx`

Key questions:

- Which server-returned secrets become browser-visible?
- Are dangerous actions easy to trigger from a browser session?
- Is any sensitive state stored persistently in `localStorage` or reflected into URLs?

### Chunk 9: Secondary API Surface and Lower-Risk Routes

Purpose:

- Sweep remaining API routes for consistency, validation gaps, and overlooked data exposure

Primary files:

- `app/api/agent-status/route.ts`
- `app/api/skills/route.ts`
- `app/api/pixel-office/contributions/route.ts`
- `app/api/pixel-office/version/route.ts`
- `app/api/pixel-office/tracks/route.ts`
- Remaining small API files not covered in earlier chunks

Key questions:

- Are there smaller routes that still expose metadata or create network side effects?
- Are response shapes consistent with the app's trust model?

### Chunk 10: Dynamic Verification

Purpose:

- Validate exploitability of code-level findings in a controlled environment

Dynamic tasks:

- Start the app in an isolated environment
- Exercise risky endpoints directly
- Confirm secret exposure in browser responses
- Confirm whether `GET` aliases trigger side effects
- Validate whether outbound messaging routes can be abused without auth
- Measure high-cost endpoints for DoS potential

Requirements:

- Scrubbed `.openclaw` test environment
- No production credentials
- Permission to run the app and hit local endpoints

### Chunk 11: Synthesis and Remediation Plan

Purpose:

- Deduplicate findings
- Assign severity and exploitability
- Build remediation sequencing
- Separate code defects from deployment assumptions

Outputs:

- Executive summary
- Findings list with severity, impact, exploit path, and file references
- Fix priority ordering
- Validation checklist after fixes

## Prerequisites for a Full Audit

- A non-production OpenClaw runtime for safe testing
- Clarity on whether deployment is localhost-only or internet-facing
- Permission to run dynamic endpoint checks
- Optional: dependency audit and secret scan during dynamic phase

## Initial Priority Order

If time is limited, start here:

1. Secret exposure and auth surface
2. State-changing endpoints
3. Side-effect test endpoints
4. Filesystem and local runtime bridge
5. Heavy parsers and DoS

## Success Criteria

The audit is complete when:

- All routes and local runtime bridges have been reviewed
- High-risk exploit chains have been validated or ruled out
- Secret exposure paths are documented
- All unauthenticated write and side-effect paths are enumerated
- Remediation work is prioritized by severity and implementation cost
