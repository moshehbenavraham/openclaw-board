# Chunk 7 Findings: Alerting and Internal Monitoring Flows

Date: 2026-03-30
Auditor: Cursor (automated)
Status: **Complete**

---

## 1. Files Reviewed

| File | Purpose |
|------|---------|
| `app/api/alerts/check/route.ts` | POST -- runs alert checks (model availability, bot response, cron failure) and sends outbound notifications via Feishu API and OpenClaw gateway |
| `app/alert-monitor.tsx` | Client-side component embedded in root layout; auto-polls alert config and triggers alert checks on an interval |
| `app/gateway-status.tsx` | Client-side component that polls `/api/gateway-health` every 10s and renders a clickable gateway link with auth token |

Supporting files also examined (reviewed in prior chunks, cross-referenced here):

| File | Relevance |
|------|-----------|
| `app/api/alerts/route.ts` | Alert config read/write surface (Chunk 3, F3.3) |
| `app/api/gateway-health/route.ts` | Returns tokenized gateway URL consumed by `GatewayStatus` (Chunk 2, F2.2) |
| `app/alerts/page.tsx` | Full alert management UI -- fetches config, triggers checks, modifies settings |
| `app/layout.tsx` | Root layout; embeds `<AlertMonitor />` globally |
| `lib/gateway-url.ts` | Gateway URL construction helper |

---

## 2. Threat Model Summary for This Surface

The alerting and monitoring flows create three interacting attack surfaces:

1. **Automated outbound messaging amplification.** `/api/alerts/check` sends real messages via the Feishu/Lark API (using real `appId`/`appSecret` from config) and the OpenClaw gateway (using the gateway auth token). Any client can trigger this chain: enable alerting via `POST /api/alerts`, then fire checks via `POST /api/alerts/check`.

2. **Self-referential SSRF via model checking.** `checkModelAlerts()` calls `http://localhost:3000/api/test-model` for every configured model. One unauthenticated POST to `/api/alerts/check` fans out into N internal requests, each exercising real LLM provider API credentials. This creates a credit-consumption amplifier.

3. **Client-side monitoring as a persistent trigger.** `AlertMonitor` is embedded in the root layout and runs on every page load. `GatewayStatus` polls `/api/gateway-health` every 10 seconds. Both propagate sensitive server data (alert config, tokenized gateway URLs) into the browser.

The critical escalation chain across chunks: an attacker can (1) enable alerting with low thresholds via `POST /api/alerts` (F3.3), then (2) every legitimate user page load auto-triggers `POST /api/alerts/check` via `AlertMonitor`, which (3) fans out into model probing (consuming API credits), Feishu messaging (spamming real users), and gateway session injection (injecting content into bot conversations).

---

## 3. Trust Boundaries and Attacker-Controlled Inputs

| Input | Where Set | How Used in Chunk 7 | Risk |
|-------|-----------|---------------------|------|
| `config.enabled` | `/api/alerts` POST/PUT (no auth) | Gates whether `AlertMonitor` and `/api/alerts/check` run checks | Attacker can enable all checks |
| `config.receiveAgent` | `/api/alerts` POST/PUT (no auth) | Passed to `sendAlertViaFeishu()` and `sendAlert()` to select notification target | Attacker controls which agent receives alerts and which Feishu account is used |
| `config.rules[].enabled` | `/api/alerts` POST/PUT (no auth) | Enables/disables each check type | Attacker can enable all rules simultaneously |
| `config.rules[].threshold` | `/api/alerts` POST/PUT (no auth) | Sets sensitivity for bot_no_response and cron checks | Set to 0 or 1 to guarantee alert firing |
| `config.checkInterval` | `/api/alerts` POST/PUT (no auth) | Controls `AlertMonitor` polling frequency (minutes) | Set to 1 for maximum-frequency polling |
| `openclaw.json` providers | Read from disk by `checkModelAlerts()` | Determines which models are probed; provider credentials used in internal `/api/test-model` calls | Not directly attacker-controlled but attacker triggers the consumption |
| `openclaw.json` feishu config | Read from disk by `sendAlertViaFeishu()` | `appId`, `appSecret` used to obtain Feishu API tokens; `accounts` and `bindings` select which account | Exercised whenever alert notifications fire |
| `openclaw.json` gateway token | Read from disk by `sendAlert()` and `/api/gateway-health` | Used in `Authorization: Bearer` header for gateway calls; returned in `webUrl` | Token propagated into browser via `GatewayStatus` component |

---

## 4. Confirmed Findings

### F7.1: Self-SSRF via Internal Model Probing in Alert Check (High)

**Severity: High**
**File:** `app/api/alerts/check/route.ts`, lines 289-315

`checkModelAlerts()` calls `http://localhost:3000/api/test-model` for every configured model:

```javascript
const testResp = await fetch("http://localhost:3000/api/test-model", {
  method: "POST",
  headers: {"Content-Type": "application/json"},
  body: JSON.stringify({provider, modelId: id}),
  signal: AbortSignal.timeout(10000),
});
```

This creates a self-referential SSRF: one unauthenticated POST to `/api/alerts/check` fans out into N internal POST requests to `/api/test-model`. Each of those exercises real LLM provider API credentials (documented in Chunk 4 findings).

**Exploit chain:**

```
1. POST /api/alerts  {"enabled": true, "rules": [{"id": "model_unavailable", "enabled": true}]}
2. POST /api/alerts/check
   → internally calls POST /api/test-model for each configured model
   → each call sends a real prompt to the provider API using stored credentials
   → API credits consumed per model per check invocation
```

With `AlertMonitor` running in the root layout, an attacker only needs step 1; every subsequent page load by any user triggers step 2 automatically.

**Impact:**
- One-to-many amplification: 1 request → N provider API calls
- API credit exhaustion without direct access to provider credentials
- Compounds with F4.x (Chunk 4): test-model exercises all configured providers
- Hardcoded localhost:3000 URL breaks if the app runs on a different port

### F7.2: Unauthenticated Outbound Feishu Messaging via Alert Notifications (High)

**Severity: High**
**File:** `app/api/alerts/check/route.ts`, lines 128-228

`sendAlertViaFeishu()` reads `appId` and `appSecret` from `openclaw.json`, obtains a `tenant_access_token` from the Feishu/Lark API, and sends a real DM to a real user:

```javascript
const tokenResp = await fetch(`${baseUrl}/open-apis/auth/v3/tenant_access_token/internal`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ app_id: accountInfo.appId, app_secret: accountInfo.appSecret }),
  signal: AbortSignal.timeout(10000),
});
```

No authentication is required to trigger this chain. The notification path is:

```
POST /api/alerts/check
  → checkModelAlerts() / checkBotResponseAlerts() / checkCronAlerts()
  → sendAlertViaFeishu(receiveAgent, message)
  → obtains tenant_access_token from Feishu API
  → sends DM to user via Feishu messaging API
```

**Impact:**
- Notification spam to real users on Feishu/Lark
- Feishu API rate limiting or account suspension from abuse
- Real platform credentials (`appId`/`appSecret`) exercised by unauthenticated callers
- The 60-second deduplication window (line 305) per rule+target is the only throttle; an attacker can vary the attack across different rule IDs to bypass it

### F7.3: Gateway Auth Token Used in Fire-and-Forget Alert Delivery (High)

**Severity: High**
**File:** `app/api/alerts/check/route.ts`, lines 231-265

`sendAlert()` reads the gateway auth token and sends messages to the gateway's chat completions endpoint:

```javascript
const gatewayToken = openclawConfig.gateway?.auth?.token || "";
fetch(`http://127.0.0.1:${gatewayPort}/v1/chat/completions`, {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${gatewayToken}`,
    "x-openclaw-agent-id": agentId,
  },
  body: JSON.stringify({
    session: sessionKey,
    messages: [{ role: "user", content: `🔔 Alert Notification: ${message}` }],
  }),
});
```

Issues:

1. **Attacker-controlled session injection:** `sessionKey` is `agent:${agentId}:main`, where `agentId` comes from `config.receiveAgent` -- writable without auth (F3.3). An attacker can set `receiveAgent` to any agent ID and inject alert-formatted messages into that agent's main session.

2. **Fire-and-forget with false success:** The function returns `{ sent: true }` (line 262) before the `fetch` completes. The caller (`saveAlertConfig`) persists the "success" state regardless of whether the message was actually delivered.

3. **Gateway token exercised server-side:** While the token is not returned in the response, it is used in an outbound request that an attacker controls the trigger for.

### F7.4: Unbounded Filesystem Scan in Bot Response Monitoring (Medium)

**Severity: Medium**
**File:** `app/api/alerts/check/route.ts`, lines 321-381

`checkBotResponseAlerts()` reads every JSONL session file for every agent:

```javascript
for (const agentId of agentIds) {
  files = fs.readdirSync(sessionsDir).filter(f => f.endsWith(".jsonl"));
  for (const file of files) {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.trim().split("\n");
    for (const line of lines) {
      const entry = JSON.parse(line);
      // check timestamp...
    }
  }
}
```

**Issues:**
- Reads entire JSONL files into memory (no streaming, no file-size limit)
- Parses every line of every file looking for the most recent timestamp
- Synchronous `readFileSync` blocks the Node.js event loop during scan
- No cap on number of agents, files per agent, or lines per file
- A session directory with hundreds of multi-megabyte JSONL files will cause slow responses or OOM

Cross-references Chunk 6 findings (F6.x: unbounded filesystem scans, synchronous I/O blocking).

### F7.5: Random-Based Cron Alert Logic Sends Real Notifications on Coin Flip (Medium)

**Severity: Medium**
**File:** `app/api/alerts/check/route.ts`, lines 384-413

`checkCronAlerts()` uses `Math.random()` to simulate cron failures:

```javascript
const mockCronFailures = Math.floor(Math.random() * 5);
if (mockCronFailures >= (rule.threshold || 3)) {
  await sendAlertViaFeishu(config.receiveAgent, `Cron failed ${mockCronFailures} times...`);
}
```

With the default threshold of 3, there is a 40% probability (values 3 or 4 out of 0-4) that each check invocation triggers a real Feishu notification. This "placeholder" code:
- Sends real messages to real users based on random chance
- Cannot provide meaningful cron monitoring
- Creates unpredictable notification noise leading to alert fatigue
- The 5-minute deduplication window (line 405) only partially mitigates the spam

### F7.6: AlertMonitor Runs Globally Without Authentication Context (Medium)

**Severity: Medium**
**File:** `app/alert-monitor.tsx` (full file), `app/layout.tsx` line 23

`AlertMonitor` is embedded in the root layout and executes on every page load for every visitor:

```javascript
// layout.tsx
<AlertMonitor />
```

On mount, the component:
1. Fetches `GET /api/alerts` -- exposes the full alert config (rules, thresholds, receiveAgent, lastAlerts timestamps) to any browser client
2. If alerting is enabled, immediately calls `POST /api/alerts/check` -- triggers the full check pipeline (model probing, filesystem scanning, outbound notifications)
3. Sets up a recurring `setInterval` at the configured interval

Since there is no authentication, any network client loading any page triggers the full alert pipeline. Each open browser tab runs its own independent timer, so multiple tabs multiply the polling frequency.

**Amplification factor:** If a user has T tabs open with a configured interval of I minutes, the effective polling rate is T/I checks per minute, each potentially triggering N model probes and outbound notifications.

### F7.7: Gateway Status Renders Tokenized URL as Clickable Link in DOM (Medium)

**Severity: Medium**
**File:** `app/gateway-status.tsx`, lines 54-58

`GatewayStatus` renders the gateway web URL (which includes the auth token as a query parameter) as an `<a>` tag:

```javascript
<a
  href={health?.ok && health.webUrl ? resolveGatewayUrl(health.webUrl) : undefined}
  target="_blank"
  rel="noopener noreferrer"
```

The `webUrl` from `/api/gateway-health` is `http://localhost:PORT/chat?token=TOKEN`. The `resolveGatewayUrl()` function replaces `localhost` with the browser's current hostname, making the tokenized URL network-accessible.

**Exposure vectors:**
- Token visible in DOM `href` attribute via DevTools, browser extensions, accessibility tools
- Browser history records the tokenized URL if clicked
- Referrer headers may leak the URL to external resources on the gateway page
- Screen sharing or screenshots expose the token if the link is hovered/inspected
- `GatewayStatus` is rendered on the main page (imported in `app/page.tsx`), so the token enters the DOM on the default route

Cross-references Chunk 2, F2.2 (gateway-health endpoint leaks tokenized URL).

### F7.8: Alert Config GET Exposes Monitoring Metadata for Reconnaissance (Low)

**Severity: Low**
**File:** `app/api/alerts/route.ts`, lines 63-70

`GET /api/alerts` returns the entire `AlertConfig` object including internal state:

```javascript
export async function GET() {
  const config = getAlertConfig();
  return NextResponse.json(config);
}
```

Exposed fields useful for reconnaissance:
- `enabled` / `rules[].enabled` -- which monitoring is active (helps plan suppression)
- `rules[].threshold` -- exact detection thresholds (helps calibrate attacks below detection)
- `lastAlerts` timestamps -- when alerts last fired (reveals monitoring activity patterns)
- `receiveAgent` -- which agent receives notifications (identifies the target to redirect)
- `checkInterval` -- polling frequency (helps time attacks between checks)

### F7.9: Feishu Credentials Logged to Console During Alert Delivery (Low)

**Severity: Low**
**File:** `app/api/alerts/check/route.ts`, lines 129, 136, 145, 149

Multiple `console.log` calls output sensitive identifiers during alert delivery:

```javascript
console.log(`[ALERT] sendAlertViaFeishu called with agentId: ${agentId}, message: ${message}`);
console.log(`[ALERT] Feishu accounts found:`, Object.keys(feishuAccounts));
console.log(`[ALERT] Using account: ${accountInfo.accountId}, appId: ${accountInfo.appId}`);
console.log(`[ALERT] Feishu DM user found: ${testUserId}`);
```

These log the Feishu `appId`, account IDs, and user IDs to server-side output. If logs are accessible (via `/tmp/openclaw/`, `journalctl`, or a log aggregation endpoint), this creates a secondary credential/identity exposure path.

---

## 5. Suspected Findings (Require Dynamic Validation)

### S7.1: Alert Check as Credential Oracle via Feishu Token Acquisition Timing

`sendAlertViaFeishu` acquires a `tenant_access_token` from the Feishu API. The response timing and status codes could serve as a side channel to verify whether specific Feishu credentials are valid. An attacker who modifies `receiveAgent` to point to different agents can enumerate which agents have valid Feishu accounts by observing whether the alert check returns quickly (no account found) vs. slowly (external API call made).

**Needs validation in Chunk 10 (Dynamic Verification).**

### S7.2: Multi-Tab AlertMonitor Amplification Creates Uncontrolled Background Load

When alerting is enabled, each browser tab/window runs an independent `AlertMonitor` instance with its own `setInterval`. Five open tabs with a 5-minute interval produce 5× the expected check rate. Combined with F7.1 (self-SSRF model probing), this could create significant background API credit consumption that scales with the number of open tabs.

**Needs validation in Chunk 10 (Dynamic Verification).**

### S7.3: Concurrent Alert Check Writes Create Config File Race

Both `checkModelAlerts` and `checkBotResponseAlerts` update `config.lastAlerts` in memory, and the POST handler writes the combined config to disk at the end (line 440). If two concurrent `/api/alerts/check` requests execute simultaneously, both read the same initial config, both update `lastAlerts` independently, and the second write overwrites the first's timestamps. This could cause duplicate notifications by resetting the deduplication timestamps.

**Needs validation in Chunk 10 (Dynamic Verification).**

---

## 6. Exploit Chain Summary

### Chain 1: Silent Credit Exhaustion via AlertMonitor

```
1. Attacker sends POST /api/alerts
   {"enabled": true, "checkInterval": 1,
    "rules": [{"id": "model_unavailable", "enabled": true}]}
   → Enables alerting with 1-minute interval and model checking

2. Legitimate user opens any dashboard page
   → AlertMonitor mounts, immediately calls POST /api/alerts/check
   → checkModelAlerts() calls POST /api/test-model for each of N models
   → Each call exercises real LLM provider API credentials

3. Every 1 minute, AlertMonitor repeats step 2
   → Sustained API credit drain: N models × 1 call/minute × T open tabs

4. Attacker also sent POST /api/alerts {"rules": [{"id": "bot_no_response", "enabled": false}]}
   → Disables the rule that might detect the bot being slow due to credit exhaustion
```

### Chain 2: Notification Flooding + Session Injection

```
1. Attacker sends POST /api/alerts
   {"enabled": true, "receiveAgent": "main",
    "rules": [{"id": "model_unavailable", "enabled": true},
              {"id": "cron_continuous_failure", "enabled": true, "threshold": 1}]}

2. POST /api/alerts/check
   → checkCronAlerts() has 80% chance of triggering (threshold 1, random 0-4)
   → sendAlertViaFeishu("main", "Cron failed...") → real Feishu DM sent
   → sendAlert("main", "Cron failed...") → message injected into agent:main:main session

3. checkModelAlerts() calls /api/test-model for each model
   → Any unavailable model triggers another Feishu DM + gateway session injection

4. Result: real users receive notification spam; bot sessions polluted with
   injected alert messages that may confuse the AI assistant
```

### Chain 3: Full Kill Chain (Cross-Chunk)

```
1. GET /api/config → obtain gateway token and agent list (F2.1)
2. GET /api/alerts → read current alert config for reconnaissance (F7.8)
3. POST /api/alerts → disable all alerting (F3.3)
4. PATCH /api/config/agent-model → change model to weaker one (F3.1)
5. POST /api/alerts → re-enable alerting with receiveAgent="nonexistent"
   → Future alerts go nowhere; monitoring is effectively dead
6. POST /api/alerts/check → trigger model probes to consume API credits (F7.1)
7. Meanwhile, AlertMonitor on any open tab sustains the credit drain

Total: 6 unauthenticated HTTP requests + passive amplification from AlertMonitor
```

---

## 7. Positive Security Observations

| Pattern | Where | Assessment |
|---------|-------|------------|
| AbortSignal.timeout on outbound Feishu calls | `check/route.ts`, lines 165, 187, 200 | **Good.** 10-second timeout prevents indefinite hangs on external API calls. |
| Deduplication window for alert notifications | `check/route.ts`, lines 304-309, 371-375, 404-408 | **Partial.** 60-second (model/bot) and 300-second (cron) windows prevent some notification spam, but are per-rule-per-target, not global. |
| AlertMonitor renders nothing | `alert-monitor.tsx`, line 43 | **Good.** The monitoring component does not render any DOM that could leak alert state visually. |
| Feishu user ID regex validation | `check/route.ts`, line 113 | **Partial.** `ou_[a-f0-9]+` pattern validates the Feishu open_id format, but the regex is applied to session keys, not to attacker input. |
| Gateway status with resolveGatewayUrl | `gateway-status.tsx`, lines 6-13 | **Neutral.** Correctly replaces `localhost` with browser hostname for LAN access, but this also makes the tokenized URL network-reachable. |

---

## 8. Open Questions

| # | Question |
|---|----------|
| Q1 | Is `sendAlert()` (gateway-based notification) actually used in production, or is `sendAlertViaFeishu()` the primary notification path? The codebase has both but they serve different purposes. |
| Q2 | Is the `Math.random()` cron check (line 399) intentionally deployed, or is it leftover development code? It triggers real notifications. |
| Q3 | Does the Feishu API enforce per-app rate limits that would naturally bound the notification spam from F7.2, or can an attacker exhaust the daily message quota? |
| Q4 | Should `AlertMonitor` require the user to be on the `/alerts` page, or is global background monitoring the intended behavior? Global monitoring means every page load triggers the check pipeline. |
| Q5 | Is there a reason `checkModelAlerts` calls the dashboard's own `/api/test-model` endpoint rather than probing providers directly? The self-SSRF pattern adds an extra unauthenticated request to the chain. |

---

## 9. Remediation Priorities from This Chunk

1. **Add authentication to `/api/alerts/check` POST** (blocks F7.1, F7.2, F7.3). This is the single highest-impact fix for this surface. Without auth, any network caller can trigger outbound messaging and API credit consumption.

2. **Remove or gate the self-SSRF in `checkModelAlerts`** (F7.1). Either probe providers directly from the alert check code (avoiding the localhost fetch) or add a shared secret/internal-only header to `/api/test-model` that the alert checker provides.

3. **Remove the `Math.random()` cron placeholder** (F7.5). Replace with real cron failure accounting or disable the rule entirely. The current code sends real notifications randomly.

4. **Strip the auth token from `webUrl` before returning it to the client** (F7.7). `GatewayStatus` should receive a URL without the token, or the component should not render the URL as a clickable link.

5. **Add rate limiting or a global circuit breaker to `/api/alerts/check`** (F7.4, F7.6). Prevent repeated invocations from multiplying filesystem scans and outbound calls. A simple "last check was < 60s ago, skip" guard would reduce amplification.

6. **Bound the filesystem scan in `checkBotResponseAlerts`** (F7.4). Read only the last N lines of each JSONL file (tail read) rather than loading entire files. Cap the number of files scanned per agent.

7. **Remove `console.log` calls that output Feishu credentials** (F7.9). Replace with structured logging at debug level that redacts `appId` and user IDs.

8. **Strip `lastAlerts` from the `GET /api/alerts` response** (F7.8). Internal deduplication state should not be exposed to clients.

9. **Deduplicate `AlertMonitor` across tabs** (S7.2). Use `BroadcastChannel` or `localStorage` coordination to ensure only one tab runs the alert check timer.
