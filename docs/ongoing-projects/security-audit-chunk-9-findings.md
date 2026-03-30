# Chunk 9 Findings: Secondary API Surface and Lower-Risk Routes

Date: 2026-03-30
Auditor: Cursor (automated)
Status: **Complete**

---

## 1. Files Reviewed

| File | Purpose |
|------|---------|
| `app/api/agent-status/route.ts` | Agent activity status -- enumerates all agent directories, reads `sessions.json` and recent JSONL files, computes per-agent state (working/online/idle/offline) |
| `app/api/skills/route.ts` | Skill listing -- delegates to `listOpenclawSkills()` which scans builtin, extension, and custom skill directories; returns metadata including absolute filesystem paths |
| `app/api/pixel-office/contributions/route.ts` | GitHub contributions -- uses `execSync` to extract GitHub username from git remote, fetches contribution calendar HTML from github.com, parses and returns weekly contribution data |
| `app/api/pixel-office/version/route.ts` | Release version -- fetches latest release from GitHub API for `OPENCLAW_REPO`, optionally sends `GITHUB_TOKEN` in outbound request, supports `?force=1` cache bypass |
| `app/api/pixel-office/tracks/route.ts` | Audio track listing -- reads `public/assets/pixel-office/` directory, returns paths to all `.mp3` files |

Supporting files also examined:

| File | Relevance |
|------|-----------|
| `lib/openclaw-skills.ts` | `listOpenclawSkills()` implementation -- scans multiple skill directories, reads SKILL.md frontmatter, reads JSONL sessions for skill-to-agent mapping, parses `openclaw.json` config |
| `lib/openclaw-paths.ts` | Path constants including `OPENCLAW_HOME` (env-controllable), `OPENCLAW_CONFIG_PATH`, `getOpenclawPackageCandidates()` |

---

## 2. Threat Model Summary for This Surface

The five remaining API routes form a reconnaissance and metadata surface. While none perform state-changing operations or send outbound messages, they collectively expose:

1. **Operational timing intelligence.** `/api/agent-status` reveals all agent IDs and their real-time activity states with enough granularity to distinguish "actively processing a message right now" from "idle for 24 hours". This enables an attacker to time destructive actions for periods of minimal monitoring.

2. **Operator identity disclosure.** `/api/pixel-office/contributions` extracts the GitHub username from the server's git remote configuration and returns it alongside contribution activity patterns. Combined with the agent status endpoint, an attacker can correlate bot activity with the operator's GitHub commit schedule.

3. **Software version fingerprinting.** `/api/pixel-office/version` returns the exact OpenClaw release tag, publication date, and full release notes body. This enables targeted exploitation of known vulnerabilities in specific versions.

4. **Internal filesystem topology.** `/api/skills` (via `listOpenclawSkills()`) returns absolute filesystem paths for every skill file, revealing the installation location, package manager layout, and custom skill directory structure. This was previously documented in Chunks 2 and 5 but this route is the direct entry point.

5. **Outbound request surface.** Two routes make outbound HTTP requests -- one to `github.com` (contributions HTML) and one to `api.github.com` (releases API). The version endpoint sends `GITHUB_TOKEN` when present and supports a cache bypass that enables rate limit exhaustion.

None of these routes require authentication.

---

## 3. Trust Boundaries and Attacker-Controlled Inputs

| Input | Where Set | How Used | Risk |
|-------|-----------|----------|------|
| No user-supplied parameters | `/api/agent-status` | N/A -- all data comes from filesystem | Attacker controls only the ability to call the endpoint repeatedly |
| No user-supplied parameters | `/api/skills` | N/A -- delegates to `listOpenclawSkills()` | Attacker receives all skill metadata and filesystem paths |
| No user-supplied parameters | `/api/pixel-office/contributions` | `execSync("git remote get-url origin")` reads git config; result used to construct `github.com` URL | Git remote URL is trusted; if repository `.git/config` is tampered, outbound request target changes |
| `?force=1` query parameter | `/api/pixel-office/version` (line 31) | Bypasses 1-hour server-side cache; triggers fresh GitHub API request | Attacker-controlled: repeated calls exhaust GitHub API rate limit |
| `process.env.OPENCLAW_REPO` | `/api/pixel-office/version` (line 3) | Controls which GitHub repo is queried for releases | Environment variable trusted; if redirected (F5.5), version data comes from attacker-chosen repo |
| `process.env.GITHUB_TOKEN` | `/api/pixel-office/version` (line 14) | Sent as `Authorization: Bearer` header to `api.github.com` | Credential in transit; intended behavior but token value depends on env integrity |

---

## 4. Confirmed Findings

### F9.1: Agent Status Endpoint Discloses All Agent IDs, States, and Activity Timestamps Without Auth (Medium)

**Severity: Medium**
**File:** `app/api/agent-status/route.ts` (lines 79-96)

The `/api/agent-status` endpoint enumerates all agent directories from `OPENCLAW_HOME/agents/` and returns their operational state and last activity timestamp:

```javascript
const agentIds = fs.readdirSync(agentsDir, { withFileTypes: true })
  .filter(d => d.isDirectory() && !d.name.startsWith("."))
  .map(d => d.name);

const statuses = agentIds.map(id => getAgentState(id));
return NextResponse.json({ statuses });
```

The response includes per-agent:
- `agentId`: internal identifier
- `state`: one of `working`, `online`, `idle`, `offline` (lines 11, 64-74)
- `lastActive`: Unix timestamp of most recent activity (line 17)

**Issues:**
- Agent IDs are enumerated from the filesystem with no filtering beyond hidden directories
- The `working` vs `online` distinction (2-minute vs 10-minute threshold, lines 67-69) reveals whether the bot is actively processing a request *right now*
- `lastActive` timestamps allow an attacker to build a timeline of bot usage patterns
- Combined with F2.1 (config with token) and F3.1 (model change), an attacker can time config changes for idle periods when monitoring is least likely to catch them

**Cross-references:** F2.1 (config disclosure), F3.3 (alert suppression)

### F9.2: `execSync` Shell Invocation for Git Command in Contributions Endpoint (Medium)

**Severity: Medium**
**File:** `app/api/pixel-office/contributions/route.ts` (lines 9-18)

The `getGitHubUsername()` function uses `execSync` to run a git command:

```javascript
function getGitHubUsername(): string | null {
  try {
    const url = execSync("git remote get-url origin", { encoding: "utf-8" }).trim();
    const sshMatch = url.match(/github\.com[:/]([^/]+)\//);
    if (sshMatch) return sshMatch[1];
    const httpsMatch = url.match(/github\.com\/([^/]+)\//);
    if (httpsMatch) return httpsMatch[1];
  } catch {}
  return null;
}
```

**Issues:**
- `execSync` spawns a full shell (`/bin/sh -c "..."`) rather than calling `git` directly via `execFile`
- Shell startup files (`.bashrc`, `.profile`, `/etc/profile.d/*`) execute during shell invocation
- A manipulated `PATH` environment variable could redirect execution to a malicious `git` binary
- The synchronous call blocks the Node.js event loop for the duration of the shell + git execution
- The entire codebase otherwise uses `execFile` for process execution (positive pattern from Chunks 3-5); this is the only `execSync` usage

**Mitigations:** The command string is hardcoded with no user-controlled input; exploitation requires prior compromise of the server environment.

**Cross-references:** F5.2 (Windows `quoteShellArg` issues -- different code path but same category of shell concerns)

### F9.3: GitHub Username and Contribution Patterns Disclosed Without Auth (Low)

**Severity: Low**
**File:** `app/api/pixel-office/contributions/route.ts` (lines 23-63, 66-83)

The `/api/pixel-office/contributions` endpoint extracts the operator's GitHub username from the server's git remote and returns it in the response:

```javascript
return { weeks: trimmed, username };
```

**Exposed data:**
- GitHub username of the repository owner/operator
- 52 weeks of contribution activity levels (4 granularity levels per day)
- Contribution patterns that correlate with the operator's work schedule

**Impact:** Reveals the real identity behind the OpenClaw deployment and provides behavioral pattern data. The username can be used to find the operator's public repositories, social profiles, and organizational affiliations.

### F9.4: Version Endpoint Cache Bypass Enables GitHub API Rate Limit Exhaustion (Medium)

**Severity: Medium**
**File:** `app/api/pixel-office/version/route.ts` (lines 29-41)

The `?force=1` query parameter bypasses the 1-hour server-side cache:

```javascript
export async function GET(request: Request) {
  const forceLatest = new URL(request.url).searchParams.get("force") === "1";
  if (!forceLatest && cache && Date.now() - cache.ts < CACHE_TTL) {
    return NextResponse.json(cache.data);
  }
  const data = await fetchLatestRelease(forceLatest);
```

**Issues:**
- Each `?force=1` request triggers a fresh outbound `fetch` to `api.github.com`
- Unauthenticated GitHub API allows 60 requests per hour per IP; an attacker can exhaust this quota in seconds
- If `GITHUB_TOKEN` is set, the authenticated rate limit (5,000/hour) is still finite and exhaustible
- Rate limit exhaustion blocks all GitHub API calls from the server, affecting any other service or route that depends on the GitHub API
- No server-side rate limiting, authentication, or abuse detection on the endpoint
- The `forceLatest` flag also sets `cache: "no-store"` on the outbound request (line 16), preventing HTTP-level caching

**Exploit scenario:** `for i in $(seq 1 100); do curl "http://target/api/pixel-office/version?force=1" & done` exhausts the rate limit in under a minute.

### F9.5: GitHub Token Transmitted in Outbound Requests (Low)

**Severity: Low**
**File:** `app/api/pixel-office/version/route.ts` (lines 11-17)

```javascript
async function fetchLatestRelease(forceLatest = false) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: {
      Accept: "application/vnd.github+json",
      ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
    },
```

**Issues:**
- `GITHUB_TOKEN` is sent as a Bearer token to `api.github.com` on every non-cached request
- The destination URL incorporates `OPENCLAW_REPO` (default: `"openclaw/openclaw"`), which is env-controllable
- While the host is always `api.github.com` (token won't leak to a non-GitHub host), an attacker who controls `OPENCLAW_REPO` can direct authenticated requests to arbitrary GitHub repositories, potentially revealing private repo release data if the token has broad scopes
- Combined with F9.4 (`?force=1`), an attacker can trigger many authenticated requests consuming the token's rate limit

**Mitigations:** The outbound host is hardcoded to `api.github.com`; token leakage to non-GitHub hosts is not possible through this code path alone.

### F9.6: Release Metadata Disclosed Without Auth (Low)

**Severity: Low**
**File:** `app/api/pixel-office/version/route.ts` (lines 20-27)

The endpoint returns detailed release information:

```javascript
return {
  tag: data.tag_name,
  name: data.name || data.tag_name,
  publishedAt: data.published_at,
  body: data.body || "",
  htmlUrl: data.html_url,
};
```

**Issues:**
- Exact version tag enables targeted exploitation of known CVEs in specific releases
- Release body (`data.body`) may contain internal changelog details, migration notes, security fix descriptions, or contributor information not intended for anonymous visitors
- `publishedAt` reveals the update cadence (how frequently the operator updates)
- Combined with F8.7 (sidebar version display), provides version information through two independent channels

**Cross-references:** F8.7 (OpenClaw version in sidebar DOM)

### F9.7: Skill Listing Route Re-exposes Absolute Filesystem Paths Without Auth (Medium)

**Severity: Medium**
**Files:** `app/api/skills/route.ts` (lines 4-10), `lib/openclaw-skills.ts` (lines 49-61, 111-151)

The `/api/skills` endpoint delegates to `listOpenclawSkills()`, which returns the `location` field for each skill:

```javascript
// openclaw-skills.ts line 53-59
return {
  id,
  name: fm.name || id,
  description: fm.description || "",
  emoji: fm.emoji || "🔧",
  source,
  location: skillMd,  // absolute filesystem path
  usedBy: [],
};
```

The response also includes:
- Skill-to-agent mapping (which agents use which skills) derived from JSONL session scanning (lines 74-109)
- Agent identity information (name, emoji) parsed from `openclaw.json` config (lines 140-148)
- Skill source classification (`builtin`, `extension:*`, `custom`) revealing installation structure

**Issues:**
- Absolute paths like `/home/krox/.local/lib/node_modules/openclaw/skills/browser/SKILL.md` reveal the home directory, username, package manager layout, and Node.js installation path
- The skill-to-agent mapping reveals which agents have which capabilities (e.g., which agent has browser access, which can send messages)
- The `listOpenclawSkills()` function reads `openclaw.json` config to build the agent list, performing a secondary config parse on every call

**Cross-references:** F2.4 (absolute paths in skill content), F5.3 (skill content gated by enumeration)

### F9.8: Synchronous I/O in Agent Status Blocks Event Loop (Low)

**Severity: Low**
**File:** `app/api/agent-status/route.ts` (lines 19-77)

The `getAgentState` function uses synchronous filesystem calls throughout:

- `fs.readFileSync` for `sessions.json` (line 28)
- `fs.readdirSync` for session directory listing (line 38)
- `fs.statSync` for file modification times (line 40)
- `fs.readFileSync` for each of up to 5 JSONL files (line 48)

These run once per agent, and the outer `GET` handler calls `getAgentState` for every discovered agent (line 91). With *N* agents, the endpoint performs at minimum *N* directory reads + *N* JSON parses + up to *5N* file stats + up to *5N* JSONL reads.

**Issues:**
- All I/O is synchronous, blocking the Node.js event loop for the full duration
- The endpoint has no cache -- every request rescans the filesystem
- Combined with F9.4 (no rate limiting on any Chunk 9 route), repeated calls create sustained event loop blocking

**Cross-references:** F6.2 (synchronous I/O pattern in stats endpoints), F6.3 (no caching on heavy endpoints)

### F9.9: Error Messages Leak Internal Details Across All Chunk 9 Routes (Low)

**Severity: Low**
**Files:** `app/api/agent-status/route.ts` (line 94), `app/api/skills/route.ts` (line 8), `app/api/pixel-office/version/route.ts` (line 39)

Three of the five routes return raw `err.message` in error responses:

```javascript
return NextResponse.json({ error: err.message }, { status: 500 });
```

**Issues:**
- Filesystem errors may include absolute paths (e.g., `ENOENT: no such file or directory, open '/home/krox/.openclaw/agents/...'`)
- GitHub API errors may include rate limit details, token validity information, or HTTP response bodies
- JSON parse errors may include content fragments from malformed files
- These error messages are returned to unauthenticated callers

The remaining two routes (`contributions`, `tracks`) silently return fallback data on error, which is a better pattern.

---

## 5. Suspected Findings (Require Dynamic Validation)

### S9.1: `execSync` May Execute Shell Startup Files Containing Sensitive Output

The `execSync("git remote get-url origin")` call in contributions/route.ts spawns `/bin/sh`, which may source startup files depending on shell configuration. If any startup file produces output to stdout (e.g., MOTD, version banners, debug logging), that output would be prepended to the `git` command output and potentially match the URL regex unexpectedly or cause a parsing failure that leaks the combined output in an error message.

**Needs validation in Chunk 10:** Run the contributions endpoint and inspect whether shell startup files produce any output that interferes with the git command result.

### S9.2: GitHub Contribution HTML Format Changes Could Cause Error-Path Information Leakage

The contribution parser uses regex to extract `data-date` and `data-level` attributes from GitHub's HTML contribution calendar. If GitHub changes the HTML structure, the regex fails silently and the endpoint returns 502 with `{ error: "fetch failed" }`. However, if the HTML response itself contains unexpected content that causes an exception in the processing logic (rather than zero regex matches), the error path may leak the HTML content or processing details.

**Needs validation in Chunk 10:** Inspect the actual GitHub HTML response format and verify that all failure modes produce safe error responses.

### S9.3: Contribution Activity Patterns Correlate With Operator Schedule for Attack Timing

The 52-week contribution calendar returned by `/api/pixel-office/contributions` reveals the operator's typical work schedule (active days, frequency, gaps). Combined with F9.1 (agent status showing real-time activity), an attacker can build a comprehensive model of when the system is actively monitored versus unattended.

**Needs validation in Chunk 10:** Determine whether the contribution data granularity is sufficient to identify consistent schedule patterns (e.g., weekend gaps, vacation periods) that would meaningfully improve attack timing.

---

## 6. Exploit Chain Summary

### Chain 1: Complete Reconnaissance Without Auth (Cross-Chunk)

```
1. GET /api/config
   → gateway token, all agent metadata, platform IDs, provider list (F2.1)

2. GET /api/agent-status
   → all agent IDs, which are active right now, last activity times (F9.1)

3. GET /api/skills
   → all skill names, filesystem paths, which agent has which capabilities (F9.7)

4. GET /api/pixel-office/contributions
   → operator's GitHub username and 52-week activity pattern (F9.3)

5. GET /api/pixel-office/version
   → exact OpenClaw version, release date, changelog (F9.6)

Total: 5 unauthenticated GET requests = complete system reconnaissance
   (identity, capabilities, version, credentials, activity schedule)
```

### Chain 2: Attack Timing via Activity Correlation

```
1. GET /api/agent-status → agent "main" state = "idle", lastActive = 6 hours ago
   → operator is likely away

2. GET /api/pixel-office/contributions → weekend gap pattern confirmed
   → operator rarely works on weekends

3. Attacker waits for Saturday night + "idle" state confirmation

4. Execute destructive chain from Chunk 7 (F7.9 kill chain):
   PATCH /api/config/agent-model → downgrade model
   POST /api/alerts → disable monitoring
   POST /api/test-dm-sessions → send spam to all users
   → maximum damage window before operator notices
```

### Chain 3: GitHub API Denial of Service

```
1. Attacker sends 60+ rapid requests to /api/pixel-office/version?force=1
   → exhausts unauthenticated GitHub API rate limit (F9.4)

2. All server-side GitHub API calls fail for up to 1 hour
   → version check returns 500 errors
   → any other GitHub-dependent functionality breaks

3. If GITHUB_TOKEN is set: attacker sends 5000+ requests
   → exhausts authenticated rate limit
   → broader impact on any service sharing that token
```

---

## 7. Positive Security Observations

| Pattern | Where | Assessment |
|---------|-------|------------|
| 24-hour cache on contributions endpoint | `contributions/route.ts` line 6 | **Good.** Limits outbound request volume; only one GitHub fetch per 24 hours under normal use. |
| 1-hour cache on version endpoint | `version/route.ts` lines 7-8 | **Good.** Reduces GitHub API calls for normal usage. Undermined by `?force=1` bypass. |
| Recent-file-only scanning in agent status | `agent-status/route.ts` lines 42-46 | **Good.** Only inspects 5 most recent JSONL files and skips files older than 3 minutes. Limits scan scope. |
| Line count bounded in JSONL scan | `agent-status/route.ts` line 51 | **Good.** Backward scan limited to 20 lines per file. Prevents full-file parsing. |
| `.mp3` extension filter on tracks | `tracks/route.ts` line 9 | **Good.** Only returns `.mp3` files, not arbitrary directory contents. |
| Abort controller with 10-second timeout | `contributions/route.ts` lines 24-25 | **Good.** Outbound GitHub fetch times out after 10 seconds, preventing indefinite hangs. |
| `listOpenclawSkills` uses enumerated directory scanning | `openclaw-skills.ts` lines 64-71 | **Partial.** Scans known skill directories by name, not arbitrary paths. But returns absolute `location` paths in the response. |
| Contributions endpoint returns 404 when no username found | `contributions/route.ts` lines 72-74 | **Good.** Fails cleanly rather than making a request with a null username. |

---

## 8. Open Questions

| # | Question |
|---|----------|
| Q1 | Is the agent status endpoint intended for polling by the UI? If so, is the synchronous I/O pattern acceptable given the expected number of agents? |
| Q2 | Should the `?force=1` parameter on the version endpoint be removed or protected? It exists presumably for manual refresh but enables rate limit exhaustion. |
| Q3 | Is the `GITHUB_TOKEN` environment variable scoped to read-only public repo access, or does it have broader permissions? Broader scopes increase the impact of F9.5. |
| Q4 | Is the GitHub contribution calendar feature essential, or decorative? If decorative, removing it eliminates the `execSync` usage and operator identity disclosure. |
| Q5 | Should skill `location` (absolute filesystem path) be stripped from the `/api/skills` response? The client likely only needs `id`, `name`, `description`, and `emoji`. |

---

## 9. Remediation Priorities from This Chunk

1. **Strip absolute filesystem paths from skill listing response** (F9.7). The `location` field should not be returned to the client. If the client needs to fetch skill content, it should use `source` + `id` as a reference key, which is already supported by `/api/skills/content`.

2. **Remove or protect the `?force=1` cache bypass** (F9.4). Either remove the parameter entirely (the 1-hour cache is reasonable) or require authentication. As a minimal mitigation, add a per-IP rate limit of 1 forced refresh per hour.

3. **Replace `execSync` with `execFile`** (F9.2). Change `execSync("git remote get-url origin")` to `execFileSync("git", ["remote", "get-url", "origin"])` to avoid shell invocation. This aligns with the pattern used throughout `openclaw-cli.ts`.

4. **Add authentication to all Chunk 9 endpoints** (systemic). All 5 routes return data that assists reconnaissance. At minimum, apply the same authentication mechanism planned for higher-severity routes.

5. **Remove `username` from contributions response** (F9.3). The client needs the weekly contribution data for the visual display but does not need the GitHub username. Strip it from the response.

6. **Sanitize error messages** (F9.9). Replace `err.message` with generic error strings in production. Log the detailed error server-side for debugging.

7. **Convert agent status to async I/O** (F9.8). Replace `readFileSync`/`readdirSync`/`statSync` with their async counterparts (`readFile`/`readdir`/`stat`) to avoid blocking the event loop. Add a short-TTL cache (30-60 seconds) to avoid repeated filesystem scans.

8. **Add rate limiting to version endpoint** (F9.4). Even without removing `?force=1`, a rate limit of ~1 request per minute per IP would prevent rapid rate limit exhaustion.

9. **Consider removing the version and contributions endpoints entirely** if they serve only cosmetic purposes. The pixel-office feature appears decorative, and these endpoints expand the attack surface for limited functional value.

---

## 10. Cumulative Route Coverage

With Chunk 9 complete, all 25 API route files have been reviewed:

| Chunk | Routes Reviewed |
|-------|----------------|
| 1 | (Threat model -- no routes) |
| 2 | `config`, `gateway-health`, `skills/content`, `sessions/[agentId]` |
| 3 | `config/agent-model`, `alerts`, `alerts/check`, `pixel-office/layout` |
| 4 | `test-platforms`, `test-sessions`, `test-dm-sessions`, `test-session`, `test-model`, `test-bound-models` |
| 5 | (Library review -- no routes) |
| 6 | `agent-activity`, `config` (re-review), `stats-all`, `stats/[agentId]`, `stats-models`, `activity-heatmap`, `pixel-office/idle-rank` |
| 7 | `alerts/check` (re-review) |
| 8 | (Client-side review -- no routes) |
| **9** | **`agent-status`, `skills`, `pixel-office/contributions`, `pixel-office/version`, `pixel-office/tracks`** |

All 25 `app/api/**/route.ts` files are now covered. The audit proceeds to Chunk 10 (Dynamic Verification).
