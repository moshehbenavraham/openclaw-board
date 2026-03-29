# Chunk 2 Findings: Secret Exposure and Read-Only Data Leakage

Date: 2026-03-29
Auditor: Cursor (automated)
Status: **Complete**

---

## 1. Files Reviewed

| File | Purpose |
|------|---------|
| `app/api/config/route.ts` | Main config endpoint -- returns agents, providers, gateway info |
| `app/api/gateway-health/route.ts` | Gateway health probe -- returns status and tokenized webUrl |
| `app/api/skills/content/route.ts` | Returns raw SKILL.md file contents by source+id |
| `app/api/skills/route.ts` | Lists all skills with metadata and absolute file paths |
| `app/api/sessions/[agentId]/route.ts` | Lists session metadata per agent |
| `app/api/agent-status/route.ts` | Returns agent online/idle/offline state |
| `app/api/agent-activity/route.ts` | Returns agent activity, subagents, cron jobs |
| `app/api/stats-all/route.ts` | Aggregated token usage stats across all agents |
| `app/api/stats/[agentId]/route.ts` | Per-agent token usage stats |
| `lib/openclaw-skills.ts` | Skill discovery, listing, and file reading |
| `lib/openclaw-paths.ts` | Path constants and OpenClaw package location logic |
| `lib/config-cache.ts` | In-memory config cache (caches whatever `/api/config` returns) |
| `lib/json.ts` | JSON parsing helpers |

---

## 2. Threat Model Summary for This Surface

These endpoints form the **read-only data surface** of the dashboard. They are intended to provide monitoring and visibility into the OpenClaw runtime. Since none have authentication (confirmed in Chunk 1, F1.3), any network client can enumerate the full operational state of the deployment.

The critical question for this chunk: **which specific secrets and sensitive metadata reach any caller?**

---

## 3. Trust Boundaries and Attacker-Controlled Inputs

| Input | Endpoint | Risk |
|-------|----------|------|
| `agentId` URL path segment | `/api/sessions/[agentId]`, `/api/stats/[agentId]` | Path traversal -- used directly in filesystem path construction |
| `source` query param | `/api/skills/content` | Selects skill source category; filtered through enumerated list |
| `id` query param | `/api/skills/content` | Selects skill ID; filtered through enumerated list |

---

## 4. Confirmed Findings

### F2.1: Gateway Auth Token in `/api/config` Response (Critical)

**Severity: Critical** (cross-ref: F1.1)
**File:** `app/api/config/route.ts`, lines 540-551

The response JSON includes:

```javascript
gateway: {
  port: config.gateway?.port || 18789,
  token: config.gateway?.auth?.token || "",
  host: config.gateway?.host || config.gateway?.hostname || "",
},
```

This is the single most dangerous leak. The gateway token grants full access to the OpenClaw gateway API -- sending messages as the bot, reading sessions, modifying configuration, triggering cron jobs. Any caller on the network can extract it.

### F2.2: Tokenized Gateway URL in `/api/gateway-health` Response (Critical)

**Severity: Critical** (cross-ref: F1.2)
**File:** `app/api/gateway-health/route.ts`, line 131

```javascript
const webUrl = `http://localhost:${port}/chat${token ? '?token=' + encodeURIComponent(token) : ''}`;
```

The `webUrl` field appears in every success response variant (lines 131, 153, 168, 185, 231, 245). It embeds the gateway auth token in a query string. Even if `/api/config` were fixed, this endpoint independently leaks the token.

### F2.3: Full Platform Identity Metadata Exposed via `/api/config` (High)

**Severity: High**
**File:** `app/api/config/route.ts`, lines 349-419

The per-agent response includes:

- **Feishu:** `accountId`, `appId`, `botOpenId` (user's open_id from sessions)
- **Discord:** `botUserId` (from DM allowFrom or session peer IDs)
- **Telegram:** `botUserId`
- **WhatsApp:** `botUserId`

These identifiers enable an attacker to:
- Identify the Feishu app and target it for social engineering or API abuse
- Map Discord/Telegram/WhatsApp user IDs for the bot operator
- Correlate identities across platforms

### F2.4: Session Keys Expose Platform User Identifiers (High)

**Severity: High**
**File:** `app/api/sessions/[agentId]/route.ts`, lines 13-58

Session keys follow the pattern `agent:{agentId}:{channel}:{type}:{userId}` and are returned directly. The `target` field extracted from each key exposes:

- Feishu user `open_id` values (e.g., `ou_abc123`)
- Discord channel IDs
- Telegram user/group IDs
- WhatsApp user/group IDs
- Cron job identifiers

These are operational identifiers that should not be visible to unauthenticated callers.

### F2.5: Absolute Filesystem Paths Exposed in Skill Listings (Medium)

**Severity: Medium**
**File:** `lib/openclaw-skills.ts`, lines 49-61

```javascript
function readSkillFile(skillMd: string, source: string, id = ...): SkillInfo | null {
  // ...
  return {
    id,
    name: fm.name || id,
    // ...
    location: skillMd,  // absolute path like /home/krox/.local/lib/node_modules/openclaw/skills/web_search/SKILL.md
    usedBy: [],
  };
}
```

The `/api/skills` endpoint returns these `SkillInfo` objects with the `location` field intact. This reveals:
- The server's home directory path
- Node.js installation paths
- OpenClaw installation method and location
- Custom skill directory paths

### F2.6: Skill File Content Readable via `/api/skills/content` (Medium)

**Severity: Medium**
**File:** `app/api/skills/content/route.ts`, `lib/openclaw-skills.ts` line 153-161

The `getOpenclawSkillContent` function reads the full content of any skill file by matching `source` and `id` against the enumerated skill list, then reads the file at `skill.location`:

```javascript
content: fs.readFileSync(skill.location, "utf-8"),
```

While the `source` and `id` parameters are validated against the enumerated list (preventing direct path traversal), this still exposes the full source code of all installed skills -- builtin, extension, and custom -- to any caller. Custom skills may contain operational details, API endpoints, or implementation secrets.

### F2.7: Path Traversal via `[agentId]` in Multiple Routes (High)

**Severity: High**
**Files:**
- `app/api/sessions/[agentId]/route.ts`, line 9
- `app/api/stats/[agentId]/route.ts`, line 17

Both routes construct filesystem paths using the unvalidated `agentId` segment:

```javascript
const sessionsPath = path.join(OPENCLAW_HOME, `agents/${agentId}/sessions/sessions.json`);
```

If `agentId` is `../../etc`, this resolves to a path outside `OPENCLAW_HOME`. Node's `path.join` normalizes `..` segments, so `path.join('/home/krox/.openclaw', 'agents/../../etc/sessions/sessions.json')` becomes `/home/krox/etc/sessions/sessions.json`.

**Exploitability constraints:**
- The path must end with `/sessions/sessions.json` (sessions route) or contain `.jsonl` files in a `sessions/` subdirectory (stats route)
- Files must be valid JSON/JSONL
- The traversal depth depends on the number of `../` segments

Despite constraints, this is a code-level defect: user input reaches `fs.readFileSync` without path boundary validation.

The same pattern appears in `app/api/agent-status/route.ts` (line 20) though with an auto-discovered agent list rather than user-supplied IDs.

### F2.8: Cron Job Payloads and Error Messages Exposed (Medium)

**Severity: Medium**
**File:** `app/api/agent-activity/route.ts`, lines 719-769

The `/api/agent-activity` endpoint exposes cron job metadata including:
- Job IDs and session keys
- Job names and labels
- `lastSummary` (from cron job payload `message` or `text` fields, or from error messages)
- Consecutive failure counts
- Run timestamps and durations

Cron job payloads may contain prompts, instructions, or internal context that should not be visible to unauthenticated callers.

### F2.9: Error Responses Leak Internal Paths and State (Low)

**Severity: Low**
**Files:** All API routes

Every route catches errors and returns `err.message` in the response body:

```javascript
catch (err: any) {
  return NextResponse.json({ error: err.message }, { status: 500 });
}
```

Node.js filesystem errors include absolute paths (e.g., `ENOENT: no such file or directory, open '/home/krox/.openclaw/agents/foo/sessions/sessions.json'`). This confirms filesystem layout to an attacker even when the normal response is empty.

### F2.10: Config Cache Persists Secrets in Memory (Low)

**Severity: Low**
**File:** `lib/config-cache.ts`

The config cache stores whatever `data` object the `/api/config` route produces -- including the gateway token. The cache has a 30-second TTL but no invalidation mechanism. The cached data object is returned directly (same reference), meaning any mutation would affect all subsequent responses.

This is a defense-in-depth concern: even if token stripping is added to the route handler, the cache must also be invalidated or the cached data structure must exclude secrets.

---

## 5. Suspected Findings (Require Dynamic Validation)

### S2.1: Agent Enumeration via `/api/agent-status` and `/api/config`

The `/api/agent-status` route auto-discovers agent IDs by listing directories under `~/.openclaw/agents/`. Combined with `/api/config`, an attacker can build a complete map of all deployed agents without any prior knowledge.

**Needs confirmation in Chunk 10 (Dynamic Verification).**

### S2.2: Session JSONL Content May Contain User Messages

The stats routes parse JSONL session files and extract token counts and timestamps. While they don't return message content in the response, the `agent-activity` route's subagent activity events include text snippets from assistant messages (truncated to 80 chars). These may contain user conversation fragments.

**Needs validation in Chunk 6 (Heavy Parsers) and Chunk 8 (Client-Side Propagation).**

### S2.3: OpenClaw Package Path Probing

`lib/openclaw-paths.ts` tries up to 13 filesystem paths to locate the OpenClaw package. The successful path is cached and used to read skill files. An attacker who can control `OPENCLAW_PACKAGE_DIR` or `npm_config_prefix` environment variables could redirect skill reads to arbitrary directories.

**Environment variable control is unlikely in a Docker deployment but possible in shared-host scenarios. Low priority.**

---

## 6. Data Leakage Summary Table

| Endpoint | Data Exposed | Auth Required | Severity |
|----------|-------------|---------------|----------|
| `/api/config` | Gateway token, platform IDs, agent config, provider list, model inventory | None | Critical |
| `/api/gateway-health` | Tokenized gateway URL, OpenClaw version, health status | None | Critical |
| `/api/sessions/[agentId]` | Session keys with platform user IDs, token counts, activity timestamps | None | High |
| `/api/skills` | Skill names, descriptions, absolute filesystem paths | None | Medium |
| `/api/skills/content` | Full skill file contents | None | Medium |
| `/api/agent-activity` | Agent state, subagent details, cron job payloads/errors | None | Medium |
| `/api/agent-status` | Agent online/offline state with timestamps | None | Low |
| `/api/stats-all` | Aggregated daily/weekly/monthly token usage | None | Low |
| `/api/stats/[agentId]` | Per-agent token usage patterns | None | Low |
| All routes (error case) | Absolute filesystem paths in error messages | None | Low |

---

## 7. Open Questions

| # | Question |
|---|----------|
| Q1 | Does the `/api/config` response intentionally include the gateway token for client-side gateway URL construction, or is it an oversight? |
| Q2 | Are custom skills expected to contain sensitive operational data (API keys, internal URLs, etc.)? |
| Q3 | Should the `location` field (absolute path) be stripped from skill listings before returning to the client? |
| Q4 | Is the `agentId` path segment validated anywhere upstream (e.g., Next.js routing) or is raw user input passed through? |

---

## 8. Remediation Priorities from This Chunk

1. **Strip `gateway.token`** from `/api/config` responses entirely, or gate behind auth.
2. **Strip `webUrl`** from `/api/gateway-health` responses (or remove the token from the URL).
3. **Validate `agentId`** path segments against a strict pattern (alphanumeric + hyphens, no slashes or dots).
4. **Strip `location`** field from `/api/skills` responses.
5. **Sanitize error messages** to remove filesystem paths before returning to clients.
6. **Redact platform user IDs** from session key data, or gate session endpoints behind auth.
7. **Strip cron job payloads** from `/api/agent-activity` responses, or limit to job status only.
