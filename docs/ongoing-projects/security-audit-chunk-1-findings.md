# Chunk 1 Findings: Threat Model and Exposure Assumptions

Date: 2026-03-29
Auditor: Cursor (automated)
Status: **Complete**

---

## 1. Files Reviewed

| File | Purpose |
|------|---------|
| `README.md` | Deployment guidance, feature description, Docker examples |
| `Dockerfile` | Container build and runtime configuration |
| `next.config.mjs` | Next.js build and runtime settings |
| `app/layout.tsx` | Root layout, component imports |
| `app/providers.tsx` | Client-side context (theme, i18n only) |
| `app/sidebar.tsx` | Client-side navigation; fetches `/api/config` and `/api/gateway-health` on load |
| `app/alert-monitor.tsx` | Background polling of `/api/alerts` and `/api/alerts/check` |
| `package.json` | Dependencies, scripts |
| `docs/quick-start.md` | Installation methods |
| `lib/gateway-url.ts` | Gateway URL builder used by client components |
| `app/api/config/route.ts` | Main config endpoint (sampled for auth/token exposure) |
| `app/api/gateway-health/route.ts` | Gateway health probe (sampled for token exposure) |
| All 25 `app/api/**/route.ts` paths | Checked for middleware/auth patterns |

---

## 2. Threat Model Summary

### Intended Trust Boundary

The application is designed as a **local monitoring dashboard** that reads OpenClaw runtime state directly from the filesystem (`~/.openclaw/`). The README describes it as reading "local OpenClaw configuration and session data" with "No database required." The quick-start guide points users to `http://localhost:3000`.

**However, nothing in the codebase enforces this localhost assumption.** The application functions identically whether accessed from `127.0.0.1` or from a remote IP. There is no bind-address restriction at the application level, no authentication layer, and no middleware of any kind.

### Actual Exposure Posture

The application should be treated as **internet-reachable by default** in Docker deployments and potentially reachable in bare-metal deployments depending on firewall configuration.

Evidence:

- **Dockerfile line 24:** `ENV HOSTNAME="0.0.0.0"` binds the production server to all network interfaces.
- **Docker run example (README line 92):** `docker run -d -p 3000:3000 openclaw-dashboard` publishes port 3000 on all host interfaces without restriction.
- **No middleware.ts exists** anywhere in the project. Zero authentication, authorization, or request validation at the application layer.
- **No `.env` file or `.env.example`** documenting expected secrets or auth configuration.
- **No docker-compose.yml** that could enforce network isolation.

### Sensitive Assets Accessible Through the UI

Any network client that can reach port 3000 can access:

| Asset | Endpoint | Severity |
|-------|----------|----------|
| Gateway auth token | `/api/config` (field: `gateway.token`) | **Critical** |
| Tokenized gateway URL | `/api/gateway-health` (field: `webUrl`) | **Critical** |
| Full agent configuration (models, platforms, bindings) | `/api/config` | High |
| Session metadata (token counts, activity timestamps) | `/api/config`, `/api/sessions/[agentId]` | High |
| Provider/model inventory | `/api/config` (field: `providers`) | Medium |
| Feishu account IDs, app IDs, user open IDs | `/api/config` (agent platform details) | High |
| Discord DM allow-from user IDs | `/api/config` | Medium |
| Skill file contents from local filesystem | `/api/skills/content` | Medium |
| Agent activity and session JSONL data | `/api/agent-activity`, `/api/stats/*` | Medium |

---

## 3. Trust Boundaries and Attacker-Controlled Inputs

### Trust Boundaries

| Boundary | Status |
|----------|--------|
| Network -> Application | **No boundary.** No auth, no IP allowlist, no middleware. |
| Application -> Filesystem | **Partial.** Reads are scoped to `OPENCLAW_HOME` but several routes accept user-controlled path segments (`[agentId]`). |
| Application -> Gateway (localhost) | **No boundary from app side.** The app reads the gateway token from config and uses it in probes. If the app is compromised, the gateway is reachable. |
| Application -> External services | **No boundary.** Test endpoints (`/api/test-*`) can trigger outbound requests to Feishu, Discord, and other platforms. |

### Attacker-Controlled Inputs

- **URL path segments:** `[agentId]` in `/api/sessions/[agentId]` and `/api/stats/[agentId]` -- could be used for path traversal if not validated.
- **Query parameters:** Various test endpoints accept platform identifiers, model refs, and session keys.
- **POST bodies:** `/api/alerts`, `/api/config/agent-model`, `/api/pixel-office/layout` accept JSON bodies that can modify runtime state.
- **Referer/Origin headers:** Not checked -- no CSRF protection exists.

---

## 4. Confirmed Findings

### F1.1: Gateway Auth Token Exposed to Any Network Client

**Severity: Critical**
**File:** `app/api/config/route.ts`, lines 545-548
**Evidence:**

```javascript
gateway: {
  port: config.gateway?.port || 18789,
  token: config.gateway?.auth?.token || "",
  host: config.gateway?.host || config.gateway?.hostname || "",
},
```

The gateway auth token is read from `openclaw.json` and returned in the JSON response body of `/api/config`. This endpoint has no authentication. Any client on the network can extract the token and use it to authenticate directly to the OpenClaw gateway, gaining full control over the bot (send messages, modify config, access sessions).

### F1.2: Tokenized Gateway URL Exposed in Health Check Response

**Severity: Critical**
**File:** `app/api/gateway-health/route.ts`, line 131 (and lines 153, 168, 185, 231, 245)
**Evidence:**

```javascript
const webUrl = `http://localhost:${port}/chat${token ? '?token=' + encodeURIComponent(token) : ''}`;
```

The `webUrl` field is returned in every successful `/api/gateway-health` response. It contains the gateway token in the query string. Even if F1.1 were fixed, this endpoint independently leaks the token.

### F1.3: No Application-Level Authentication

**Severity: Critical**
**Evidence:** No `middleware.ts` file exists. Grep for `auth`, `middleware`, `session`, `cookie`, `jwt`, `token`, `bearer`, `x-api-key` across all 25 API route files returns zero authentication checks. The `providers.tsx` file contains only theme and i18n context.

Every route -- including state-changing endpoints and test endpoints that trigger outbound messages -- is accessible to any network client without credentials.

### F1.4: Docker Default Binds to All Interfaces

**Severity: High**
**File:** `Dockerfile`, line 24
**Evidence:**

```dockerfile
ENV HOSTNAME="0.0.0.0"
```

Combined with the README's Docker run example (`-p 3000:3000`), the default deployment exposes all unauthenticated endpoints to whatever network the Docker host is connected to.

### F1.5: No Security Headers or CSP

**Severity: Medium**
**File:** `next.config.mjs` (entire file)
**Evidence:**

```javascript
const nextConfig = {
  output: 'standalone',
};
```

No `headers()` configuration. No Content-Security-Policy, X-Frame-Options, X-Content-Type-Options, or Strict-Transport-Security. The app can be framed, and injected content (if any XSS exists) runs without CSP restrictions.

---

## 5. Suspected Findings (Require Dynamic Validation)

### S1.1: Client-Side Token Propagation

**File:** `app/sidebar.tsx` (lines 401-441), `lib/gateway-url.ts`

The sidebar fetches `/api/config` and `/api/gateway-health` on page load. The gateway token and tokenized URL are available in client-side state. `buildGatewayUrl` in `lib/gateway-url.ts` constructs URLs using the token. These may be rendered into clickable links or logged to browser console, expanding exposure to browser history, extensions, and network proxies.

**Needs validation in Chunk 8 (Client-Side Propagation) and Chunk 10 (Dynamic Verification).**

### S1.2: Path Traversal via `[agentId]` Segments

Routes like `/api/sessions/[agentId]` and `/api/stats/[agentId]` use the path segment to construct filesystem paths (`path.join(OPENCLAW_DIR, agents/${agentId}/sessions)`). If `agentId` is not validated, values like `../../etc` could read outside the intended directory.

**Needs validation in Chunk 5 (Filesystem and Local Runtime Bridge Review).**

### S1.3: Alert Monitor Creates Automatic Side Effects

`app/alert-monitor.tsx` fires `POST /api/alerts/check` on page load and on a timer. If the alerts system sends notifications (e.g., Feishu messages), any page visit triggers outbound messaging without user interaction.

**Needs validation in Chunk 7 (Alerting and Internal Monitoring Flows).**

---

## 6. Open Questions and Assumptions

| # | Question | Assumption Used |
|---|----------|-----------------|
| Q1 | Is the app intended to be accessed only from localhost? | **Yes, based on README and quick-start**, but the codebase does not enforce this. Audit proceeds as if the app is internet-reachable. |
| Q2 | Does the deployment (Krox VPS) place the dashboard behind a firewall or reverse proxy with auth? | **Unknown.** Audit treats the app as directly exposed. If external network controls exist, findings may be partially mitigated but code-level fixes remain recommended. |
| Q3 | Are there other consumers of the `/api/config` endpoint besides the dashboard UI? | **Unknown.** The endpoint returns far more data than the UI appears to need, including the gateway token. |
| Q4 | Is the gateway token the only credential needed for full gateway access? | **Likely yes**, based on the gateway health probe code using only `Bearer ${token}`. |
| Q5 | Does `OPENCLAW_HOME` ever point to a shared or world-readable directory? | **Unknown.** If it does, the filesystem reads in API routes would expose data to additional local attackers. |

---

## 7. Summary of Risk

The dashboard has **no authentication boundary**. In its default Docker deployment, it binds to all interfaces and exposes the OpenClaw gateway auth token -- the single credential required for full bot control -- to any network client. This makes the dashboard the weakest link in the OpenClaw deployment: compromising the dashboard immediately compromises the gateway and all connected platforms (Telegram, Discord, Feishu, etc.).

The README and quick-start documentation provide no security warnings, no guidance on restricting network access, and no suggestion to use a reverse proxy with authentication.

**Immediate remediation priorities from this chunk:**

1. Strip the gateway token from `/api/config` responses (or gate the endpoint behind auth).
2. Strip the tokenized URL from `/api/gateway-health` responses.
3. Add application-level authentication middleware before any other fixes.
4. Change the Dockerfile to bind to `127.0.0.1` by default, or add prominent security warnings to deployment docs.
5. Add security headers via `next.config.mjs`.
