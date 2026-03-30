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

### Chunk 5: Filesystem and Local Runtime Bridge Review -- COMPLETED 2026-03-30

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

**Findings:** See `docs/ongoing-projects/security-audit-chunk-5-findings.md`

**Key results:**

- 9 confirmed findings (1 High, 5 Medium, 3 Low)
- 3 suspected findings requiring dynamic validation
- Bridge layer provides path constants but no path boundary enforcement -- structural root cause of F2.7 path traversal across 8+ routes
- Windows cmd.exe code path has shell argument injection via insufficient `quoteShellArg` escaping (mitigated by Linux deployment)
- `model-probe.ts` contains duplicate bridge implementations that diverge from canonical `openclaw-cli.ts` -- security fixes to one don't propagate
- `parseJsonFromMixedOutput` returns the first JSON object found in CLI output, susceptible to output injection if attacker-controlled data appears before real response
- Environment variables (`OPENCLAW_HOME`, `OPENCLAW_PACKAGE_DIR`, etc.) can redirect all filesystem operations with no validation
- Positive: `execFile` used correctly on Linux, skill content access gated by enumerated list, JSONL scanning bounded to 5000 chars

### Chunk 6: Heavy Parsers, Session Analytics, and DoS Risk -- COMPLETED 2026-03-30

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

**Findings:** See `docs/ongoing-projects/security-audit-chunk-6-findings.md`

**Key results:**

- 9 confirmed findings (2 High, 3 Medium, 4 Low)
- 3 suspected findings requiring dynamic validation
- `/api/agent-activity` has no cache and performs cascading reads across 100+ files per request (sessions → subagent transcripts → cron transcripts)
- Path traversal confirmed in `/api/stats/[agentId]` via unvalidated URL segment (cross-ref F2.7, F5.1)
- All 7 endpoints perform unbounded filesystem scans without rate limiting; 4 of 7 use synchronous I/O that blocks the event loop
- `resolveCronStorePath` follows arbitrary config-sourced paths -- combined with F3.1 becomes an arbitrary file read primitive
- Exploit chains documented: sustained DoS via uncached endpoints, amplified DoS via session data growth, config tampering → file read via cron store path

### Chunk 7: Alerting and Internal Monitoring Flows -- COMPLETED 2026-03-30

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

**Findings:** See `docs/ongoing-projects/security-audit-chunk-7-findings.md`

**Key results:**

- 9 confirmed findings (3 High, 4 Medium, 2 Low)
- 3 suspected findings requiring dynamic validation
- Self-SSRF: `/api/alerts/check` internally calls `/api/test-model` for every configured model, creating a one-to-many amplification that consumes LLM provider API credits
- Unauthenticated outbound messaging: alert notifications send real Feishu DMs using real `appId`/`appSecret` from config, triggered by any network caller
- Gateway auth token injected into fire-and-forget messages to arbitrary agent sessions via attacker-controlled `receiveAgent`
- `AlertMonitor` embedded in root layout triggers the full alert check pipeline on every page load by any visitor
- `Math.random()`-based cron check sends real notifications with 40% probability per invocation
- Gateway status component renders tokenized URL as clickable `<a>` tag in the DOM
- Exploit chains documented: silent credit exhaustion via AlertMonitor amplification, notification flooding + session injection, full cross-chunk kill chain (6 unauthenticated requests)

### Chunk 8: Client-Side Propagation of Sensitive Data -- COMPLETED 2026-03-30

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

**Findings:** See `docs/ongoing-projects/security-audit-chunk-8-findings.md`

**Key results:**

- 10 confirmed findings (1 Critical, 3 High, 3 Medium, 3 Low)
- 3 suspected findings requiring dynamic validation
- Gateway auth token embedded in `<a href>` attributes across every agent card and session link on every page (DOM-visible, browser-history-persisted, referrer-leakable)
- Gateway token also sent in POST body from browser to `/api/test-session` endpoint, redundantly round-tripping the secret through the client
- Full config (including token) cached in module-scope JavaScript variables that survive SPA navigation
- One-click model change and four test-all buttons perform admin/side-effect actions with no auth, no confirmation dialog
- Five `localStorage` keys accumulate test results indefinitely with no expiry, size bounds, or cleanup
- Platform identifiers (Feishu accountId, botOpenId, botUserId), session key naming conventions, and OpenClaw version rendered in DOM for reconnaissance
- Exploit chains documented: DOM token extraction, browser history token persistence, full admin takeover via 5 clicks + 1 API call, cross-page data leakage via localStorage

### Chunk 9: Secondary API Surface and Lower-Risk Routes -- COMPLETED 2026-03-30

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

**Findings:** See `docs/ongoing-projects/security-audit-chunk-9-findings.md`

**Key results:**

- 9 confirmed findings (0 Critical, 0 High, 4 Medium, 5 Low)
- 3 suspected findings requiring dynamic validation
- Agent status endpoint discloses all agent IDs, activity states, and timestamps enabling attack timing optimization
- `execSync` shell invocation in contributions endpoint (only `execSync` usage in the codebase; rest uses `execFile`)
- GitHub API rate limit exhaustible via `?force=1` cache bypass on version endpoint with no rate limiting
- Skill listing re-exposes absolute filesystem paths (cross-ref F2.4, F5.3) -- `/api/skills` is the direct entry point
- GitHub username and contribution patterns disclosed, revealing operator identity
- All 25 API route files now covered across Chunks 2-9; audit proceeds to dynamic verification

### Chunk 10: Dynamic Verification -- COMPLETED 2026-03-30

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

**Findings:** See `docs/ongoing-projects/security-audit-chunk-10-findings.md`

**Key results:**

- 11 dynamically confirmed findings (2 Critical, 5 High, 3 Medium, 1 Low)
- 12 code-confirmed findings (not dynamically tested to avoid side effects)
- 1 new finding discovered: zero security response headers (no Referrer-Policy, X-Frame-Options, CSP, HSTS)
- 4 suspected findings downgraded: file descriptor exhaustion (ulimit=1M), memory exhaustion (heap=4.3GB), symlink traversal (none found), shell startup interference (clean)
- All 27 suspected findings from Chunks 1-9 resolved
- 3 exploit chains validated: full recon→disable→flood, CSRF silent config manipulation, zero-click messaging via `<img>` tags
- Gateway token confirmed exposed in plaintext via 2 unauthenticated endpoints
- CSRF mutation confirmed: cross-origin POST from `http://evil.com` successfully wrote to filesystem
- Path traversal confirmed: `[agentId]` segment traverses out of `.openclaw/agents/` to filesystem root

### Chunk 11: Synthesis and Remediation Plan -- COMPLETED 2026-03-30

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

**Findings:** See `docs/ongoing-projects/security-audit-chunk-11-findings.md`

**Key results:**

- 97 raw findings across Chunks 1-10 deduplicated to 35 unique findings (5 Critical, 8 High, 12 Medium, 10 Low)
- 27 of 27 suspected findings resolved (4 downgraded, 12 code-confirmed, 11 dynamically confirmed)
- 3 validated exploit chains: full recon→disable→flood, CSRF silent mutation, zero-click messaging via `<img>` tags
- Root cause: zero authentication middleware — adding auth (R-01) alone mitigates 30+ findings
- 39 remediation items organized into 4 phases: Emergency (5 fixes, 1-2 days), Urgent (7 fixes, 3-5 days), Short-Term (13 fixes, 5-8 days), Hardening (14 fixes, 3-5 days)
- Post-fix validation checklist with 25 concrete test assertions across all 4 phases
- Gateway auth token confirmed leaking through 6 independent paths — all addressed in Phase 0 and Phase 1 fixes

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
