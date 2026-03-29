# Chunk 3 Findings: Mutating Endpoints and CSRF/Unauthenticated Writes

Date: 2026-03-29
Auditor: Cursor (automated)
Status: **Complete**

---

## 1. Files Reviewed

| File | Purpose |
|------|---------|
| `app/api/config/agent-model/route.ts` | PATCH -- changes the AI model assigned to an agent via gateway `config.patch` and clears session model state on disk |
| `app/api/alerts/route.ts` | GET/POST/PUT -- reads and writes `~/.openclaw/alerts.json` alert configuration |
| `app/api/alerts/check/route.ts` | POST -- runs alert checks and sends outbound Feishu/gateway notifications (cross-ref with Chunk 7) |
| `app/api/pixel-office/layout/route.ts` | GET/POST -- reads and writes `~/.openclaw/pixel-office/layout.json` |
| `lib/config-cache.ts` | In-memory config cache with get/set/clear |
| `lib/openclaw-cli.ts` | Subprocess bridge to `openclaw` CLI binary; used by agent-model route for gateway calls |
| `lib/openclaw-paths.ts` | Path constants (`OPENCLAW_HOME`, `OPENCLAW_AGENTS_DIR`, `OPENCLAW_PIXEL_OFFICE_DIR`) |

---

## 2. Threat Model Summary for This Surface

These endpoints form the **write surface** of the dashboard. They allow callers to:

1. **Change which AI model an agent uses** (`/api/config/agent-model` PATCH) -- this modifies the live gateway configuration and clears session state on disk.
2. **Modify alert system configuration** (`/api/alerts` POST/PUT) -- this controls whether alerts fire, who receives them, and at what thresholds.
3. **Overwrite pixel office layout** (`/api/pixel-office/layout` POST) -- this writes arbitrary JSON to disk.

Since none of these endpoints have authentication (confirmed in Chunk 1, F1.3), any network client can invoke any of these mutations. There is no CSRF protection, no rate limiting, and no audit logging.

The critical escalation chain: an attacker who can reach these endpoints can (a) change the bot's AI model to one they control or to a weaker model, (b) disable all alerting to suppress detection, and (c) redirect alert notifications to a different agent.

---

## 3. Trust Boundaries and Attacker-Controlled Inputs

| Input | Endpoint | How Used | Risk |
|-------|----------|----------|------|
| `body.agentId` (string) | `/api/config/agent-model` PATCH | Looked up in gateway agent list; used in filesystem path construction | Validated against gateway config, but used in `path.join()` for session clearing |
| `body.model` (string) | `/api/config/agent-model` PATCH | Validated against known models; sent to gateway `config.patch` | Constrained to known models -- safe |
| `body.enabled` (any) | `/api/alerts` POST/PUT | Set directly on config object, written to disk | No type validation |
| `body.receiveAgent` (any) | `/api/alerts` POST/PUT | Set directly on config object; controls who receives alert notifications | No validation against actual agent IDs |
| `body.checkInterval` (any) | `/api/alerts` POST/PUT | Set directly on config object; controls alert polling frequency | No range validation |
| `body.rules` (array) | `/api/alerts` POST/PUT | Matched by ID, properties merged into existing rules | No schema validation on rule properties |
| `body.layout` (object) | `/api/pixel-office/layout` POST | Checked for `version === 1` and `Array.isArray(tiles)`, then written to disk | No size limit, no tile content validation |

---

## 4. Confirmed Findings

### F3.1: Unauthenticated Agent Model Change via Gateway Config Patch (Critical)

**Severity: Critical**
**File:** `app/api/config/agent-model/route.ts`, lines 174-242

The PATCH handler accepts `agentId` and `model` from the request body and applies a permanent configuration change to the OpenClaw gateway:

```javascript
await callOpenclawGateway(
  "config.patch",
  {
    raw: JSON.stringify(patch),
    baseHash,
    note: `Dashboard updated ${agentId} model to ${model}`,
  },
  GATEWAY_CALL_TIMEOUT_MS,
);
```

No authentication is required. Any network caller can change which AI model any agent uses. This is a **permanent runtime configuration change** that persists across gateway restarts (the gateway writes the patched config to `openclaw.json`).

**Impact:**
- An attacker can switch the bot to a cheaper/weaker model, degrading service quality
- An attacker can switch to a model with different safety characteristics
- Model changes are written to disk and survive restarts
- The endpoint also clears session model state (`clearAgentSessionModelState`), disrupting active sessions

**Exploit:**
```bash
curl -X PATCH http://<target>:3000/api/config/agent-model \
  -H 'Content-Type: application/json' \
  -d '{"agentId":"main","model":"anthropic/claude-haiku-3"}'
```

### F3.2: Unauthenticated Session State File Modification (High)

**Severity: High**
**File:** `app/api/config/agent-model/route.ts`, lines 148-172

After patching the gateway config, `clearAgentSessionModelState` reads `sessions.json`, strips model override fields from every session entry, and writes the modified file back to disk:

```javascript
function clearAgentSessionModelState(agentId: string): void {
  const sessionsPath = path.join(OPENCLAW_AGENTS_DIR, agentId, "sessions", "sessions.json");
  // ... reads, modifies, writes ...
  const tmpPath = `${sessionsPath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(sessions, null, 2), "utf8");
  fs.renameSync(tmpPath, sessionsPath);
}
```

While `agentId` is validated against the gateway's agent list (via `findAgentConfigEntry`), the function modifies live session state files. An attacker changing the model also forces all sessions for that agent to drop their model overrides, fallback notices, and Claude CLI session IDs -- effectively resetting session continuity.

### F3.3: Unauthenticated Alert Configuration Modification (High)

**Severity: High**
**File:** `app/api/alerts/route.ts`, lines 72-131

Both POST and PUT handlers allow any network caller to modify the alert configuration:

```javascript
if (body.enabled !== undefined) config.enabled = body.enabled;
if (body.receiveAgent) config.receiveAgent = body.receiveAgent;
if (body.checkInterval !== undefined) config.checkInterval = body.checkInterval;
```

**Impact:**
- **Disable all alerting:** `{"enabled": false}` -- suppresses all monitoring notifications
- **Redirect alerts:** `{"receiveAgent": "attacker-agent"}` -- sends alerts to a different agent
- **Suppress specific rules:** `{"rules": [{"id": "model_unavailable", "enabled": false}]}` -- selectively disables detection
- **Alter thresholds:** `{"rules": [{"id": "cron_continuous_failure", "threshold": 999999}]}` -- makes thresholds effectively unreachable

This is especially dangerous when chained with F3.1: an attacker can change the model, then immediately disable alerting to prevent detection.

**Exploit:**
```bash
# Disable all alerts
curl -X POST http://<target>:3000/api/alerts \
  -H 'Content-Type: application/json' \
  -d '{"enabled": false}'

# Or redirect alerts to suppress detection
curl -X POST http://<target>:3000/api/alerts \
  -H 'Content-Type: application/json' \
  -d '{"receiveAgent": "nonexistent-agent"}'
```

### F3.4: No Input Validation on Alert Configuration Fields (Medium)

**Severity: Medium**
**File:** `app/api/alerts/route.ts`, lines 77-93

No type checking or range validation is performed on any alert config field:

- `enabled` accepts any type (string, object, array) -- only `boolean` is meaningful
- `receiveAgent` accepts any string -- not validated against actual agent IDs
- `checkInterval` accepts any value including `0`, negative numbers, or `NaN` -- could cause tight polling loops or division errors
- Rule `threshold` accepts any value -- negative or zero thresholds could cause immediate triggering or logic errors
- Rule `targetAgents` accepts any value -- not validated as an array of valid agent IDs

**Impact:** Malformed config values could cause the alert check system (`/api/alerts/check`) to behave unpredictably, crash, or enter tight loops.

### F3.5: Alert Config Write Is Not Atomic (Medium)

**Severity: Medium**
**File:** `app/api/alerts/route.ts`, lines 55-61

```javascript
function saveAlertConfig(config: AlertConfig): void {
  const dir = path.dirname(ALERTS_CONFIG_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(ALERTS_CONFIG_PATH, JSON.stringify(config, null, 2));
}
```

Unlike the pixel-office layout handler (which uses temp-file + rename), `saveAlertConfig` writes directly to `alerts.json`. If the process crashes or is killed mid-write, the file will be truncated or corrupted. The `getAlertConfig` function catches parse errors and falls back to defaults, so a corrupted file would silently reset all alert configuration.

Compare to the pixel-office handler's correct pattern:
```javascript
const tmpFile = LAYOUT_FILE + '.tmp';
fs.writeFileSync(tmpFile, JSON.stringify(layout, null, 2), 'utf-8');
fs.renameSync(tmpFile, LAYOUT_FILE);
```

### F3.6: Unauthenticated Pixel Office Layout Write (Medium)

**Severity: Medium**
**File:** `app/api/pixel-office/layout/route.ts`, lines 22-43

Any network caller can POST a layout to overwrite `~/.openclaw/pixel-office/layout.json`:

```javascript
const { layout } = await request.json();
if (!layout || layout.version !== 1 || !Array.isArray(layout.tiles)) {
  return NextResponse.json({ error: 'Invalid layout' }, { status: 400 });
}
```

**Validation gaps:**
- No payload size limit -- an attacker can write arbitrarily large JSON (gigabytes) to disk
- No tile count limit -- thousands of tiles are accepted
- No tile content validation -- arbitrary nested objects in each tile
- No validation that tile properties conform to any schema

**Impact:** While the pixel office is cosmetic and lower-severity than config changes, this endpoint enables:
- **Disk exhaustion:** Repeated POSTs with very large payloads
- **UI disruption:** Malformed layouts that break the pixel office page
- **Arbitrary JSON on disk:** The content is not sanitized

**Positive note:** Uses atomic write (temp + rename), which is correct for durability.

### F3.7: No CSRF Protection on Any Mutating Endpoint (High)

**Severity: High**
**Files:** All three mutating route files

None of the mutating endpoints check `Origin`, `Referer`, or CSRF tokens. Combined with the lack of authentication (F1.3), this means:

- **PATCH /api/config/agent-model:** PATCH requests require `Content-Type: application/json`, which makes them non-simple CORS requests. Browsers will send a preflight OPTIONS request, and since Next.js does not set `Access-Control-Allow-Origin`, the browser will block the response. However, the server still processes the request and applies the mutation -- CORS only protects the response, not the side effect. An attacker page can trigger the model change even though it cannot read the response.
- **POST /api/alerts:** POST with `Content-Type: application/json` has the same CORS behavior -- the mutation executes even if the response is blocked.
- **POST /api/pixel-office/layout:** Same pattern.

This is a classic CSRF-via-CORS-preflight bypass: the mutation happens server-side regardless of whether the browser allows the response through.

### F3.8: Duplicate POST/PUT Alert Handlers (Low)

**Severity: Low (code quality)**
**File:** `app/api/alerts/route.ts`, lines 72-131

The POST and PUT handlers are byte-for-byte identical. This creates a maintenance risk: a fix applied to one handler may not be applied to the other. It also doubles the attack surface for the same vulnerability.

### F3.9: Config Cache Returns Mutable Reference (Low)

**Severity: Low**
**File:** `lib/config-cache.ts`, lines 8-10

```javascript
export function getConfigCache(): ConfigCacheEntry | null {
  return configCache;
}
```

`getConfigCache` returns the same object reference stored in the module-level variable. Any code that mutates the returned `data` property also mutates the cached copy. If a future security fix strips secrets from the response before returning it to the client, that stripping would also remove secrets from the cached copy, breaking other routes that need the full data.

This is a defense-in-depth concern: future remediation (e.g., stripping `gateway.token` from responses) must account for the shared-reference cache.

---

## 5. Suspected Findings (Require Dynamic Validation)

### S3.1: Alert Config Changes Chain into Outbound Messaging

The `/api/alerts` POST/PUT endpoints control the `receiveAgent` and rule enablement that `/api/alerts/check` uses to decide whether and where to send outbound notifications. An attacker could:

1. POST to `/api/alerts` to enable `model_unavailable` alerts with `receiveAgent` set to the main agent
2. The next `POST /api/alerts/check` (triggered automatically by the alert monitor component on page load) would run model checks and potentially send Feishu messages

This creates a chain from unauthenticated config write to outbound messaging abuse using real Feishu credentials. The alert check handler reads `appId` and `appSecret` from `openclaw.json` and uses them to obtain a `tenant_access_token` from the Feishu API.

**Needs validation in Chunk 7 (Alerting and Internal Monitoring Flows) and Chunk 10 (Dynamic Verification).**

### S3.2: Model Change Race Condition

The `waitForPatchedModel` function polls the gateway for up to 45 seconds, and `clearAgentSessionModelState` runs after the gateway confirms. If two concurrent PATCH requests target the same agent with different models, the second request's `baseHash` check should fail with a 409 (config changed since last load). However, the 45-second polling window creates a period where the first request is still waiting and the second could slip through before the gateway applies the first patch.

**Needs validation in Chunk 10 (Dynamic Verification).**

### S3.3: CORS Preflight Mutation Bypass

As documented in F3.7, `Content-Type: application/json` POST/PATCH requests trigger CORS preflight. The server processes the mutation regardless of whether the browser receives the response. This should be verified by:
1. Hosting a malicious page on a different origin
2. Sending a fetch to `/api/config/agent-model` with a PATCH body
3. Confirming the model change applies even though the browser blocks the response

**Needs validation in Chunk 10 (Dynamic Verification).**

---

## 6. Exploit Chain Summary

The most dangerous chain using only Chunk 3 endpoints:

```
1. Attacker sends PATCH /api/config/agent-model
   → Changes the bot's model (permanent config change)
   → Clears session model overrides (disrupts active sessions)

2. Attacker sends POST /api/alerts {"enabled": false}
   → Disables all alerting (suppresses detection)

3. Attacker sends POST /api/alerts {"receiveAgent": "nonexistent"}
   → Redirects any re-enabled alerts to a dead end

4. Combined with Chunk 2 findings:
   → /api/config leaks the gateway token (F2.1)
   → Attacker uses the token to directly control the gateway
   → All monitoring/alerting is already disabled
```

Total effort required: 3 unauthenticated HTTP requests with no special tooling.

---

## 7. Positive Security Observations

| Pattern | Where | Assessment |
|---------|-------|------------|
| `execFile` instead of `exec` on Linux | `lib/openclaw-cli.ts`, line 17 | **Correct.** `execFile` does not invoke a shell, preventing shell injection. Arguments are passed as an array. |
| Model validation against known list | `app/api/config/agent-model/route.ts`, lines 200-202 | **Good.** The model must exist in the gateway's configured provider/model inventory. |
| Agent ID validation against gateway config | `app/api/config/agent-model/route.ts`, lines 195-198 | **Partial.** `agentId` is checked against the gateway's agent list, reducing path traversal risk. However, the check depends on the gateway returning truthful data. |
| Atomic file write for layout | `app/api/pixel-office/layout/route.ts`, lines 35-37 | **Correct.** Uses temp-file + rename for crash-safe writes. |
| Config snapshot hash for optimistic concurrency | `app/api/config/agent-model/route.ts`, lines 189-191 | **Good.** `baseHash` provides basic protection against concurrent config modifications through the gateway. |

---

## 8. Open Questions

| # | Question |
|---|----------|
| Q1 | Does the gateway's `config.patch` method have its own authorization, or does it rely entirely on the dashboard being trusted? |
| Q2 | Can `config.patch` modify fields beyond `agents.list[].model` -- e.g., could a crafted `raw` payload change gateway auth tokens or channel credentials? |
| Q3 | Is the `clearAgentSessionModelState` side effect intentional on every model change, or should it be opt-in? Clearing model overrides disrupts any session-level model pinning. |
| Q4 | What happens if `alerts.json` contains invalid JSON or unexpected types? The fallback to defaults means a corrupted file silently resets alert config rather than raising an error. |
| Q5 | Are there any other consumers of `alerts.json` besides the dashboard? If the gateway also reads it, writes from the dashboard could race with gateway reads. |

---

## 9. Remediation Priorities from This Chunk

1. **Add application-level authentication middleware** (blocks all findings in this chunk and prior chunks). This is the single most impactful fix.
2. **Add CSRF protection** -- validate `Origin` header on all state-changing requests. Even without authentication, this prevents cross-site triggering.
3. **Add input validation** on alert config fields: type checks, range limits for `checkInterval` and `threshold`, validate `receiveAgent` against known agent IDs.
4. **Add payload size limits** on `/api/pixel-office/layout` POST to prevent disk exhaustion.
5. **Make `saveAlertConfig` atomic** -- use temp-file + rename pattern (matching the pixel-office handler).
6. **Deduplicate POST/PUT alert handlers** -- single implementation reduces maintenance risk.
7. **Add audit logging** for all mutations -- log caller IP, timestamp, and what changed. The `config.patch` `note` field is a start but has no caller identity.
8. **Return deep copies from config cache** -- `getConfigCache` should return a cloned object to prevent shared-reference mutations.
