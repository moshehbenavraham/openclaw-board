# Chunk 8 Findings: Client-Side Propagation of Sensitive Data

Date: 2026-03-30
Auditor: Cursor (automated)
Status: **Complete**

---

## 1. Files Reviewed

| File | Purpose |
|------|---------|
| `app/page.tsx` | Home page -- fetches `/api/config` and `/api/stats-all`, renders `AgentCard` components with gateway token, exposes test buttons, caches config in module-scope variables |
| `app/components/agent-card.tsx` | Reusable agent card -- receives `gatewayToken` prop, builds tokenized session URLs, renders clickable links and platform badges |
| `app/sidebar.tsx` | Navigation sidebar -- fetches `/api/config` and `/api/gateway-health`, displays OpenClaw version, manages `localStorage` for UI preferences |
| `app/sessions/page.tsx` | Session browser -- fetches config, builds tokenized chat URLs per session, sends gateway token in POST body to test endpoint, stores test results in `localStorage` |
| `app/models/page.tsx` | Model management -- fetches config and model stats, provides test buttons per model, stores test results in `localStorage` |
| `app/pixel-office/page.tsx` | Pixel office view -- fetches config for gateway info, builds tokenized URLs for chat, reads shared test results from `localStorage`, passes gateway token to embedded `AgentCard` |

Supporting files also examined:

| File | Relevance |
|------|-----------|
| `lib/gateway-url.ts` | `buildGatewayUrl()` helper -- constructs URLs with token as query parameter; replaces `localhost` with browser hostname |
| `app/gateway-status.tsx` | Gateway status badge -- polls `/api/gateway-health`, renders tokenized `webUrl` as clickable `<a>` tag (Chunk 7, F7.7) |
| `app/layout.tsx` | Root layout -- embeds `<AlertMonitor />` globally (Chunk 7, F7.6) |
| `app/alerts/page.tsx` | Alert config UI -- fetches alert config and triggers checks; does not directly propagate tokens |

---

## 2. Threat Model Summary for This Surface

The client-side layer creates four interacting exposure surfaces:

1. **Gateway auth token propagation.** The gateway auth token flows from `/api/config` into React component state, is passed as props to `AgentCard` components, embedded into clickable `<a href>` URLs, stored in module-scope caches, and sent in POST request bodies. Every page that renders agent cards or session links places the token into the browser DOM where it is visible to DevTools, browser extensions, referrer headers, browser history, and screen sharing.

2. **Unauthenticated admin actions.** The home page exposes four test buttons and a model switcher that perform state-changing operations (changing agent models, sending real messages to real users across all platforms, exercising LLM provider API credentials). These are admin-level actions rendered to every visitor with no confirmation dialogs, no authentication check, and no rate limiting.

3. **Persistent client-side storage of test results.** Five distinct `localStorage` keys accumulate test result data (including error messages with internal details) with no expiry, no size bounds, and no cleanup. This data persists across sessions and is accessible to any JavaScript on the same origin.

4. **Internal metadata leakage in the DOM.** Platform identifiers (Feishu `accountId`, `botOpenId`, `botUserId`), session key naming conventions, agent IDs, OpenClaw version numbers, and provider API endpoint URLs are rendered in the DOM or available in React component state. This gives an attacker complete reconnaissance data without needing to call API endpoints directly.

---

## 3. Trust Boundaries and Attacker-Controlled Inputs

| Input | Where Set | How Used in Client Code | Risk |
|-------|-----------|------------------------|------|
| `/api/config` response (full config) | Server-side, returned to any caller | Destructured into `data.gateway.token`, `data.gateway.port`, `data.agents[].platforms`, `data.providers` -- used throughout page state | Any browser client receives the gateway auth token, all agent metadata, platform identifiers, and provider details |
| `/api/gateway-health` response (`webUrl`) | Server-side | `resolveGatewayUrl()` replaces `localhost` with browser hostname → rendered as `<a href>` | Tokenized URL becomes network-reachable and DOM-visible |
| `gatewayToken` prop | Passed from parent page to `AgentCard` and `PlatformBadge` | Appended as `token=` query parameter to every session link URL | Token appears in every `<a href>` attribute across all agent cards |
| `localStorage` keys (`agentTestResults`, `platformTestResults`, `sessionTestResults`, `dmSessionResults`, `modelTestResults`) | Written by home page, sessions page, models page | Read back on page load; read by pixel-office page for cross-page display | Test results (including error messages with internal details) persist indefinitely |
| Model selection (user-chosen `draftModel`) | User input in `AgentCard` dropdown | Sent as `model` in PATCH to `/api/config/agent-model` | Any visitor can permanently change agent runtime behavior |
| Test button clicks | User interaction | Trigger POST/GET to test endpoints that send real messages, probe providers, consume API credits | One-click admin actions available to any visitor |

---

## 4. Confirmed Findings

### F8.1: Gateway Auth Token Embedded in DOM `href` Attributes Across All Agent Cards (Critical)

**Severity: Critical**
**Files:** `app/page.tsx` (line 668), `app/components/agent-card.tsx` (lines 215-216, 385-386), `app/sessions/page.tsx` (lines 293-294), `app/pixel-office/page.tsx` (lines 1186-1187, 1993)

The gateway auth token flows from `/api/config` into every page that renders agent cards or session links:

```javascript
// page.tsx line 668 -- passes token as prop
<AgentCard ... gatewayToken={data.gateway?.token} ... />

// agent-card.tsx lines 385-386 -- builds tokenized URL
let sessionUrl = buildGatewayUrl(gatewayPort, "/chat", { session: sessionKey }, gatewayHost);
if (gatewayToken) sessionUrl = buildGatewayUrl(gatewayPort, "/chat", { session: sessionKey, token: gatewayToken }, gatewayHost);

// sessions/page.tsx lines 293-294 -- same pattern
let chatUrl = buildGatewayUrl(gateway.port, "/chat", { session: s.key }, gateway.host);
if (gateway.token) chatUrl = buildGatewayUrl(gateway.port, "/chat", { session: s.key, token: gateway.token }, gateway.host);
```

The token appears as a URL query parameter (e.g., `http://host:18789/chat?session=...&token=SECRET`) in:
- Every `<a href>` tag rendered by `AgentCard` (2 per agent: agent ID link + per-platform badge links)
- Every `<a href>` tag in session list rows
- `window.open()` calls in sessions page (line 298) and pixel-office page (line 1188)
- The `GatewayStatus` component (gateway-status.tsx line 55)

**Exposure vectors:**
- Browser DevTools (Elements panel shows all `href` attributes)
- Browser history (every clicked link records the tokenized URL)
- Referrer headers (if the gateway page links to external resources)
- Browser extensions that read DOM or intercept navigation
- Screen sharing, screenshots, shoulder surfing
- `document.querySelectorAll('a[href*="token="]')` extracts all tokens from the page

**Impact:** The gateway auth token is the single credential that authenticates all gateway API requests. Its exposure in the DOM grants an attacker full control over the bot: sending messages as the bot, reading sessions, and changing configuration.

**Cross-references:** F2.1 (token in `/api/config` response), F2.2 (token in `/api/gateway-health` response), F7.7 (GatewayStatus renders tokenized URL)

### F8.2: Gateway Token Sent in POST Body from Browser to Backend (High)

**Severity: High**
**File:** `app/sessions/page.tsx` (lines 242-245)

The `testSession` function sends the gateway token from the browser to the server in a POST body:

```javascript
const res = await fetch("/api/test-session", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ sessionKey, agentId, port: gateway.port, token: gateway.token }),
});
```

**Issues:**
- The token is transmitted from client to server despite the server already having access to the config file
- Any XSS vulnerability would allow an attacker to intercept or replay this request
- Browser DevTools Network tab shows the token in the request payload
- The token is in the `gateway` state object (line 163: `useState<GatewayInfo>({ port: 18789 })`) which is populated from `/api/config` and persists for the component lifetime

**Why this matters beyond F8.1:** F8.1 puts the token in static `href` attributes. F8.2 actively transmits the token in HTTP request bodies, which creates additional interception opportunities (browser network inspector, proxy tools, request logging).

### F8.3: Config Data with Gateway Token Cached in Module-Scope Variables (High)

**Severity: High**
**File:** `app/page.tsx` (lines 111-116)

The home page caches the full config response (including gateway token) in module-scope variables:

```javascript
let cachedHomeData: ConfigData | null = null;
let cachedHomeError: string | null = null;
let cachedHomeAllStats: AllStats | null = null;
let cachedHomeLastUpdated = "";
let cachedHomeRefreshInterval = 0;
let cachedHomeAgentStates: Record<string, string> = {};
```

The `ConfigData` type (lines 47-57) includes:

```typescript
gateway?: { port: number; token?: string; host?: string };
```

**Issues:**
- Module-scope variables survive React component unmounts and re-mounts within the SPA
- The gateway token stays in JavaScript memory even after navigating away from the home page
- These variables are accessible from any code running in the same JavaScript context
- The cache is never cleared or expired
- Combined with periodic refresh (lines 514-520), the cached token is refreshed but never purged

### F8.4: Unauthenticated One-Click Model Change from Browser (High)

**Severity: High**
**Files:** `app/page.tsx` (lines 312-323), `app/components/agent-card.tsx` (lines 380-535)

Any visitor to the dashboard can permanently change an agent's LLM model through the UI:

1. The `AgentCard` renders a "Switch Model" button (line 481) when model options are available
2. A dropdown populated with all configured providers and models (lines 487-505)
3. Clicking "Save" triggers `changeAgentModel` which PATCHes `/api/config/agent-model`

```javascript
// page.tsx lines 312-318
const changeAgentModel = useCallback(async (agentId: string, model: string) => {
  const resp = await fetch("/api/config/agent-model", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentId, model }),
  });
```

**Issues:**
- No authentication check before rendering the UI
- No confirmation dialog ("Are you sure you want to change the agent model?")
- No audit trail in the client (the change is fire-and-forget)
- All available providers and models are listed in the dropdown, including provider IDs that reveal vendor relationships

**Cross-references:** F3.1 (unauthenticated model change endpoint)

### F8.5: Test Buttons Trigger External Side Effects Without Confirmation (Medium)

**Severity: Medium**
**Files:** `app/page.tsx` (lines 391-511, 602-629), `app/sessions/page.tsx` (lines 238-262), `app/models/page.tsx` (lines 73-139)

The home page renders four prominent test buttons in the header:

```
[Test All Models] [Test Platforms] [Test Sessions] [Test DM Sessions]
```

Each button triggers real external side effects:
- **Test All Models** → `POST /api/test-bound-models` → exercises real LLM provider API credentials for every agent, consuming API credits
- **Test Platforms** → `POST /api/test-platforms` → sends real messages to real users across all platforms
- **Test Sessions** → `POST /api/test-sessions` → sends real messages through agent sessions
- **Test DM Sessions** → `POST /api/test-dm-sessions` → sends real DMs to real users

The models page additionally has per-model test buttons and a "Test All" button that exercises every provider.

**Issues:**
- No confirmation dialog before triggering side effects
- No rate limiting in the UI (users can click repeatedly)
- The `callTestApi` helper (page.tsx lines 262-277) falls back from POST to GET, meaning even HTTP method constraints can be bypassed client-side
- Disabled state only applies while a test is in-progress, not as a cooldown

**Cross-references:** F4.x (Chunk 4: all test endpoints are unauthenticated)

### F8.6: Test Results Persisted in localStorage Without Expiry or Bounds (Medium)

**Severity: Medium**
**Files:** `app/page.tsx` (lines 326-389), `app/sessions/page.tsx` (lines 203-218), `app/models/page.tsx` (lines 161-176), `app/pixel-office/page.tsx` (lines 898-917)

Five `localStorage` keys accumulate test results indefinitely:

| Key | Written By | Read By |
|-----|-----------|---------|
| `agentTestResults` | `page.tsx` | `page.tsx`, `pixel-office/page.tsx` |
| `platformTestResults` | `page.tsx` | `page.tsx`, `pixel-office/page.tsx` |
| `sessionTestResults` | `page.tsx`, `sessions/page.tsx` | `page.tsx`, `sessions/page.tsx`, `pixel-office/page.tsx` |
| `dmSessionResults` | `page.tsx` | `page.tsx`, `pixel-office/page.tsx` |
| `modelTestResults` | `models/page.tsx` | `models/page.tsx` |

**Issues:**
- **No expiry:** Test results persist forever until manually cleared
- **No size bounds:** Each run appends/replaces without pruning; over time, error messages can accumulate significant data
- **Sensitive content in values:** Error messages from failed tests may include internal hostnames, port numbers, provider error details, model names, and stack traces
- **Cross-page leakage:** pixel-office reads the same keys as the home page (lines 898-917), creating an implicit shared state channel
- **Same-origin JavaScript access:** Any script on the same origin (including injected scripts from XSS) can read all stored test results via `localStorage.getItem()`
- **No integrity checks:** Stored JSON is parsed without validation; a tampered value could inject unexpected data into the UI

### F8.7: Platform Identifiers and Internal Metadata Rendered in DOM (Medium)

**Severity: Medium**
**Files:** `app/components/agent-card.tsx` (lines 7-13, 207-214, 250-252), `app/sidebar.tsx` (lines 425-441, 478)

Platform-specific identifiers are exposed in the DOM:

```javascript
// agent-card.tsx line 250 -- accountId rendered in badge text
{pName === "feishu" && platform.accountId && (
  <span className="opacity-60 truncate max-w-[4.5rem]">({platform.accountId})</span>
)}

// agent-card.tsx lines 208-211 -- botOpenId/botUserId in session key URLs
if (pName === "feishu" && platform.botOpenId) {
  sessionKey = `agent:${agentId}:feishu:direct:${platform.botOpenId}`;
} else if (platform.botUserId) {
  sessionKey = `agent:${agentId}:${pName}:direct:${platform.botUserId}`;
}
```

The sidebar displays the OpenClaw version number:

```javascript
// sidebar.tsx line 478
OPENCLAW{mobileOpenclawVersion ? ` ${mobileOpenclawVersion}` : ""}
```

**Exposed identifiers:**
- Feishu `accountId` (visible in DOM text)
- Feishu `botOpenId` (embedded in session key URLs)
- Platform `botUserId` for all platforms (embedded in session key URLs)
- Session key naming convention (`agent:{id}:{platform}:direct:{userId}`)
- Agent IDs and names
- OpenClaw exact version number (useful for targeting known CVEs)
- Provider API endpoint URLs (visible in models page)

**Impact:** This metadata supports reconnaissance. An attacker can enumerate all agents, platforms, bot identifiers, and the exact software version without calling any API endpoint -- the information is in the page DOM.

### F8.8: Session Keys Constructed Client-Side Revealing Internal Naming Convention (Low)

**Severity: Low**
**Files:** `app/components/agent-card.tsx` (lines 207-216), `app/sessions/page.tsx` (line 245)

Session keys are constructed in client-side JavaScript following the internal naming convention:

```javascript
sessionKey = `agent:${agentId}:feishu:direct:${platform.botOpenId}`;
sessionKey = `agent:${agentId}:${pName}:direct:${platform.botUserId}`;
sessionKey = `agent:${agentId}:main`;
```

**Issues:**
- The session key schema is exposed, allowing an attacker to construct valid session keys for arbitrary agents and platforms
- Combined with F8.1 (token in URLs), an attacker can build authenticated gateway URLs for any session
- The naming convention reveals the internal architecture (agent-based routing, platform-specific sessions, main session concept)

### F8.9: `callTestApi` Falls Back from POST to GET Silently (Low)

**Severity: Low**
**File:** `app/page.tsx` (lines 262-277)

```javascript
const callTestApi = useCallback(async (url: string) => {
  const requestWithMethod = async (method: "POST" | "GET") => {
    const resp = await fetch(url, { method, cache: "no-store" });
    return parseApiPayload(resp);
  };
  const first = await requestWithMethod("POST");
  if (first.ok) return first.data;
  const methodIssue = first.status === 405 || /method not allowed/i.test(first.errorText || "");
  if (!methodIssue) throw new Error(first.errorText);
  const fallback = await requestWithMethod("GET");
  ...
```

**Issues:**
- If a POST endpoint returns 405, the client silently retries with GET
- This undermines any server-side attempt to restrict test endpoints to POST-only
- GET requests can be triggered by `<img src>` tags, link prefetch, and other passive mechanisms
- The fallback is invisible to the user (no indication that the method changed)

**Cross-references:** F4.2 (GET aliases on test endpoints)

### F8.10: Provider Listing Exposes Vendor Relationships and API Endpoints (Low)

**Severity: Low**
**Files:** `app/page.tsx` (lines 50-56, 573-588), `app/models/page.tsx` (lines 247-478)

The config response includes the full provider list with API endpoint URLs:

```typescript
providers?: Array<{
  id: string;
  accessMode?: "auth" | "api_key";
  models?: Array<{ id: string; name?: string }>;
}>;
```

The models page renders provider IDs (line 254: `<h2>{provider.id}</h2>`) and API endpoints (line 256: `API: {provider.api}`) in the DOM. The home page renders provider information in the model selection dropdown (lines 496-504).

**Impact:** An attacker learns which LLM providers are configured, their access modes, and available models. This supports targeted attacks against specific providers.

---

## 5. Suspected Findings (Require Dynamic Validation)

### S8.1: Browser History Accumulates Gateway Tokens from Clicked Session Links

Every session link and agent card link includes the gateway token as a URL query parameter. When a user clicks any of these links, the tokenized URL is saved in browser history. Over time, browser history may accumulate dozens of entries containing the gateway token.

**Needs validation in Chunk 10:** Confirm whether `window.open()` and `<a target="_blank">` calls record the full URL (including `?token=`) in browser history. Check whether Referrer-Policy headers strip the token on navigation.

### S8.2: localStorage Test Results May Contain Sensitive Error Details

Failed test results store error messages from the server. These error messages may include internal hostnames, filesystem paths, provider API error responses, or stack traces depending on how the test endpoints format errors.

**Needs validation in Chunk 10:** Trigger test failures and inspect the error messages stored in `localStorage` to determine whether they contain exploitable internal details.

### S8.3: Module-Scope Cache Survives React Component Remounts

The `cachedHomeData` variable in `page.tsx` stores the full config (including gateway token) in module scope. In a Next.js SPA, module-scope variables persist across client-side navigations. If a future code change adds a logout or session-end mechanism, the cached token would not be cleared.

**Needs validation in Chunk 10:** Verify that navigating between pages and back preserves the cached config including the token.

---

## 6. Exploit Chain Summary

### Chain 1: Token Extraction via DOM Inspection

```
1. Attacker loads the dashboard (no auth required)
   → page.tsx fetches /api/config, receives gateway.token
   → AgentCard components render tokenized URLs in <a href> attributes

2. Attacker opens DevTools → Elements panel
   → searches for 'token=' in DOM
   → extracts gateway auth token from any <a href>

3. Attacker uses token to authenticate directly to gateway API
   → POST /v1/chat/completions with Authorization: Bearer <token>
   → full control over bot: send messages, read sessions, change config
```

### Chain 2: Persistent Token Extraction via Browser History

```
1. Legitimate operator clicks any session link or agent card link
   → browser opens tokenized URL in new tab
   → URL with ?token=SECRET saved to browser history

2. Later, attacker gains access to same browser (shared computer, device theft)
   → opens browser history
   → searches for gateway host/port
   → extracts token from history entries

3. Token used for persistent gateway access even if dashboard session ends
```

### Chain 3: Full Admin Takeover via Dashboard UI (Cross-Chunk)

```
1. GET /api/config → full config with token, agents, providers (F2.1, F8.1)
2. Click "Switch Model" on any AgentCard → change to weaker/cheaper model (F8.4, F3.1)
3. Click "Test All Platforms" → send messages to all real users (F8.5, F4.1)
4. Click "Test DM Sessions" → send DMs to all real users (F8.5, F4.3)
5. POST /api/alerts → disable all monitoring (F3.3)
6. Use extracted token to access gateway API directly

Total: 5 clicks + 1 API call = full admin takeover + messaging abuse + monitoring disabled
```

### Chain 4: Cross-Page Data Leakage via localStorage

```
1. Attacker loads /models, clicks "Test All Models"
   → results (including error messages with internal details) stored in modelTestResults

2. Attacker loads home page, clicks all four test buttons
   → results stored in agentTestResults, platformTestResults, sessionTestResults, dmSessionResults

3. Attacker loads /pixel-office
   → page reads all five localStorage keys on mount (lines 898-917)
   → cross-page test results available in a single view

4. Any future XSS vulnerability allows extraction of all stored test data
   → localStorage.getItem('agentTestResults') etc.
```

---

## 7. Positive Security Observations

| Pattern | Where | Assessment |
|---------|-------|------------|
| `noopener noreferrer` on external links | `agent-card.tsx` line 229, `gateway-status.tsx` line 57 | **Good.** Prevents `window.opener` leakage to opened pages. Does not prevent token from appearing in browser history or referrer headers to the gateway page itself. |
| `e.stopPropagation()` on test/link actions | `agent-card.tsx` line 229, `sessions/page.tsx` line 239 | **Good.** Prevents event bubbling from causing unintended parent actions. |
| Config fetch error handling | `page.tsx` lines 286-288 | **Good.** Error state is tracked and displayed to the user rather than silently failing. |
| AbortSignal not used but cache: "no-store" set | `page.tsx` line 264, `sidebar.tsx` line 404 | **Neutral.** Prevents stale cached responses but doesn't timeout hung requests. |
| `localStorage` only stores non-secret UI preferences | `sidebar.tsx` (bug overlay prefs), `lib/theme.tsx`, `lib/i18n.tsx` | **Good.** Non-sensitive preferences (theme, locale, bug overlay) are appropriately stored in localStorage. |
| Session key constructed from known agent/platform data only | `agent-card.tsx` lines 207-214 | **Partial.** Keys are deterministic from config data, so no user-controlled input enters the key. However, the key format is exposed. |

---

## 8. Open Questions

| # | Question |
|---|----------|
| Q1 | Is the gateway auth token intended to be a short-lived or long-lived credential? If long-lived, its exposure in browser history and DOM is a persistent compromise. If short-lived, what is the rotation mechanism? |
| Q2 | Are there any browser-level protections (Content-Security-Policy, Referrer-Policy) configured that might limit token leakage via referrer headers when navigating to the gateway? |
| Q3 | Does the `buildGatewayUrl` hostname replacement (using `window.location.hostname`) make the tokenized URLs reachable from external networks when the dashboard is exposed to the internet? |
| Q4 | Are the test buttons intended for development/debugging only? If so, should they be hidden behind a feature flag or removed from production builds? |
| Q5 | Is there a reason the sessions page sends `gateway.token` in the POST body to `/api/test-session` (F8.2)? The server has direct access to the config file and should not need the token from the client. |

---

## 9. Remediation Priorities from This Chunk

1. **Stop propagating the gateway token to the browser** (blocks F8.1, F8.2, F8.3). The `/api/config` endpoint should strip `gateway.token` from the response. Session URLs should be built server-side or use a proxy endpoint that attaches the token server-side. This is the single highest-impact change.

2. **Add authentication to the dashboard** (blocks F8.4, F8.5, and all client-side admin actions). Without application-level auth, the token exposure is one of many paths to full compromise. Even a simple shared secret or IP allowlist would reduce the attack surface.

3. **Remove the gateway token from client-built URLs** (F8.1). If session links need the token, implement a server-side redirect endpoint (e.g., `/api/chat-redirect?session=KEY`) that appends the token server-side and returns a 302.

4. **Remove the gateway token from the `/api/test-session` POST body** (F8.2). The server can read the token from config directly; the client should not send it.

5. **Add confirmation dialogs to destructive/expensive actions** (F8.4, F8.5). Model changes and "test all" actions that exercise real provider credentials or send real messages should require explicit confirmation.

6. **Add expiry and size bounds to localStorage test results** (F8.6). Store a timestamp with each result set and prune on read. Cap the total storage size.

7. **Strip platform identifiers from client-visible responses** (F8.7). `accountId`, `botOpenId`, `botUserId` should not reach the browser unless specifically needed for a client-side feature.

8. **Set Referrer-Policy headers** (S8.1). Add `Referrer-Policy: no-referrer` or `same-origin` to prevent tokenized URLs from leaking via referrer headers when navigating to the gateway.

9. **Remove the POST-to-GET fallback in `callTestApi`** (F8.9). If POST returns 405, display an error instead of silently retrying with GET. This prevents circumvention of server-side HTTP method restrictions.

10. **Clear module-scope caches on sensitive state changes** (F8.3). If a logout or session-end mechanism is added, ensure `cachedHomeData` and similar variables are explicitly nullified.
