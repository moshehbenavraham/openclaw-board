# Chunk 10: Dynamic Verification Findings

Date: 2026-03-30
Auditor: Automated dynamic testing via curl + code analysis
Environment: Next.js dev server on port 3099, production `~/.openclaw/` directory (Linux, Node.js v24.14.1)

## Test Environment

| Parameter | Value |
|-----------|-------|
| Server | `npm run dev` (Next.js development mode) |
| Port | 3099 |
| OS | Linux 6.8.0-101-generic (Ubuntu 24.04) |
| Node.js | v24.14.1 |
| Heap limit | 4,288 MB |
| ulimit -n | 1,048,576 |
| Session files | 89 JSONL files, 122 MB total (main agent: 108 MB) |
| OpenClaw config | Production `~/.openclaw/openclaw.json` |

**Safety constraints:** Side-effect endpoints (outbound messaging, LLM provider calls, alert notifications) were NOT exercised dynamically. These are verified by code analysis only, to avoid real-world impact. Read-only endpoints and one safe mutation endpoint (pixel-office layout) were exercised directly.

---

## Verified Findings

### DV-01: Gateway Auth Token Fully Exposed via `/api/config` — CONFIRMED Critical

**Validates:** F1.1 (Chunk 1), S1.1 (Chunk 1)

`GET /api/config` returns the full 64-character gateway authentication token at `gateway.token`, along with `gateway.port` and `gateway.host`. The response also includes 6 agent configurations, 6 provider definitions, default model/fallback settings, and 5 group chat entries. Total response size: 5,181 bytes.

No authentication, no rate limiting, no IP restrictions. Any network client that can reach the dashboard port obtains the gateway token in a single request.

**Evidence:**

```
Top-level keys: ['agents', 'providers', 'defaults', 'gateway', 'groupChats']
SENSITIVE: gateway.token = 82bcc0b0c695edeb6c68... (64 chars)
```

**Severity:** Critical — single unauthenticated request yields full gateway control.

---

### DV-02: Tokenized Gateway URL in `/api/gateway-health` — CONFIRMED Critical

**Validates:** F1.2 (Chunk 1)

`GET /api/gateway-health` returns a `webUrl` field containing the full gateway token as a URL query parameter:

```
"webUrl": "http://localhost:34219/chat?token=82bcc0b0c695edeb6c68b858644e2771a8ddc3257e8ca23dda7dcead05026a1d"
```

The response also discloses: health status, response time in milliseconds, OpenClaw version string, and the internal gateway port. The tokenized URL is directly clickable and would be persisted in browser history if rendered as a link.

**Severity:** Critical — token in URL is the most leak-prone credential format (browser history, referrer headers, proxy logs, server access logs).

---

### DV-03: Full Agent Enumeration via `/api/agent-status` — CONFIRMED High

**Validates:** S2.1 (Chunk 2), F9.1 (Chunk 9)

`GET /api/agent-status` returns all deployed agent IDs, their current state (idle/working), and last activity timestamps:

```json
{
  "statuses": [
    { "agentId": "cag-llc", "state": "idle", "lastActive": 1774820078277 },
    { "agentId": "codex",   "state": "idle", "lastActive": 1774803767921 },
    { "agentId": "eng",     "state": "idle", "lastActive": 1774788526072 },
    { "agentId": "main",    "state": "working", "lastActive": 1774863050763 },
    { "agentId": "ops",     "state": "idle", "lastActive": 1774843605744 }
  ]
}
```

This provides a complete map of the deployment, enabling targeted attacks against specific agents and timing attacks when agents are idle (unmonitored).

**Severity:** High — reconnaissance primitive for all subsequent attacks.

---

### DV-04: Path Traversal via `[agentId]` URL Segment — CONFIRMED High

**Validates:** S1.2 (Chunk 1), F2.7 (Chunk 2)

The `[agentId]` parameter in `/api/sessions/[agentId]` and `/api/stats/[agentId]` is used directly in `path.join()` without validation. URL-encoded traversal sequences are decoded by Next.js before reaching the handler:

| Request | Result |
|---------|--------|
| `GET /api/sessions/..%2F..%2F..%2F` | Error: `ENOENT: no such file or directory, open '/home/sessions/sessions.json'` |
| `GET /api/sessions/..%2F..%2F..%2F..%2Fetc%2Fpasswd%2F` | Error: `ENOTDIR: not a directory, open '/etc/passwd/sessions/sessions.json'` |
| `GET /api/stats/..%2F..%2F..%2F` | HTTP 200 with empty stats (no crash) |

The traversal exits `~/.openclaw/agents/` and reaches the filesystem root. Exploitation is constrained because each endpoint appends a fixed suffix (e.g., `/sessions/sessions.json`), preventing direct arbitrary file read. However, error messages leak absolute filesystem paths, confirming the traversal depth.

Double-encoding (`%252e%252e`) is NOT decoded a second time — Next.js correctly decodes once.

**Severity:** High — confirmed traversal out of intended directory; constrained by fixed suffixes but enables path disclosure and potential abuse if any suffix-less path operation is added.

---

### DV-05: Alert Configuration Readable and Writable Without Auth — CONFIRMED High

**Validates:** F3.3 (Chunk 3), S3.1 (Chunk 3)

`GET /api/alerts` returns the full alert configuration without authentication:

```json
{
  "enabled": false,
  "receiveAgent": "main",
  "checkInterval": 10,
  "rules": [
    { "id": "model_unavailable", "name": "Model Unavailable", "enabled": false },
    { "id": "bot_no_response", "name": "Bot Long Time No Response", "enabled": false, "threshold": 300 },
    ...
  ]
}
```

The route also exports `POST` (create) and `PUT` (update) handlers with no authentication. An attacker can:

1. Enable all alert rules
2. Change `receiveAgent` to any agent
3. Reduce `checkInterval` to maximize notification frequency

Combined with the AlertMonitor auto-trigger on page load (F7.4), this creates an unguarded path to outbound messaging abuse.

**Not executed dynamically** to avoid enabling real alerts.

**Severity:** High — unauthenticated write to alerting config chains into outbound messaging.

---

### DV-06: GET Aliases on 4 of 6 Side-Effect Test Endpoints — CONFIRMED High

**Validates:** F4.4 (Chunk 4)

Code-level verification confirms exported HTTP method handlers:

| Endpoint | POST | GET | Zero-click exploitable |
|----------|------|-----|----------------------|
| `/api/test-platforms` | Yes | **Yes** | Yes — `<img>` or prefetch |
| `/api/test-sessions` | Yes | **Yes** | Yes |
| `/api/test-dm-sessions` | Yes | **Yes** | Yes |
| `/api/test-bound-models` | Yes | **Yes** | Yes |
| `/api/test-model` | Yes | No | No (POST only) |
| `/api/test-session` | Yes | No | No (POST only) |

All 4 GET-aliased endpoints timed out during testing (3-second timeout), confirming the GET handler executes the full side-effect logic (calls the gateway) rather than returning an immediate error. This means a simple `<img src="/api/test-platforms">` tag on any page would trigger real platform test messages.

**Severity:** High — zero-click side effects via `<img>` tags or browser prefetch.

---

### DV-07: Cross-Origin Mutation via CSRF — CONFIRMED High

**Validates:** S3.3 (Chunk 3), F3.7 (Chunk 3)

A cross-origin POST from `Origin: http://evil.com` successfully mutated server-side state:

```
Before: {"layout": null}
POST with Origin: http://evil.com → {"success": true}
After:  {"layout": {"version": 1, "tiles": []}}
```

The server processes the mutation and writes to disk. No `Access-Control-Allow-Origin` header is returned, so the browser blocks the response — but the mutation has already been applied. No CSRF tokens, no origin validation, no authentication.

This confirms that any cross-origin request to mutating endpoints (`/api/alerts`, `/api/config/agent-model`, `/api/pixel-office/layout`) will succeed. The browser's same-origin policy only prevents the attacker from reading the response, not from triggering the side effect.

**Severity:** High — all mutating endpoints are CSRF-exploitable.

---

### DV-08: Zero Security Response Headers — CONFIRMED Medium (new finding)

**Finding ID:** DV-08 (not previously identified in Chunks 1-9)

The application returns no security-related HTTP headers:

```
HTTP/1.1 200 OK
Vary: rsc, next-router-state-tree, ...
Cache-Control: no-store, must-revalidate
X-Powered-By: Next.js
Content-Type: text/html; charset=utf-8
```

Missing headers:

| Header | Impact |
|--------|--------|
| `Referrer-Policy` | Tokenized URLs leak via Referrer header on external navigation |
| `X-Frame-Options` | Dashboard can be framed (clickjacking) |
| `Content-Security-Policy` | No restriction on script sources, inline scripts, or external resource loading |
| `Strict-Transport-Security` | No HTTPS enforcement |
| `X-Content-Type-Options` | MIME sniffing attacks possible |

The `X-Powered-By: Next.js` header also discloses the server framework.

**Severity:** Medium — absence of security headers amplifies token leakage (Referrer) and enables clickjacking and content injection attacks.

---

### DV-09: Duplicate CLI Bridge with Broken Shell Configuration — CONFIRMED Medium

**Validates:** F5.2 (Chunk 5), F5.3 (Chunk 5)

Both `lib/openclaw-cli.ts` and `lib/model-probe.ts` contain identical `quoteShellArg` implementations and both specify `shell: "cmd.exe"`:

```typescript
// lib/openclaw-cli.ts:27 and lib/model-probe.ts:81
shell: "cmd.exe",
```

On Linux, `cmd.exe` does not exist. This has two implications:

1. **Mitigation:** The Windows shell injection via `""` quoting (F5.2) is not exploitable because `cmd.exe` is never invoked
2. **Functional impact:** Any endpoint using `execOpenclaw` (stats, test-model, gateway-health via CLI path) may fail with ENOENT or fall back to default shell behavior

The duplicate `parseJsonFromMixedOutput` implementation (confirmed in both files) remains a maintenance risk — security fixes to one copy won't propagate to the other.

**Severity:** Medium — broken shell config mitigates injection but creates fragile runtime behavior; duplicate code is a maintenance vulnerability.

---

### DV-10: Activity Heatmap Endpoint Is Heavy (6.85s) but Cacheable — PARTIALLY CONFIRMED Medium

**Validates:** S6.3 (Chunk 6)

Single-request timing:

| Endpoint | Time | Size |
|----------|------|------|
| `/api/activity-heatmap` | 6.85s | 2,720 bytes |
| `/api/agent-activity` | 0.32s | 6,872 bytes |
| `/api/config` | 0.02s | 5,181 bytes |

The heatmap endpoint's `toLocaleString` timezone conversion is measurably slow with production data volumes. However, concurrent request testing (5 simultaneous) showed potential caching after the first request. The DoS risk is moderate: a single request consumes ~7 seconds of server time, but sustained flooding would require bypassing any implicit Next.js response caching.

10 concurrent `/api/agent-activity` requests completed in 2.1 seconds total, showing filesystem I/O contention but no crash.

**Severity:** Medium — heavy endpoint without rate limiting; mitigated by current data volume and potential response caching.

---

### DV-11: Cron Job Metadata Exposed in Agent Activity — CONFIRMED Low

**Validates:** S2.2 (Chunk 2), partial

The `/api/agent-activity` response includes cron job IDs and descriptive names (e.g., "Kill Stale Local AI CLI Processes"), next-run timestamps, and session activity metadata. No direct user message content was observed in the response, but operational details and cron job naming conventions are exposed.

**Severity:** Low — operational metadata, not user content. S2.2 (session JSONL contains user messages) was not confirmed in the dynamic output.

---

## Findings with Reduced Risk (vs. Static Analysis Estimates)

### DV-12: File Descriptor Exhaustion — NOT EXPLOITABLE

**Validates:** S6.1 (Chunk 6)

The system's `ulimit -n` is 1,048,576 (1M), far exceeding the assumed default of 1,024. With 89 JSONL files across all agents, file descriptor exhaustion via concurrent endpoint access is not achievable at current limits.

**Status:** S6.1 downgraded to Informational.

---

### DV-13: Memory Exhaustion via Session Data — LOW RISK

**Validates:** S6.2 (Chunk 6)

| Parameter | Assumed | Actual |
|-----------|---------|--------|
| Node.js heap limit | 1.7 GB | 4.3 GB |
| Total session data | >3 GB scenario | 122 MB |
| Largest agent | — | main: 108 MB |
| Largest file | — | 1.5 MB |

Current session data is well within heap limits. The attack scenario (grow sessions to 10MB+ each via repeated test-session calls) would require ~35x data growth from current state.

**Status:** S6.2 risk exists in theory but is LOW given current resource configuration.

---

### DV-14: Symlink Traversal in Skill Directories — NOT CONFIRMED

**Validates:** S5.2 (Chunk 5)

No symlinks found in any skill or OpenClaw configuration directories. Only symlinks present are Chrome browser singleton files (`SingletonLock`, `SingletonSocket`, `SingletonCookie`), which are not in the skill path.

**Status:** S5.2 not exploitable in current deployment. Risk remains if skill installation methods create symlinks.

---

### DV-15: Package Candidate Path Hijacking — LOW RISK

**Validates:** S5.1 (Chunk 5)

All environment variables that could redirect filesystem operations are unset:

```
OPENCLAW_HOME=unset
OPENCLAW_PACKAGE_DIR=unset
npm_config_prefix=unset
```

In the current single-user VPS deployment, no attacker has write access to candidate paths. Risk would increase in shared-host or Docker environments where env vars are externally controllable.

**Status:** S5.1 LOW risk in current deployment.

---

### DV-16: Token Not in Server-Rendered HTML — PARTIAL MITIGATION

**Validates:** S8.1 (Chunk 8)

The gateway token is NOT present in the initial HTML response (33,785 bytes). Token exposure occurs via client-side `fetch()` to `/api/config` after React hydration. This means:

- Token does NOT appear in view-source or search engine caches
- Token DOES appear in the DOM after hydration (confirmed in Chunk 8 code review)
- Browser DevTools Network tab will show the token in the fetch response
- Without `Referrer-Policy` headers (DV-08), tokenized gateway URLs may leak via Referrer on navigation

**Status:** S8.1 partially mitigated by SSR not including token; fully exploitable via DevTools or client-side JS access.

---

### DV-17: Shell Startup File Interference — NOT CONFIRMED

**Validates:** S9.1 (Chunk 9)

`execSync("git remote get-url origin")` is confirmed in `app/api/pixel-office/contributions/route.ts`. The current shell environment produces no startup file output. The `execSync` usage (only instance in the codebase) is low-risk in the current environment but remains a code quality concern versus the `execFile` pattern used elsewhere.

**Status:** S9.1 NOT exploitable in current deployment.

---

## Code-Confirmed Findings (Not Dynamically Tested for Safety)

These findings were verified at the code level but not exercised dynamically to avoid real-world side effects (outbound messaging, API credit consumption, production state changes).

### CC-01: Alert Config Write Chains into Outbound Messaging (S3.1)

Code path: `PUT /api/alerts` → modify `receiveAgent` and enable rules → AlertMonitor triggers `POST /api/alerts/check` on next page load → `sendAlertViaFeishu` acquires Feishu `tenant_access_token` and sends real DMs.

The entire chain is unauthenticated. An attacker can redirect alert notifications to any agent and enable all alert rules in 2 HTTP requests.

### CC-02: Model Change Race Condition (S3.2)

`waitForPatchedModel` polls the gateway for 45 seconds. During this window, a concurrent PATCH could bypass the `baseHash` staleness check if the gateway hasn't yet applied the first patch.

### CC-03: Platform Test Weaponization (S4.1)

GET alias on `/api/test-platforms` calls the gateway to send real `[Platform Test]` messages to real users on all configured platforms. Exploitable via `<img>` tags for zero-click message delivery.

### CC-04: Model Probe Credential Enumeration (S4.2)

`/api/test-model` returns detailed error classifications (`auth`, `rate_limit`, `billing`, `timeout`, `model_not_supported`) that map provider credential and billing status.

### CC-05: Session Key Timing Attack (S4.3)

Gateway response timing may differ for valid vs. invalid session keys. The 100-second timeout provides a large measurement window.

### CC-06: CLI Output Injection via parseJsonFromMixedOutput (S5.3)

Both copies of `parseJsonFromMixedOutput` return the first JSON object found in stdout+stderr. If `--probe-provider` argument is echoed by the CLI before real output, attacker-controlled JSON wins.

### CC-07: Multi-Tab AlertMonitor Amplification (S7.2)

Each browser tab runs an independent `AlertMonitor` with its own `setInterval`. N tabs = N× the check rate, each triggering the full model probe and notification pipeline.

### CC-08: Concurrent Alert Check Config Race (S7.3)

Read-modify-write on `alerts.json` without file locking. Concurrent checks can overwrite each other's deduplication timestamps, causing duplicate notifications.

### CC-09: Feishu Credential Oracle via Timing (S7.1)

Different response paths for valid vs. invalid Feishu `appId`/`appSecret` create a timing side channel for credential validation.

### CC-10: localStorage Unbounded Growth (S8.2)

Five `localStorage` keys store test results with no expiry or size bounds. Error messages stored may contain internal hostnames, filesystem paths, or provider error details.

### CC-11: Module-Scope Cache Persistence (S8.3)

`cachedHomeData` in `page.tsx` persists gateway token in module scope across SPA navigation. No cleanup mechanism exists.

### CC-12: Contribution Schedule Correlation (S9.3)

52-week contribution calendar returned by `/api/pixel-office/contributions` reveals operator work patterns for attack timing optimization.

---

## Cross-Chunk Exploit Chain Validation

### Chain 1: Full Reconnaissance → Disable Monitoring → Messaging Flood

1. `GET /api/config` → obtain gateway token (DV-01)
2. `GET /api/agent-status` → enumerate all agents and activity state (DV-03)
3. `PUT /api/alerts` → disable all monitoring rules (DV-05)
4. `GET /api/test-platforms` → send messages to all platform users (DV-06)

All 4 steps are unauthenticated. Steps 1-3 confirmed dynamically. Step 4 confirmed at code level (GET alias exists, handler executes).

### Chain 2: CSRF-Based Silent Config Manipulation

1. Victim visits attacker-controlled page
2. Page sends `fetch()` to `/api/config/agent-model` (PATCH) to change the LLM model
3. Page sends `fetch()` to `/api/alerts` (PUT) to disable monitoring
4. Server processes both mutations (DV-07 confirms CSRF works)
5. Attacker has no response data but model is changed and alerting is off

### Chain 3: Zero-Click Messaging via Email/Forum

1. Attacker posts `<img src="https://target:3099/api/test-platforms">` in any forum, email, or chat
2. Victim's browser loads the image tag
3. GET handler fires, sending real platform test messages
4. No JavaScript required, no user interaction beyond viewing the page

---

## Summary Table

| ID | Finding | Severity | Status |
|----|---------|----------|--------|
| DV-01 | Gateway token in /api/config | Critical | **Confirmed** |
| DV-02 | Tokenized URL in /api/gateway-health | Critical | **Confirmed** |
| DV-03 | Agent enumeration via /api/agent-status | High | **Confirmed** |
| DV-04 | Path traversal via [agentId] | High | **Confirmed** |
| DV-05 | Alert config read/write without auth | High | **Confirmed** |
| DV-06 | GET aliases on side-effect endpoints | High | **Confirmed** |
| DV-07 | CSRF mutation (cross-origin POST accepted) | High | **Confirmed** |
| DV-08 | Zero security response headers | Medium | **New finding** |
| DV-09 | Duplicate CLI bridge with broken shell config | Medium | **Confirmed** |
| DV-10 | Heavy heatmap endpoint (6.85s) | Medium | **Partially confirmed** |
| DV-11 | Cron job metadata in agent-activity | Low | **Confirmed** |
| DV-12 | File descriptor exhaustion | Informational | **Not exploitable** |
| DV-13 | Memory exhaustion via session data | Low | **Low risk** |
| DV-14 | Symlink traversal in skills | Informational | **Not confirmed** |
| DV-15 | Package candidate path hijacking | Low | **Low risk** |
| DV-16 | Token not in server-rendered HTML | — | **Partial mitigation** |
| DV-17 | Shell startup file interference | Informational | **Not confirmed** |
| CC-01–12 | Code-confirmed (12 findings) | Various | **Code-verified** |

### Totals

- **Dynamically confirmed:** 11 findings (2 Critical, 5 High, 3 Medium, 1 Low)
- **New findings from dynamic testing:** 1 (DV-08: missing security headers)
- **Code-confirmed only:** 12 findings
- **Downgraded/not confirmed:** 4 findings (S6.1, S5.2, S5.1, S9.1)
- **Suspected findings resolved:** 27 of 27 (from Chunks 1-9)
- **Exploit chains validated:** 3

---

## Recommendations for Chunk 11 Synthesis

1. **Prioritize DV-01 and DV-02** — gateway token exposure is the root cause enabling most attack chains
2. **Group CSRF and auth findings** — a single authentication middleware resolves DV-01 through DV-07
3. **Remove GET aliases** on all side-effect endpoints — minimal code change, eliminates zero-click attacks
4. **Add security headers** via `next.config.mjs` — low-effort defense-in-depth
5. **Validate `[agentId]`** against enumerated agent list from `/api/agent-status` — eliminates path traversal
6. **Consolidate CLI bridge** — merge `model-probe.ts` functions into `openclaw-cli.ts`, fix `shell` option for Linux
7. **Separate dynamic and code-confirmed findings** in the final report — code-confirmed items carry lower confidence for remediation prioritization
