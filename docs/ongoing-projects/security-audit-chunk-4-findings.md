# Chunk 4 Findings: Side-Effect Test Endpoints and Outbound Messaging Abuse

Date: 2026-03-29
Auditor: Cursor (automated)
Status: **Complete**

---

## 1. Files Reviewed

| File | Purpose |
|------|---------|
| `app/api/test-platforms/route.ts` | POST/GET -- tests connectivity to all configured messaging platforms by sending real DMs (Telegram, Discord, Feishu, WhatsApp, QQBot, Yuanbao, generic channels) |
| `app/api/test-sessions/route.ts` | POST/GET -- tests agent sessions by sending "Health check: reply with OK" to the gateway chat completions endpoint for each agent |
| `app/api/test-dm-sessions/route.ts` | POST/GET -- tests DM sessions across all platforms by sending health check messages through the gateway for each agent/platform/DM-user combination |
| `app/api/test-session/route.ts` | POST -- tests a single specific session by sessionKey + agentId from request body |
| `app/api/test-model/route.ts` | POST -- probes a specific LLM model by provider + modelId |
| `app/api/test-bound-models/route.ts` | POST/GET -- probes all models bound to all agents simultaneously |
| `lib/session-test-fallback.ts` | CLI fallback for session tests when the gateway route returns 404; also contains response parsing helpers |
| `lib/model-probe.ts` | Direct model probing logic; reads provider configs (including API keys) from disk, makes direct HTTP requests to LLM provider APIs, or falls back to `openclaw models status --probe` CLI |

---

## 2. Threat Model Summary for This Surface

These endpoints form the **active testing surface** of the dashboard. Unlike the read-only endpoints in Chunk 2 and the config-write endpoints in Chunk 3, these routes trigger **real external side effects**:

1. **Outbound messages** to real users on production messaging platforms (Telegram, Discord, Feishu, WhatsApp, QQBot, Yuanbao)
2. **LLM API calls** that consume real API credits and quotas
3. **External API authentication flows** that exercise production credentials (obtaining access tokens from Feishu, QQBot, Discord)
4. **WebSocket connections** to external services (Yuanbao)
5. **Local CLI subprocess execution** for platforms that route through the OpenClaw gateway

None of these endpoints have authentication (confirmed in Chunk 1, F1.3). Four of the six route files expose `GET` aliases that delegate directly to the `POST` handler, meaning side effects can be triggered by `<img>` tags, link prefetching, search crawlers, or simple browser navigation.

The combined threat: any network caller can, without authentication, send messages as the bot to real users, burn LLM API credits, lock out bot accounts via external rate limiting, and exercise every configured platform credential.

---

## 3. Trust Boundaries and Attacker-Controlled Inputs

| Input | Endpoint | How Used | Risk |
|-------|----------|----------|------|
| None (config-driven) | `/api/test-platforms` POST/GET | Reads `openclaw.json` for all platform credentials and session files for DM targets | Triggers outbound messages using production credentials |
| None (config-driven) | `/api/test-sessions` POST/GET | Reads `openclaw.json` for gateway port/token; enumerates agents from config or filesystem | Sends LLM completions requests consuming API credits |
| None (config-driven) | `/api/test-dm-sessions` POST/GET | Reads `openclaw.json` for gateway port/token, channels, bindings; reads session files for DM users | Sends LLM completions requests per platform/agent combination |
| `body.sessionKey` (string) | `/api/test-session` POST | Used directly as `x-openclaw-session-key` header to the gateway | Attacker-controlled session key sent to gateway |
| `body.agentId` (string) | `/api/test-session` POST | Used as `x-openclaw-agent-id` header and in model string | Attacker-controlled agent ID sent to gateway |
| `body.provider` (string) | `/api/test-model` POST | Used as `providerId` for model probing | Attacker-controlled; used to look up provider config on disk |
| `body.modelId` (string) | `/api/test-model` POST | Used as model identifier for direct API probing | Attacker-controlled; sent to external LLM API |
| `agentId` from config | All test routes | Used in `path.join()` for session file reads | Config-derived but if config is attacker-modified (F3.1), could be abused |

---

## 4. Confirmed Findings

### F4.1: Unauthenticated Outbound Messaging to Real Users (Critical)

**Severity: Critical**
**File:** `app/api/test-platforms/route.ts`, lines 1078-1227

The `POST /api/test-platforms` endpoint reads all platform credentials from `openclaw.json` and sends real DM messages to real users across every configured messaging platform. No authentication is required.

Platforms exercised and their message-sending mechanisms:

| Platform | Mechanism | Credential Used |
|----------|-----------|-----------------|
| Feishu/Lark | Direct HTTP POST to Feishu IM API with `tenant_access_token` | `appId` + `appSecret` from config |
| Discord | `curl` to Discord REST API with bot token in `Authorization` header | `discord.token` from config |
| Telegram | `openclaw message send --channel telegram` CLI subprocess | Gateway-managed credentials |
| WhatsApp | `openclaw message send --channel whatsapp` CLI subprocess | Gateway-managed credentials |
| QQBot | Direct HTTP POST to QQ API with `QQBot` access token | `appId` + `clientSecret` from config |
| Yuanbao | WebSocket connection + `sendYuanbaoMessage` via dynamically imported plugin | `appKey` + `appSecret` from config |
| Generic | `openclaw message send --channel <name>` CLI subprocess | Gateway-managed credentials |

Each message is a `[Platform Test] ... connectivity test` string with a timestamp. While the content is benign, the messages are real and delivered to real users.

**Impact:**
- An attacker can send messages as the bot to every user who has ever DM'd the bot
- Repeated invocations flood real users with test messages (no rate limiting)
- Messages arrive from the legitimate bot identity, potentially undermining user trust
- The endpoint exercises all platform credentials, confirming they are valid and the bot is operational

**Exploit:**
```bash
# Trigger real messages to all configured platform users
curl -X POST http://<target>:3000/api/test-platforms

# Or simply visit in a browser (GET alias)
curl http://<target>:3000/api/test-platforms
```

### F4.2: GET Aliases on Side-Effect Endpoints Enable Passive Triggering (Critical)

**Severity: Critical**
**Files:**
- `app/api/test-platforms/route.ts`, line 1225-1227: `export async function GET() { return POST(); }`
- `app/api/test-sessions/route.ts`, line 92-94: `export async function GET() { return POST(); }`
- `app/api/test-dm-sessions/route.ts`, line 148-150: `export async function GET() { return POST(); }`
- `app/api/test-bound-models/route.ts`, line 98-100: `export async function GET() { return POST(); }`

All four endpoints perform significant side effects (sending messages, making LLM API calls, authenticating against external services) but respond identically to GET and POST requests.

GET requests can be triggered without any user interaction through:

| Vector | Example |
|--------|---------|
| Image tag | `<img src="http://target:3000/api/test-platforms">` |
| Link prefetch | `<link rel="prefetch" href="http://target:3000/api/test-sessions">` |
| CSS background | `background: url(http://target:3000/api/test-platforms)` |
| Search crawler | Any crawler that follows links will trigger all tests |
| Browser bookmark | Bookmarking the URL triggers tests on open |
| Chat preview | Pasting the URL in Slack/Discord triggers link unfurling |

This converts every side-effect endpoint into a zero-click attack vector. An attacker embedding an `<img>` tag in any web page, email, or chat message that the operator views will trigger outbound messaging and API credit consumption.

### F4.3: LLM API Credit Exhaustion via Unauthenticated Model Probing (High)

**Severity: High**
**Files:**
- `app/api/test-sessions/route.ts`, lines 37-52
- `app/api/test-dm-sessions/route.ts`, lines 52-67
- `app/api/test-model/route.ts`, lines 6-33
- `app/api/test-bound-models/route.ts`, lines 31-96
- `lib/model-probe.ts`, lines 190-307

Each of these endpoints makes real LLM API calls that consume production API credits:

- **`/api/test-sessions`** sends a chat completion to the gateway for every configured agent
- **`/api/test-dm-sessions`** sends a chat completion for every agent × platform × DM-user combination
- **`/api/test-model`** makes a direct HTTP request to an LLM provider API using credentials from `models.json`
- **`/api/test-bound-models`** probes all unique models across all agents simultaneously

No rate limiting exists on any of these endpoints. An attacker can:

1. Call `/api/test-bound-models` in a loop to probe all models on every request
2. Call `/api/test-sessions` repeatedly to generate completions for all agents
3. Use `/api/test-model` with any `providerId`/`modelId` combination to probe specific providers

**Cost amplification:** `/api/test-bound-models` fires all probes in parallel (`modelProbeTasks` map, line 47), so a single request triggers N concurrent LLM API calls where N is the number of unique models.

**Exploit:**
```bash
# Probe all models at once (single request, multiple API calls)
curl http://<target>:3000/api/test-bound-models

# Probe a specific model
curl -X POST http://<target>:3000/api/test-model \
  -H 'Content-Type: application/json' \
  -d '{"provider":"anthropic","modelId":"claude-sonnet-4-6"}'

# Burn credits in a loop
while true; do curl -s http://<target>:3000/api/test-bound-models > /dev/null; done
```

### F4.4: External Rate Limiting Lockout via Platform Test Abuse (High)

**Severity: High**
**File:** `app/api/test-platforms/route.ts`

Repeated calls to `/api/test-platforms` make authenticated API calls to external services with strict rate limits:

| Platform | Rate Limit Risk | Consequence |
|----------|-----------------|-------------|
| Discord | 50 requests per second per bot | Bot token temporarily or permanently suspended |
| Feishu | Varies by API | `tenant_access_token` generation limited; DM sending throttled |
| QQBot | Platform-dependent | Access token generation and message sending throttled |
| Yuanbao | WebSocket connection limits | Connection refused; bot disconnected |

An attacker repeatedly hitting `/api/test-platforms` (especially via the GET alias, enabling trivial scripting) could exhaust platform rate limits, effectively **locking the real bot out of its messaging platforms**. The bot would stop receiving or sending messages on those platforms until rate limits expire.

This is a denial-of-service attack that uses the dashboard to disable the bot's own communication channels.

### F4.5: Attacker-Controlled Session Key and Agent ID in `/api/test-session` (High)

**Severity: High**
**File:** `app/api/test-session/route.ts`, lines 8-84

Unlike the other test endpoints (which derive parameters from config), `/api/test-session` accepts `sessionKey` and `agentId` directly from the request body:

```javascript
const { sessionKey, agentId } = await req.json();
```

These values are forwarded to the gateway without sanitization:

```javascript
headers: {
  "x-openclaw-agent-id": agentId,
  "x-openclaw-session-key": sessionKey,
},
body: JSON.stringify({
  model: `openclaw:${agentId}`,
  messages: [{ role: "user", content: "Health check: reply with OK" }],
})
```

**Impact:**
- An attacker can probe arbitrary session keys to determine which sessions exist (timing-based or response-based enumeration)
- An attacker can inject arbitrary `agentId` values into the `x-openclaw-agent-id` header, potentially confusing gateway routing
- The session key format (`agent:<id>:<platform>:direct:<userId>`) contains user identifiers; an attacker knowing the format can forge session keys for specific users
- Each request triggers a real LLM completion using the gateway auth token

The `shouldFallbackToCli` path (line 46-54) additionally calls `testSessionViaCli(agentId)`, which passes the attacker-controlled `agentId` to `execOpenclaw(["agent", "--agent", agentId, ...])`. While `execFile` prevents shell injection, crafted `agentId` values with path-like characters could cause unexpected CLI behavior.

### F4.6: Platform Credentials Exercised Without Authentication (Medium)

**Severity: Medium**
**Files:**
- `app/api/test-platforms/route.ts`, lines 1078-1096 (config reading)
- `lib/model-probe.ts`, lines 120-137 (`loadProviderConfig`)

The test-platforms handler reads the full `openclaw.json` configuration and extracts production credentials:

| Credential | Config Path | How Exercised |
|------------|-------------|---------------|
| Discord bot token | `channels.discord.token` | Sent in `Authorization: Bot <token>` header to Discord API |
| Feishu app secret | `channels.feishu.accounts[].appSecret` | POSTed to Feishu token endpoint to obtain `tenant_access_token` |
| QQBot client secret | `channels.qqbot.clientSecret` | POSTed to QQ token endpoint to obtain access token |
| Yuanbao app secret | `channels.yuanbao.appSecret` | Used via `getSignToken()` for WebSocket authentication |
| Gateway auth token | `gateway.auth.token` | Used in `Authorization: Bearer` header for localhost gateway calls |

Additionally, `lib/model-probe.ts` reads `models.json` to extract LLM provider API keys:

| Credential | Config Path | How Exercised |
|------------|-------------|---------------|
| Provider API keys | `providers[].apiKey` | Sent in auth headers to LLM provider APIs |

While these credentials are not returned in API responses, any network caller can trigger authenticated requests using all configured credentials. This confirms credential validity to an attacker and allows them to indirectly exercise every integrated service.

### F4.7: Session File Reads Leak Internal User Identifiers in Responses (Medium)

**Severity: Medium**
**File:** `app/api/test-platforms/route.ts`, multiple DM user lookup functions

The test-platforms endpoint reads `~/.openclaw/agents/{agentId}/sessions/sessions.json` to find DM target users (lines 101-122, 318-339, 351-373, 383-418, 501-522, 757-778, 791-812). The found user identifiers are then included in the response:

```javascript
detail: `Telegram → DM sent to ${testChatId} (${elapsed}ms)`
// or
detail: `${botName} → DM sent (${elapsed}ms, via ${sourceLabel})`
```

Response `PlatformTestResult` objects expose:
- Telegram chat IDs
- Discord user IDs (with `session`/`allowFrom` source labels)
- Feishu open IDs (`ou_*` format)
- WhatsApp phone numbers
- QQBot user/group identifiers
- Yuanbao user identifiers

These identifiers reveal who has been communicating with the bot on each platform.

### F4.8: Dynamic Module Import via `new Function` Wrapper (Medium)

**Severity: Medium**
**File:** `app/api/test-platforms/route.ts`, lines 14, 475-488

The Yuanbao test path uses a `new Function` wrapper to dynamically import modules:

```javascript
const importExternalModule = new Function("modulePath", "return import(modulePath)");
```

This is used to load runtime modules from `YUANBAO_PLUGIN_DIST_DIR`:

```javascript
importExternalModule(pathToFileURL(path.join(YUANBAO_PLUGIN_DIST_DIR, "yuanbao-server/http/request.js")).href)
```

The `new Function` pattern bypasses static analysis tools, CSP `script-src` policies, and build-time import validation. The import path is derived from `OPENCLAW_HOME` (a filesystem constant), not from user input, so the immediate risk is contained. However:

- If `OPENCLAW_HOME` is ever attacker-influenced (e.g., via environment variable injection), arbitrary modules could be loaded
- The imported modules (`getSignToken`, `YuanbaoWsClient`, `sendYuanbaoMessage`) execute with full Node.js privileges
- Build tools and security scanners cannot trace the dependency chain

### F4.9: 100-Second Request Timeout Enables Connection Exhaustion (Medium)

**Severity: Medium**
**Files:**
- `app/api/test-sessions/route.ts`, line 51: `AbortSignal.timeout(100000)`
- `app/api/test-dm-sessions/route.ts`, line 67: `AbortSignal.timeout(100000)`
- `app/api/test-session/route.ts`, line 39: `AbortSignal.timeout(100000)`

Three session test endpoints use 100-second timeouts for gateway requests. Combined with sequential execution in `test-dm-sessions` (which tests each platform/agent/DM combination one-by-one in a loop), a single request could block for many minutes.

Additionally, `test-platforms` uses blocking `execFileSync` calls with 30-second timeouts (line 42) for CLI-based message sending, further blocking the Node.js event loop.

An attacker sending concurrent requests can exhaust the server's connection capacity:
- Each `/api/test-dm-sessions` request could block for (number of platforms × number of agents × 100 seconds)
- Each `/api/test-platforms` request blocks on sequential `execFileSync` calls
- No concurrent request limiting exists

### F4.10: CLI Subprocess Execution with Config-Derived Arguments (Low)

**Severity: Low**
**File:** `app/api/test-platforms/route.ts`, lines 31-46

`runOpenClawMessageSend` executes `openclaw message send` via `execFileSync`:

```javascript
return execFileSync("openclaw", args, {
  timeout: 30000,
  encoding: "utf-8",
  env: { ...process.env },
});
```

**Positive:** Uses `execFileSync` (not `exec`), which does not invoke a shell. Arguments are passed as an array, preventing shell injection. This is the correct pattern.

The `target` argument (DM user ID) comes from session files on disk, not from direct user input. The `channel` argument is derived from config channel names. Both are trusted inputs under normal operation but could be manipulated if an attacker modifies config (via F3.1) or session files.

### F4.11: Unused `probeGatewayWebUi` Function Passes Token in URL (Low)

**Severity: Low**
**File:** `app/api/test-platforms/route.ts`, lines 48-64

The `probeGatewayWebUi` function passes the gateway auth token as a URL query parameter:

```javascript
`http://localhost:${port}/chat${token ? `?token=${encodeURIComponent(token)}` : ""}`
```

This function does not appear to be called by the current `POST` handler, but it is defined in the route file and could be activated in future changes. If used, the gateway token would appear in:
- Server access logs (gateway side)
- Any proxy or monitoring tool capturing HTTP traffic
- Browser history if the URL were ever rendered client-side

---

## 5. Suspected Findings (Require Dynamic Validation)

### S4.1: Platform Test Weaponized for User Harassment

An attacker could repeatedly call `POST /api/test-platforms` (or simply embed a GET link) to flood real users with `[Platform Test]` messages. The messages arrive from the legitimate bot identity, and there is no rate limiting on the dashboard side. If the attacker additionally modifies the `allowFrom` list via the unauthenticated alert config endpoint (F3.3 -- though `allowFrom` is channel config, not alert config), they could potentially redirect test messages to arbitrary users.

**Needs validation in Chunk 10 (Dynamic Verification):** Confirm message delivery rate, external rate limiting behavior, and whether any platform-side deduplication prevents rapid flooding.

### S4.2: Model Probe Enumerates Valid Provider Credentials

An attacker could use `/api/test-model` with varying `provider`/`modelId` combinations to:
1. Enumerate which LLM providers are configured (based on success vs. "No probe result" errors)
2. Determine which API keys are valid (success vs. auth errors)
3. Identify billing status (HTTP 402 responses classified as "billing" in `classifyErrorStatus`)
4. Measure provider latency to infer geographic deployment

The response includes detailed error classifications (`auth`, `rate_limit`, `billing`, `timeout`, `model_not_supported`), giving attackers precise feedback about the provider landscape.

**Needs validation in Chunk 10 (Dynamic Verification):** Confirm what specific information is returned for valid vs. invalid provider/model combinations.

### S4.3: Session Key Enumeration via Timing Attack

In `/api/test-session`, the gateway may respond differently (timing or content) for valid vs. invalid session keys. An attacker could systematically try session key patterns (`agent:main:telegram:direct:<chatId>`) to enumerate which users have active sessions. The 100-second timeout provides a large window for timing analysis.

**Needs validation in Chunk 10 (Dynamic Verification):** Measure response time differences between valid and invalid session keys.

---

## 6. Exploit Chain Summary

### Chain 1: Zero-Click Messaging Abuse

```
1. Attacker embeds <img src="http://target:3000/api/test-platforms"> in a web page
2. Operator views the page → browser fires GET request
3. Dashboard sends real DMs to all configured platform users
4. Users receive "[Platform Test]" messages from the legitimate bot
5. Attacker repeats with loop → user harassment + rate limit lockout
```

### Chain 2: Credit Exhaustion

```
1. Attacker scripts: while true; do curl http://target:3000/api/test-bound-models; done
2. Each request probes all configured LLM models simultaneously
3. Each probe makes a real LLM API call using production API keys
4. API credits depleted → bot stops functioning on all platforms
5. Attacker also hits /api/test-sessions for additional credit burn via gateway completions
```

### Chain 3: Full Reconnaissance + Disable + Abuse (Cross-Chunk)

```
1. GET /api/config → obtain gateway token (F2.1)
2. GET /api/test-platforms → enumerate all platforms, user IDs, bot names (F4.1, F4.7)
3. POST /api/alerts {"enabled": false} → disable alerting (F3.3)
4. POST /api/config/agent-model → change model (F3.1)
5. Loop: GET /api/test-platforms → flood users, lock out bot via rate limits (F4.4)
6. Result: bot is using attacker-chosen model, alerting is off, users are being spammed
```

---

## 7. Positive Security Observations

| Pattern | Where | Assessment |
|---------|-------|------------|
| `execFileSync` instead of `exec` for CLI calls | `test-platforms/route.ts`, line 41 | **Correct.** No shell invocation; arguments passed as array. Prevents shell injection. |
| `execFile` in `model-probe.ts` on Linux | `lib/model-probe.ts`, line 71 | **Correct.** Same safe pattern on Linux. |
| `AbortSignal.timeout` on all fetch calls | Multiple files | **Good.** Prevents indefinite hangs on external HTTP requests. |
| `AbortController` with explicit timeout on gateway web UI probe | `test-platforms/route.ts`, lines 49-51 | **Good.** Clean timeout handling with proper cleanup. |
| Model probe response does not leak API keys | `test-model/route.ts`, lines 16-26 | **Good.** Only returns `ok`, `elapsed`, `model`, `mode`, `status`, `error`, `text`, `precision`, `source`. API keys are used server-side but not included in responses. |
| Sequential execution of CLI-backed platform tests | `test-platforms/route.ts`, lines 1115, 1215-1217 | **Partial.** Sequential execution prevents local send-path contention, but does not limit overall request rate. |
| Input validation on `test-model` | `test-model/route.ts`, lines 9-13 | **Partial.** Checks for presence of `provider` and `modelId` but does not validate format or restrict to known values. |
| Feishu account deduplication | `test-platforms/route.ts`, lines 1117, 1128-1129 | **Good.** `testedFeishuAccounts` set prevents duplicate testing of the same Feishu account, reducing redundant API calls. |

---

## 8. Open Questions

| # | Question |
|---|----------|
| Q1 | Is there any legitimate use case for the GET aliases on side-effect endpoints, or are they purely a convenience shortcut that should be removed? |
| Q2 | What is the expected frequency of platform test invocations? If rare (manual operator action), even basic rate limiting (e.g., 1 per minute) would neutralize abuse. |
| Q3 | Could the `[Platform Test]` message content be modified by an attacker through any indirect means (e.g., config manipulation or i18n overrides)? |
| Q4 | Does the OpenClaw gateway's `v1/chat/completions` endpoint have its own rate limiting or session validation beyond the auth token? |
| Q5 | Are there any external webhook callbacks (e.g., Feishu event subscriptions) that could be triggered as a secondary effect of the test messages? |
| Q6 | Should model probing use a cheaper operation (e.g., list models API) instead of sending actual completion requests? |

---

## 9. Remediation Priorities from This Chunk

1. **Add application-level authentication middleware** (blocks all findings in this chunk and all prior chunks). Single most impactful fix -- cross-referenced with Chunks 1-3.

2. **Remove GET aliases from all side-effect endpoints.** Delete `export async function GET() { return POST(); }` from `test-platforms`, `test-sessions`, `test-dm-sessions`, and `test-bound-models`. This eliminates zero-click passive triggering vectors (F4.2).

3. **Add rate limiting to all test endpoints.** Even a simple per-IP or global rate limit (e.g., 1 request per 30 seconds per endpoint) would prevent credit exhaustion and messaging abuse. The platform test endpoint is especially sensitive since it exercises all credentials simultaneously.

4. **Validate and restrict `provider`/`modelId` in `/api/test-model`.** Only allow probing of models that are actually configured in the deployment, preventing enumeration of arbitrary providers.

5. **Sanitize session key and agent ID in `/api/test-session`.** Validate that `agentId` matches a known agent and that `sessionKey` follows the expected format before forwarding to the gateway.

6. **Strip user identifiers from test-platforms responses.** Replace specific user IDs in `detail` strings with anonymized placeholders (e.g., `"Telegram → DM sent (500ms)"` instead of `"Telegram → DM sent to 123456789 (500ms)"`).

7. **Replace `new Function` dynamic import with standard `import()`.** The `new Function("modulePath", "return import(modulePath)")` pattern is unnecessary; standard dynamic `import()` with the same `pathToFileURL` approach works identically and is analyzable by security tools.

8. **Reduce session test timeouts.** 100 seconds per gateway request is excessive for a health check. A 15-30 second timeout would be sufficient and reduce connection exhaustion risk.

9. **Consider using model list APIs instead of completion requests for probing.** Most LLM providers expose `/models` or equivalent endpoints that confirm accessibility without consuming credits.

10. **Add audit logging.** Log caller IP, timestamp, endpoint, and outcome for all test endpoint invocations. This is essential for detecting abuse in the absence of authentication.
