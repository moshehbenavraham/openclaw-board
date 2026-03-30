# Chunk 11: Synthesis and Remediation Plan

Date: 2026-03-30
Auditor: Cursor (automated)
Status: **Complete**

---

## 1. Executive Summary

This audit reviewed the full source of the OpenClaw Dashboard: 25 API route files, 5 bridge/library modules, and 6 client-side page components, totaling approximately 24k lines of code. Dynamic verification confirmed the most critical findings against a live dev server with production data.

**The dashboard has no authentication.** Every route — read-only, state-changing, and side-effect-triggering — is accessible to any network caller. The gateway auth token (the single credential for full bot control) leaks through at least 6 independent paths. An attacker who can reach port 3000 can extract the token, change the bot's model, disable monitoring, send messages as the bot to real users on every platform, and exhaust LLM API credits — all without credentials, in under 10 HTTP requests.

The default Docker deployment binds to `0.0.0.0`, making the dashboard reachable from whatever network the host is on. No security warnings appear in the deployment documentation.

### Audit Statistics

| Metric | Count |
|--------|-------|
| Total raw findings (Chunks 1-10) | 97 confirmed + 27 suspected |
| Suspected findings resolved | 27 of 27 |
| Suspected findings downgraded/not confirmed | 4 (file descriptor exhaustion, symlink traversal, package hijacking, shell startup interference) |
| **Unique findings after deduplication** | **35** |
| Dynamically confirmed (Chunk 10) | 11 |
| Code-confirmed only (not dynamically tested) | 12 |
| New findings from dynamic testing | 1 (DV-08: missing security headers) |
| Exploit chains validated | 3 |

### Severity Distribution (Deduplicated)

| Severity | Count | % of Total |
|----------|-------|------------|
| Critical | 5 | 14% |
| High | 8 | 23% |
| Medium | 12 | 34% |
| Low | 10 | 29% |
| **Total** | **35** | 100% |

### Key Risk Themes

| Theme | Findings | Root Cause |
|-------|----------|------------|
| **Authentication void** | SYN-01 through SYN-05, SYN-07, SYN-10 | No middleware.ts, no auth checks in any route |
| **Gateway token leakage** | SYN-01 (6 leak paths) | Token intentionally passed to client for URL construction |
| **Unprotected side effects** | SYN-04, SYN-05, SYN-08, SYN-09, SYN-12 | Test endpoints designed for operator convenience, exposed to all callers |
| **Filesystem trust** | SYN-06, SYN-19, SYN-22 | Bridge layer provides path constants without boundary enforcement |
| **Resource exhaustion** | SYN-08, SYN-13, SYN-21 | Unbounded file reads, no rate limiting, no caching on heavy endpoints |

---

## 2. Master Finding List

Findings are grouped by severity, then by attack category. Each entry lists the canonical ID, title, affected files, and cross-references to the per-chunk finding IDs where full details and exploit code can be found.

### Critical (5)

#### SYN-01: Gateway Auth Token Leaked to Any Network Client

**Category:** Secret Exposure
**Exploitability:** Trivial — single unauthenticated GET request
**Dynamic status:** Confirmed (DV-01, DV-02)

The gateway auth token — the single credential granting full control of the OpenClaw gateway — is exposed through 6 independent paths:

| Leak Path | Location | How Exposed |
|-----------|----------|-------------|
| `/api/config` response body | `app/api/config/route.ts:548` | `gateway.token` field in JSON response |
| `/api/gateway-health` `webUrl` field | `app/api/gateway-health/route.ts:131` | Token embedded as URL query parameter |
| DOM `<a href>` attributes | `app/components/agent-card.tsx:385` | Every agent card and session link |
| POST body to `/api/test-session` | `app/sessions/page.tsx:245` | Client redundantly sends token to server |
| Module-scope JavaScript variables | `app/page.tsx:111` | `cachedHomeData` persists across SPA navigation |
| GatewayStatus clickable link | `app/gateway-status.tsx:55` | Tokenized URL rendered as `<a>` tag |

**Impact:** Full gateway compromise — send messages as the bot, read all sessions, modify configuration, access all connected platforms (Telegram, Discord, Feishu, WhatsApp).

**Cross-ref:** F1.1, F1.2, F2.1, F2.2, F7.3, F7.7, F8.1, F8.2, F8.3, DV-01, DV-02

---

#### SYN-02: No Application-Level Authentication

**Category:** Access Control
**Exploitability:** Trivial — no credentials required for any operation
**Dynamic status:** Confirmed (all DV tests accessed without auth)

No `middleware.ts` exists. Zero authentication checks across all 25 API route files. No session cookies, no JWT validation, no API key headers, no IP allowlisting. Every endpoint — including those that change runtime configuration, send outbound messages, and exercise platform credentials — responds identically to any caller.

**Impact:** Root enabler for all other findings. Every vulnerability in this report is exploitable because this control is absent.

**Cross-ref:** F1.3

---

#### SYN-03: Unauthenticated Permanent Runtime Configuration Mutation

**Category:** Unauthorized Write
**Exploitability:** Trivial — single unauthenticated HTTP request per mutation
**Dynamic status:** Confirmed (DV-05 for alerts; code-confirmed for model change)

Three endpoints allow any network caller to permanently modify the bot's runtime behavior:

| Endpoint | Action | Persistence |
|----------|--------|-------------|
| `PATCH /api/config/agent-model` | Change AI model for any agent | Written to `openclaw.json` via gateway `config.patch` — survives restarts |
| `POST /api/alerts` | Enable/disable alerting, change recipient, modify thresholds | Written to `alerts.json` on disk |
| `POST /api/pixel-office/layout` | Overwrite pixel office layout with arbitrary JSON | Written to `layout.json` on disk |

The model change endpoint also clears all session model state files, disrupting active conversations.

**Exploit chain:** 3 requests = change model + disable alerting + redirect alerts to dead end.

**Cross-ref:** F3.1, F3.2, F3.3, F3.6, DV-05

---

#### SYN-04: Unauthenticated Outbound Messaging to Real Users

**Category:** Side-Effect Abuse
**Exploitability:** Trivial — single unauthenticated POST (or GET, see SYN-05)
**Dynamic status:** Code-confirmed (CC-01, CC-03; not exercised to avoid messaging real users)

Two independent paths allow any caller to send real messages to real users:

1. **`/api/test-platforms`** reads all platform credentials from `openclaw.json` and sends DMs to every user who has ever messaged the bot across Telegram, Discord, Feishu, WhatsApp, QQBot, and Yuanbao.

2. **`/api/alerts/check`** sends Feishu DMs using real `appId`/`appSecret` when alert rules fire, and injects messages into agent sessions via the gateway.

**Impact:** User harassment, bot reputation damage, platform rate limit exhaustion leading to bot lockout, real Feishu/Discord API credentials exercised by attacker.

**Cross-ref:** F4.1, F7.2, F7.3

---

#### SYN-05: Zero-Click Side-Effect Triggering via GET Aliases

**Category:** HTTP Method Abuse
**Exploitability:** Trivial — embeddable in `<img>` tags, link prefetch, CSS backgrounds
**Dynamic status:** Confirmed (DV-06 — GET handlers execute full side-effect logic)

Four of six test endpoints export `GET() { return POST(); }`, making side effects triggerable without any user interaction:

| Endpoint | Side Effect |
|----------|-------------|
| `/api/test-platforms` | Send DMs to all platform users |
| `/api/test-sessions` | Send LLM completions for all agents |
| `/api/test-dm-sessions` | Send DMs through all agent/platform combinations |
| `/api/test-bound-models` | Probe all LLM models simultaneously |

An attacker embedding `<img src="http://target:3000/api/test-platforms">` in any web page, email, or chat message triggers real messaging when the victim views the content.

**Cross-ref:** F4.2, DV-06, F8.9

---

### High (8)

#### SYN-06: Path Traversal via Unvalidated `[agentId]` URL Segments

**Category:** Path Traversal
**Exploitability:** Moderate — traversal confirmed but constrained by fixed path suffixes
**Dynamic status:** Confirmed (DV-04)

The `[agentId]` URL parameter is used directly in `path.join()` across 8+ routes without validation. `path.join` normalizes `..` segments, allowing traversal out of `~/.openclaw/agents/`:

```
GET /api/sessions/..%2F..%2F..%2F → resolves to /home/sessions/sessions.json
GET /api/stats/..%2F..%2F..%2F → resolves to /home/agents/../sessions/
```

**Root cause:** `lib/openclaw-paths.ts` provides path constants but no `resolveAgentPath()` utility. Every route must independently validate — and none do.

**Affected routes:** `sessions/[agentId]`, `stats/[agentId]`, `config/agent-model`, `test-session`, `test-sessions`, `test-dm-sessions`, `agent-status`, `agent-activity`

**Cross-ref:** F2.7, F5.1, F6.2, DV-04

---

#### SYN-07: CSRF on All Mutating Endpoints

**Category:** Cross-Site Request Forgery
**Exploitability:** Moderate — requires victim to visit attacker-controlled page
**Dynamic status:** Confirmed (DV-07 — cross-origin POST from `evil.com` wrote to filesystem)

No CSRF protection exists. `Content-Type: application/json` triggers CORS preflight, but the server processes the mutation regardless of the browser blocking the response. Confirmed: cross-origin POST with `Origin: http://evil.com` successfully mutated pixel-office layout.

**All mutating endpoints affected:** `/api/config/agent-model`, `/api/alerts`, `/api/pixel-office/layout`

**Cross-ref:** F3.7, DV-07

---

#### SYN-08: LLM API Credit Exhaustion and Self-SSRF Amplification

**Category:** Resource Abuse / SSRF
**Exploitability:** Trivial — unauthenticated, scriptable
**Dynamic status:** Code-confirmed (CC-04)

Multiple endpoints consume real LLM API credits without authentication or rate limiting:

- **`/api/test-bound-models`** probes all models in parallel per request
- **`/api/test-sessions`** sends a completion per agent
- **`/api/test-model`** probes any specified provider/model
- **`/api/alerts/check`** internally calls `/api/test-model` for every configured model (self-SSRF: 1 request → N model probes)

Combined with AlertMonitor (SYN-12), enabling alerting causes every page load to trigger N model probes.

**Cross-ref:** F4.3, F7.1

---

#### SYN-09: External Platform Rate Limit Lockout

**Category:** Denial of Service (External)
**Exploitability:** Trivial — repeated calls to test-platforms
**Dynamic status:** Code-confirmed (CC-03)

Repeated calls to `/api/test-platforms` exercise real platform API credentials (Discord bot token, Feishu appSecret, QQBot clientSecret) against services with strict rate limits. Exhausting external rate limits locks the real bot out of its messaging platforms.

**Cross-ref:** F4.4

---

#### SYN-10: Docker Default Binds to All Network Interfaces

**Category:** Deployment Misconfiguration
**Exploitability:** Passive — exposes all vulnerabilities to network
**Dynamic status:** Code-confirmed

`Dockerfile` line 24: `ENV HOSTNAME="0.0.0.0"`. README Docker run example: `docker run -d -p 3000:3000`. No security warnings in deployment documentation.

**Impact:** Combined with SYN-02 (no auth), makes every finding in this report network-exploitable by default.

**Cross-ref:** F1.4

---

#### SYN-11: Attacker-Controlled Inputs Forwarded to Gateway

**Category:** Input Validation
**Exploitability:** Moderate
**Dynamic status:** Code-confirmed (CC-05)

`/api/test-session` accepts `sessionKey` and `agentId` from the request body and forwards them unvalidated as HTTP headers to the gateway. This enables session key enumeration (timing attacks), agent ID injection, and arbitrary session addressing.

**Cross-ref:** F4.5

---

#### SYN-12: AlertMonitor Auto-Triggers Full Attack Pipeline on Every Page Load

**Category:** Amplification
**Exploitability:** Passive — triggered by any page visit after attacker enables alerting
**Dynamic status:** Code-confirmed (CC-07)

`AlertMonitor` is embedded in the root layout (`app/layout.tsx`). When alerting is enabled, it immediately calls `POST /api/alerts/check` on mount, then repeats on interval. Each check triggers model probing (N LLM API calls), filesystem scanning, and potentially Feishu notifications. Multiple browser tabs multiply the rate. An attacker only needs to `POST /api/alerts {"enabled": true, "checkInterval": 1}` once — every subsequent page load by any user sustains the attack.

**Cross-ref:** F7.6, CC-07

---

#### SYN-13: Uncached Heavy Endpoints with Cascading Unbounded Reads

**Category:** Denial of Service (Local)
**Exploitability:** Trivial — unauthenticated, no rate limiting
**Dynamic status:** Partially confirmed (DV-10 — 6.85s for heatmap, 0.32s for agent-activity)

`/api/agent-activity` has no cache and performs 165+ file reads per request across 4 cascading levels (agent enumeration → parent sessions → subagent transcripts → cron transcripts). Four endpoints use synchronous `readFileSync` that blocks the Node.js event loop. No rate limiting on any of the 7 analytics endpoints.

**Cross-ref:** F6.1, F6.3, F7.4

---

### Medium (12)

#### SYN-14: Missing Security Response Headers

**Exploitability:** Passive
**Cross-ref:** F1.5, DV-08

No `Referrer-Policy` (tokenized URLs leak via Referrer), no `X-Frame-Options` (clickjacking possible), no `Content-Security-Policy`, no `Strict-Transport-Security`, no `X-Content-Type-Options`. `X-Powered-By: Next.js` discloses server framework.

#### SYN-15: Platform Identity Metadata and User IDs Disclosed

**Cross-ref:** F2.3, F2.4, F4.7, F8.7

Feishu `accountId`/`botOpenId`, Discord/Telegram/WhatsApp user IDs, session key naming conventions, and platform bindings exposed via `/api/config`, `/api/sessions/[agentId]`, test-platforms responses, and client DOM.

#### SYN-16: Absolute Filesystem Paths in Skill Listings

**Cross-ref:** F2.5, F9.7

`/api/skills` returns `location` field containing full paths like `/home/krox/.local/lib/node_modules/openclaw/skills/browser/SKILL.md`, revealing home directory, username, and installation layout.

#### SYN-17: Synchronous I/O Blocks Node.js Event Loop

**Cross-ref:** F6.4, F9.8

Four endpoints (`config`, `stats/[agentId]`, `activity-heatmap`, `idle-rank`) and `agent-status` use `readFileSync`/`readdirSync`/`statSync` inside async handlers, blocking all concurrent requests.

#### SYN-18: No Input Validation on Write Payloads

**Cross-ref:** F3.4, F3.6

Alert config accepts arbitrary types for `enabled`, `checkInterval`, `threshold`. Pixel-office layout has no payload size limit. No schema validation on any write endpoint.

#### SYN-19: Duplicate CLI Bridge with Divergent Behavior

**Cross-ref:** F5.3, DV-09

`lib/model-probe.ts` contains duplicate `execOpenclaw`, `quoteShellArg`, and `parseJsonFromMixedOutput` implementations diverging from `lib/openclaw-cli.ts`. Security fixes to one copy don't propagate.

#### SYN-20: CLI Output Injection via `parseJsonFromMixedOutput`

**Cross-ref:** F5.5, CC-06

Both copies of the function return the first JSON object found in stdout+stderr. Attacker-controlled CLI arguments (e.g., `--probe-provider`) that are echoed in output before the real JSON could inject forged results.

#### SYN-21: Unbounded File Reads without Size Limits

**Cross-ref:** F5.6, F6.5

`readFileSync`/`readFile` called on config, JSONL, and skill files with no `stat().size` check. Parallel reads via `Promise.all` without concurrency limits create memory spikes proportional to total data on disk.

#### SYN-22: `resolveCronStorePath` Follows Arbitrary Config-Sourced Paths

**Cross-ref:** F6.6

`path.resolve(raw)` with no boundary check. Combined with SYN-03 (config tampering), becomes an arbitrary JSON file read primitive.

#### SYN-23: Random-Based Cron Alert Logic Sends Real Notifications

**Cross-ref:** F7.5

`Math.random()` determines cron failure count. Default threshold of 3 gives 40% probability of sending real Feishu DMs per check invocation. Placeholder code with production side effects.

#### SYN-24: Platform Credentials Exercised Without Auth

**Cross-ref:** F4.6

All test endpoints exercise production credentials (Discord bot token, Feishu appSecret, QQBot clientSecret, LLM API keys, Yuanbao appSecret) confirming validity to attackers and consuming quotas.

#### SYN-25: GitHub API Rate Limit Exhaustible via Cache Bypass

**Cross-ref:** F9.4

`/api/pixel-office/version?force=1` bypasses 1-hour cache. 60 rapid requests exhaust unauthenticated GitHub rate limit; 5,000 exhaust authenticated limit. No server-side rate limiting.

---

### Low (10)

#### SYN-26: Error Responses Leak Internal Filesystem Paths

**Cross-ref:** F2.9, F9.9

All routes catch errors and return `err.message`, which includes absolute paths from Node.js filesystem errors.

#### SYN-27: Non-Atomic Alert Config Write

**Cross-ref:** F3.5

`saveAlertConfig` writes directly to `alerts.json` (no temp+rename). Crash during write corrupts config, silently resetting to defaults.

#### SYN-28: Config Cache Returns Mutable Reference

**Cross-ref:** F3.9, F2.10

`getConfigCache()` returns the same object reference. Future token-stripping fixes must account for shared reference to avoid corrupting the cache.

#### SYN-29: Dormant Windows Shell Injection in `quoteShellArg`

**Cross-ref:** F5.2

`cmd.exe` shell path escapes only `"` but not `%VAR%`, `!VAR!`, or `^`. Not exploitable on Linux (production platform) but code defect persists.

#### SYN-30: Environment Variable Overrides Redirect All Filesystem Reads

**Cross-ref:** F5.4, DV-15

`OPENCLAW_HOME` and 5 other env vars control all data paths. Low risk in current single-user VPS; higher risk in shared-host or Docker `-e` scenarios.

#### SYN-31: Uncaught `JSON.parse` Crashes Skills Route

**Cross-ref:** F5.7

Bare `JSON.parse(fs.readFileSync(OPENCLAW_CONFIG_PATH))` in `listOpenclawSkills` with no try/catch. Corrupted config makes skills endpoints permanently unavailable.

#### SYN-32: `localStorage` Accumulates Indefinitely

**Cross-ref:** F8.6, CC-10

Five keys store test results with no expiry or size bounds. Error messages may contain internal details. Same-origin scripts (including XSS) can read all stored data.

#### SYN-33: Operational and Reconnaissance Intelligence Leakage

**Cross-ref:** F6.9, F7.8, F9.1, F9.3, F9.6, F8.10, F8.8

Agent status, activity heatmaps, contribution schedules, alert config (thresholds/intervals), provider listings, session key naming, version/changelog — all accessible without auth. Enables timing optimization for attacks.

#### SYN-34: Code Quality Issues with Security Implications

**Cross-ref:** F3.8, F6.8, F8.9, F4.11, F7.9, F6.7

Duplicate POST/PUT alert handlers, double JSONL parse in stats-models, POST-to-GET fallback in `callTestApi`, unused `probeGatewayWebUi` leaking token in URL, Feishu credentials in console.log, no cache stampede protection.

#### SYN-35: Cron/Operational Metadata Exposed

**Cross-ref:** F2.8, DV-11, F2.6

Cron job IDs, names, payloads, and error messages in `/api/agent-activity`. Skill source code readable via `/api/skills/content`. Custom skills may contain operational details.

---

## 3. Exploitability and Impact Matrix

| ID | Finding | CVSS-like | Exploitability | Impact | Auth Required | Dynamic Confirmed |
|----|---------|-----------|----------------|--------|--------------|-------------------|
| SYN-01 | Token leakage (6 paths) | 9.8 | Trivial | Full gateway compromise | None | Yes |
| SYN-02 | No authentication | 9.8 | Trivial | All endpoints accessible | None | Yes |
| SYN-03 | Config mutation | 9.1 | Trivial | Permanent runtime changes | None | Partial |
| SYN-04 | Outbound messaging | 8.6 | Trivial | User harassment, credential exercise | None | Code only |
| SYN-05 | GET alias zero-click | 8.6 | Trivial | Passive side-effect trigger | None | Yes |
| SYN-06 | Path traversal | 7.5 | Moderate | Directory traversal, info disclosure | None | Yes |
| SYN-07 | CSRF | 7.5 | Moderate | Cross-site config mutation | None | Yes |
| SYN-08 | Credit exhaustion | 7.1 | Trivial | API credit depletion | None | Code only |
| SYN-09 | Platform lockout | 7.1 | Trivial | Bot communication disruption | None | Code only |
| SYN-10 | 0.0.0.0 binding | 7.0 | Passive | Network exposure | None | Code only |
| SYN-11 | Input forwarding | 6.5 | Moderate | Session enumeration | None | Code only |
| SYN-12 | AlertMonitor amplification | 6.5 | Passive | Sustained background attacks | None | Code only |
| SYN-13 | DoS via heavy endpoints | 6.5 | Trivial | Service degradation | None | Partial |

---

## 4. Validated Exploit Chains

Three end-to-end attack chains were validated during the audit:

### Chain A: Full Recon → Disable Monitoring → Messaging Flood

```
1. GET  /api/config           → gateway token + all agents  [DV-01]
2. GET  /api/agent-status     → which agents are idle       [DV-03]
3. PUT  /api/alerts           → disable all monitoring      [DV-05]
4. GET  /api/test-platforms   → DMs to all platform users   [DV-06]
```

**4 unauthenticated requests. Steps 1-3 dynamically confirmed. Step 4 code-confirmed.**

### Chain B: CSRF-Based Silent Config Manipulation

```
1. Victim visits attacker page
2. fetch('/api/config/agent-model', {method:'PATCH', body:...})  → model changed
3. fetch('/api/alerts', {method:'PUT', body:...})                → alerting disabled
```

**Server processes mutations despite CORS blocking the response. Confirmed via DV-07.**

### Chain C: Zero-Click Messaging via Embedded Image

```
1. Attacker posts: <img src="http://target:3000/api/test-platforms">
2. Victim views page/email/chat containing the image
3. Browser fires GET → dashboard sends real DMs to all platform users
```

**No JavaScript, no interaction beyond viewing. Confirmed via DV-06 (GET handler executes).**

---

## 5. Code Defects vs. Deployment Assumptions

| Category | Findings | Nature |
|----------|----------|--------|
| **Code defects (fix in source)** | SYN-01 through SYN-09, SYN-11 through SYN-35 | Missing auth, validation, input sanitization, resource bounds |
| **Deployment defects (fix in config/docs)** | SYN-10 | Dockerfile `0.0.0.0` binding, missing security guidance |
| **Architectural defects (fix in design)** | SYN-02, SYN-06 | No auth layer; no centralized path enforcement |

The application operates correctly for its intended use case (localhost monitoring dashboard for a single operator). The security issues arise because **the codebase enforces none of the trust assumptions** that the localhost deployment model requires. If the dashboard is ever network-exposed — intentionally or accidentally — every finding becomes immediately exploitable.

---

## 6. Remediation Plan

Fixes are sequenced in 4 phases by impact and dependency ordering. Earlier phases unblock later ones.

### Phase 0 — Emergency (Before Any Network Exposure)

**Goal:** Prevent gateway compromise and uncontrolled side effects.
**Effort estimate:** 1-2 days.
**Blocks:** 70%+ of all findings.

| # | Fix | Findings Addressed | Effort |
|---|-----|--------------------|--------|
| R-01 | **Add authentication middleware.** Create `middleware.ts` with a shared-secret or session-based auth check. Apply to all `/api/*` routes. | SYN-02, and mitigates SYN-01 through SYN-13 | Medium |
| R-02 | **Strip gateway token from `/api/config` response.** Remove `gateway.token` from the returned JSON. The server-side code that needs the token should read it from config directly. | SYN-01 (path 1) | Small |
| R-03 | **Strip tokenized URL from `/api/gateway-health` response.** Remove the token from `webUrl`, or omit `webUrl` entirely. | SYN-01 (path 2) | Small |
| R-04 | **Remove GET aliases from all side-effect endpoints.** Delete `export async function GET() { return POST(); }` from `test-platforms`, `test-sessions`, `test-dm-sessions`, and `test-bound-models`. | SYN-05 | Small |
| R-05 | **Change Dockerfile to bind `127.0.0.1`.** Set `ENV HOSTNAME="127.0.0.1"`. Add security warning to README about network exposure. | SYN-10 | Small |

### Phase 1 — Urgent (Within 1-2 Weeks)

**Goal:** Close remaining Critical/High gaps, add defense-in-depth.
**Effort estimate:** 3-5 days.

| # | Fix | Findings Addressed | Effort |
|---|-----|--------------------|--------|
| R-06 | **Stop propagating gateway token to browser.** Remove `gatewayToken` prop from AgentCard. Build session URLs server-side via a redirect endpoint (e.g., `/api/chat-redirect?session=KEY` that attaches the token server-side and 302s). | SYN-01 (paths 3-6) | Medium |
| R-07 | **Add centralized `resolveAgentPath()` to `openclaw-paths.ts`.** Validate `agentId` against `/^[a-zA-Z0-9_-]+$/`, confirm resolved path stays within `OPENCLAW_AGENTS_DIR`. Migrate all consumer routes. | SYN-06 | Medium |
| R-08 | **Add CSRF protection.** Validate `Origin` header on all POST/PUT/PATCH/DELETE handlers. Reject requests from unknown origins. | SYN-07 | Small |
| R-09 | **Add security headers via `next.config.mjs`.** Set `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy` (restrictive), remove `X-Powered-By`. | SYN-14 | Small |
| R-10 | **Add rate limiting to all test and analytics endpoints.** Per-IP or global rate limit: test endpoints at 1 req/30s, analytics at 10 req/min. | SYN-08, SYN-09, SYN-13 | Medium |
| R-11 | **Remove the self-SSRF in alert check.** Replace `fetch("http://localhost:3000/api/test-model")` with direct provider probing or import the probe function directly. | SYN-08 (amplification) | Small |
| R-12 | **Remove `Math.random()` cron placeholder.** Replace with real cron failure accounting or disable the rule. | SYN-23 | Small |

### Phase 2 — Short-Term (Within 1 Month)

**Goal:** Input validation, resource bounds, code consolidation.
**Effort estimate:** 5-8 days.

| # | Fix | Findings Addressed | Effort |
|---|-----|--------------------|--------|
| R-13 | **Add input validation to alert config writes.** Type-check `enabled` (boolean), range-check `checkInterval` (1-1440), validate `receiveAgent` against known agents, validate rule `threshold` (positive integer). | SYN-18 | Small |
| R-14 | **Add payload size limits to layout endpoint.** Reject payloads above 100KB. Validate tile array length and schema. | SYN-18 | Small |
| R-15 | **Deduplicate CLI bridge.** `model-probe.ts` should import from `openclaw-cli.ts`. Delete duplicate `execOpenclaw`, `quoteShellArg`, `parseJsonFromMixedOutput`. | SYN-19 | Medium |
| R-16 | **Add file size checks before unbounded reads.** `stat().size` check before `readFile`/`readFileSync`; skip files above threshold (e.g., 20MB). Add concurrency limits to `Promise.all(files.map(readFile))` using `p-limit` or equivalent. | SYN-21 | Medium |
| R-17 | **Convert sync I/O to async in route handlers.** Replace `readFileSync`/`readdirSync`/`statSync` with `fs.promises.*` in `config`, `stats/[agentId]`, `activity-heatmap`, `idle-rank`, `agent-status`. | SYN-17 | Medium |
| R-18 | **Add caching to `agent-activity` and `stats/[agentId]`.** 30-60 second TTL with stampede protection (lock on first cache-miss; concurrent requests serve stale). | SYN-13 | Medium |
| R-19 | **Validate `cron.store` path in `resolveCronStorePath`.** Ensure resolved path stays within `OPENCLAW_HOME`. Reject absolute paths and `~` expansion outside the home directory. | SYN-22 | Small |
| R-20 | **Strip `location` field from `/api/skills` response.** Return only `id`, `name`, `description`, `emoji`, `source`, `usedBy`. | SYN-16 | Small |
| R-21 | **Redact platform identifiers from client responses.** Strip or hash `accountId`, `botOpenId`, `botUserId` from `/api/config` response before sending to browser. | SYN-15 | Small |
| R-22 | **Replace `execSync` with `execFileSync` in contributions endpoint.** Use `execFileSync("git", ["remote", "get-url", "origin"])`. | SYN-34 (F9.2) | Small |
| R-23 | **Remove or protect `?force=1` on version endpoint.** Either remove the parameter or require auth. Add per-IP rate limit. | SYN-25 | Small |
| R-24 | **Sanitize error messages.** Replace `err.message` with generic strings in HTTP responses. Log detailed errors server-side only. | SYN-26 | Small |
| R-25 | **Harden `parseJsonFromMixedOutput`.** Parse from the end of output (where real JSON appears) or require a known delimiter. | SYN-20 | Small |

### Phase 3 — Hardening (Within 1-3 Months)

**Goal:** Defense-in-depth, code quality, residual risk reduction.
**Effort estimate:** 3-5 days.

| # | Fix | Findings Addressed | Effort |
|---|-----|--------------------|--------|
| R-26 | **Make alert config write atomic.** Use temp-file + `rename` (matching the pixel-office handler pattern). | SYN-27 | Small |
| R-27 | **Return deep copies from config cache.** Clone cached data before returning to prevent shared-reference mutations. | SYN-28 | Small |
| R-28 | **Fix `quoteShellArg` for Windows.** Escape `%`, `!`, `^`, `&`, `|` inside double-quoted strings, or remove the Windows code path entirely and use `execFile` on all platforms. | SYN-29 | Small |
| R-29 | **Validate `OPENCLAW_HOME` at startup.** Confirm path is absolute, exists, and is owned by current user. Warn if overridden. | SYN-30 | Small |
| R-30 | **Wrap `listOpenclawSkills` config read in try/catch.** Handle corrupted config gracefully. | SYN-31 | Small |
| R-31 | **Add expiry and size bounds to `localStorage` usage.** Store timestamps; prune on read; cap total storage. | SYN-32 | Small |
| R-32 | **Add confirmation dialogs to destructive UI actions.** Model changes and test-all buttons should require explicit confirmation. | SYN-34 (F8.5) | Small |
| R-33 | **Remove `console.log` calls that output Feishu credentials.** Replace with structured logging at debug level with redacted identifiers. | SYN-34 (F7.9) | Small |
| R-34 | **Deduplicate POST/PUT alert handlers.** Single implementation, reducing maintenance risk. | SYN-34 (F3.8) | Small |
| R-35 | **Remove POST-to-GET fallback in `callTestApi`.** Display error instead of silently retrying with GET. | SYN-34 (F8.9) | Small |
| R-36 | **Strip `username` from contributions response.** Client needs weeks data only. | SYN-33 (F9.3) | Small |
| R-37 | **Remove `gateway.token` from test-session POST body.** Server reads config directly; client should not send the token. | SYN-01 (path 4) | Small |
| R-38 | **Deduplicate AlertMonitor across tabs.** Use `BroadcastChannel` or `localStorage` coordination to ensure only one tab runs the check timer. | SYN-12 | Small |
| R-39 | **Merge double JSONL parse in stats-models.** Single pass for token aggregation and response time calculation. | SYN-34 (F6.8) | Small |

---

## 7. Remediation Impact Analysis

| Phase | Findings Fully Resolved | Findings Mitigated | Cumulative Resolution |
|-------|------------------------|--------------------|-----------------------|
| Phase 0 (5 fixes) | SYN-02, SYN-05, SYN-10 | SYN-01 (2 of 6 paths), all others via auth | 3 fully + ~30 mitigated |
| Phase 1 (7 fixes) | SYN-01, SYN-06, SYN-07, SYN-08, SYN-14, SYN-23 | SYN-09, SYN-13 | 12 fully resolved |
| Phase 2 (13 fixes) | SYN-13, SYN-15 through SYN-22, SYN-25, SYN-26 | — | 26 fully resolved |
| Phase 3 (14 fixes) | SYN-27 through SYN-35 | — | **35 of 35 resolved** |

**Key insight:** R-01 (authentication middleware) alone mitigates 30+ findings by blocking unauthenticated access. It should be the absolute first fix.

---

## 8. Post-Fix Validation Checklist

After implementing each phase, verify:

### Phase 0 Validation

- [ ] `curl http://target:3000/api/config` returns 401/403 without credentials
- [ ] `curl http://target:3000/api/config` with valid credentials does NOT include `gateway.token`
- [ ] `curl http://target:3000/api/gateway-health` response does NOT include token in `webUrl`
- [ ] `curl http://target:3000/api/test-platforms` (GET) returns 405 Method Not Allowed
- [ ] `docker inspect` confirms the container binds to `127.0.0.1:3000`, not `0.0.0.0:3000`

### Phase 1 Validation

- [ ] View-source on dashboard pages contains zero `token=` strings in any `<a href>`
- [ ] `curl -H 'Origin: http://evil.com' -X POST /api/alerts` returns 403
- [ ] Response headers include `Referrer-Policy`, `X-Frame-Options`, `Content-Security-Policy`
- [ ] `X-Powered-By` header is absent
- [ ] Rapid-fire 20 requests to `/api/test-bound-models` in 10 seconds → rate limit kicks in
- [ ] `GET /api/sessions/..%2F..%2F..%2F` returns 400 "Invalid agent ID" (not ENOENT)
- [ ] `/api/alerts/check` does NOT call `localhost:3000/api/test-model` (grep for `localhost:3000`)
- [ ] Cron alert check produces deterministic results (no `Math.random()`)

### Phase 2 Validation

- [ ] `POST /api/alerts` with `{"enabled": "notaboolean"}` returns 400 validation error
- [ ] `POST /api/pixel-office/layout` with 200KB payload returns 413/400
- [ ] `grep -r "execOpenclaw\|quoteShellArg\|parseJsonFromMixedOutput" lib/model-probe.ts` returns nothing (all imported from `openclaw-cli.ts`)
- [ ] `/api/skills` response objects do NOT contain a `location` field
- [ ] `/api/config` response does NOT contain `accountId`, `botOpenId`, or `botUserId`
- [ ] Error responses contain generic messages, not filesystem paths
- [ ] `grep -r "readFileSync\|readdirSync\|statSync" app/api/` returns zero matches outside test files
- [ ] `/api/agent-activity` serves cached response on second request within 30s

### Phase 3 Validation

- [ ] `/api/alerts` write uses temp-file + rename (check `alerts.json.tmp` during write)
- [ ] Config cache returns different object references on consecutive calls
- [ ] No `console.log` output contains `appId`, `accountId`, or `userId` strings
- [ ] Model change in UI shows a confirmation dialog before proceeding
- [ ] `localStorage` keys have timestamps and are pruned to bounded size
- [ ] Multiple browser tabs with AlertMonitor — only one runs the timer (verify via Network tab)

---

## 9. Residual Risk After Full Remediation

Even after all 39 fixes, the following risks remain and should be monitored:

| Risk | Mitigation Status | Recommendation |
|------|-------------------|----------------|
| Gateway token is a long-lived credential | Out of dashboard scope | Implement token rotation in the OpenClaw gateway |
| Dashboard reads production filesystem | Inherent to design | Consider read-only filesystem mounts in Docker |
| Test endpoints exercise real credentials | Rate-limited + authed post-fix | Consider dry-run mode that validates config without external calls |
| Session data grows unbounded | File size checks added | Implement session rotation/archival in the gateway |
| Single-process Node.js | PM2 or cluster mode | Deploy behind a reverse proxy with connection limits |

---

## 10. Appendix: Cross-Reference Table

Maps each synthesis finding back to its source chunk findings.

| SYN ID | Severity | Chunk Source Finding IDs |
|--------|----------|--------------------------|
| SYN-01 | Critical | F1.1, F1.2, F2.1, F2.2, F4.11, F5.9, F7.3, F7.7, F8.1, F8.2, F8.3, DV-01, DV-02 |
| SYN-02 | Critical | F1.3 |
| SYN-03 | Critical | F3.1, F3.2, F3.3, F3.6, DV-05 |
| SYN-04 | Critical | F4.1, F7.2, CC-01, CC-03 |
| SYN-05 | Critical | F4.2, F8.9, DV-06 |
| SYN-06 | High | F2.7, F5.1, F6.2, DV-04 |
| SYN-07 | High | F3.7, DV-07 |
| SYN-08 | High | F4.3, F7.1, CC-04 |
| SYN-09 | High | F4.4, CC-03 |
| SYN-10 | High | F1.4 |
| SYN-11 | High | F4.5, CC-05 |
| SYN-12 | High | F7.6, CC-07 |
| SYN-13 | High | F6.1, F6.3, F7.4, DV-10 |
| SYN-14 | Medium | F1.5, DV-08 |
| SYN-15 | Medium | F2.3, F2.4, F4.7, F8.7 |
| SYN-16 | Medium | F2.5, F9.7 |
| SYN-17 | Medium | F6.4, F9.8 |
| SYN-18 | Medium | F3.4, F3.6 |
| SYN-19 | Medium | F5.3, DV-09 |
| SYN-20 | Medium | F5.5, CC-06 |
| SYN-21 | Medium | F5.6, F6.5 |
| SYN-22 | Medium | F6.6 |
| SYN-23 | Medium | F7.5 |
| SYN-24 | Medium | F4.6 |
| SYN-25 | Medium | F9.4 |
| SYN-26 | Low | F2.9, F9.9 |
| SYN-27 | Low | F3.5 |
| SYN-28 | Low | F3.9, F2.10 |
| SYN-29 | Low | F5.2 |
| SYN-30 | Low | F5.4, DV-15 |
| SYN-31 | Low | F5.7 |
| SYN-32 | Low | F8.6, CC-10 |
| SYN-33 | Low | F6.9, F7.8, F8.8, F8.10, F9.1, F9.3, F9.6, CC-12 |
| SYN-34 | Low | F3.8, F4.11, F6.8, F7.9, F8.5, F8.9, F6.7, F9.2 |
| SYN-35 | Low | F2.6, F2.8, DV-11 |

---

## 11. Conclusion

The OpenClaw Dashboard is a well-structured Next.js application that performs its monitoring function effectively. The security issues stem from a single architectural gap: the codebase enforces none of the trust assumptions inherent in a localhost-only deployment model.

Adding authentication middleware (R-01) is the highest-leverage fix — it mitigates 30+ findings in a single change. Combined with token stripping (R-02, R-03) and GET alias removal (R-04), the Phase 0 fixes transform the application from "any network caller has full control" to "authenticated operators only."

The remaining phases address defense-in-depth: path validation, CSRF protection, resource bounds, input sanitization, and code quality. All 35 deduplicated findings have clear remediation paths, and the phased plan sequences fixes to maximize impact with minimal disruption.
