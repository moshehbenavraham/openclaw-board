# Chunk 6 Findings: Heavy Parsers, Session Analytics, and DoS Risk

Date: 2026-03-30
Auditor: Cursor (automated)
Status: **Complete**

---

## 1. Files Reviewed

| File | Purpose |
|------|---------|
| `app/api/agent-activity/route.ts` | Per-agent activity state (idle/working/offline), subagent tracking via JSONL transcript parsing, cron job status inference from transcript + store |
| `app/api/config/route.ts` | Full dashboard config: agent list, platforms, providers, session stats; calls `getAgentSessionStatus` which reads all 7-day JSONL files synchronously |
| `app/api/stats-all/route.ts` | Aggregate daily/weekly/monthly token and response-time stats across all agents; parallel JSONL reads |
| `app/api/stats/[agentId]/route.ts` | Per-agent stats with `agentId` from URL path segment; synchronous JSONL reads |
| `app/api/stats-models/route.ts` | Per-model token and response-time stats across all agents; parallel JSONL reads; double parse per file |
| `app/api/activity-heatmap/route.ts` | 7×24 activity grid per agent (day-of-week × hour); synchronous full JSONL scans |
| `app/api/pixel-office/idle-rank/route.ts` | Per-agent online/active/idle minute calculations; synchronous full JSONL scans |

Supporting files analyzed (shared infrastructure):

| File | Relevance |
|------|-----------|
| `lib/config-cache.ts` | Global in-memory config cache; no per-origin isolation; shared by all callers |
| `lib/json.ts` | `readJsonFileSync` / `readJsonFile` -- no file size checks (cross-ref F5.6) |
| `lib/openclaw-paths.ts` | Path constants; no boundary enforcement (cross-ref F5.1) |

---

## 2. Threat Model Summary for This Surface

These seven endpoints form the **analytics and monitoring surface** of the dashboard. They share a common pattern:

1. **Enumerate agents** from config or directory listing
2. **Enumerate session files** per agent from `~/.openclaw/agents/<id>/sessions/`
3. **Read entire JSONL files** into memory
4. **Parse every line** via `JSON.parse()`
5. **Aggregate results** and return JSON

The security concern is not data mutation (these are read-only endpoints) but **resource exhaustion**: each endpoint can trigger unbounded filesystem I/O, CPU-intensive JSON parsing, and memory-proportional data loading from a single unauthenticated HTTP request. Combined with the zero-authentication posture (F1.3), any network caller can repeatedly trigger these expensive operations.

**Key architectural observations:**
- **No caching on the two heaviest endpoints:** `/api/agent-activity` and `/api/stats/[agentId]` have no server-side cache. Every request triggers a full filesystem scan.
- **Synchronous I/O in 4 of 7 endpoints** blocks the Node.js event loop, stalling all concurrent requests.
- **No rate limiting** on any endpoint.
- **No file size or file count bounds** on any read path.
- **Cascading reads** in `agent-activity`: sessions → subagent transcripts → cron transcripts, multiplying I/O per request.

**Estimated worst-case single-request I/O:**

| Endpoint | Agents | Files per Agent | Read Mode | Estimated I/O |
|---|---|---|---|---|
| `agent-activity` | All | Up to 40 parent sessions + N subagent transcripts + cron transcripts | Async, cascading | 200+ file reads |
| `config` | All | All 7-day JSONL files | Synchronous | 50+ file reads (blocking) |
| `stats-all` | All | All JSONL files | Async parallel | 100+ file reads |
| `stats/[agentId]` | 1 | All JSONL files | Synchronous | 30+ file reads (blocking) |
| `stats-models` | All | All JSONL files (×2 parse passes) | Async parallel | 100+ reads, 200+ parses |
| `activity-heatmap` | All | All JSONL files | Synchronous | 100+ file reads (blocking) |
| `idle-rank` | All | All JSONL files | Synchronous | 100+ file reads (blocking) |

---

## 3. Trust Boundaries and Attacker-Controlled Inputs

| Input Source | Endpoint | How Propagated | Risk |
|---|---|---|---|
| `agentId` from URL path segment | `/api/stats/[agentId]` | `path.join(OPENCLAW_HOME, \`agents/${agentId}/sessions\`)` | Path traversal (cross-ref F2.7, F5.1) |
| `config.cron.store` from `openclaw.json` | `/api/agent-activity` via `resolveCronStorePath` | `path.resolve(raw)` -- reads arbitrary JSON file from disk | File read primitive if config tampered via F3.1 |
| HTTP request timing | All 7 endpoints | Caller controls when cache-miss scans are triggered | DoS timing; thundering herd on cache expiry |
| Total session data on disk | All 7 endpoints | File count and size determine memory/CPU cost per request | Attacker who grew session data (F4.1, F4.3) amplifies DoS |
| `cron/jobs.json` content | `/api/agent-activity` | `job.payload.message`, `job.state.lastError` exposed in response | Cron payload leakage (cross-ref F2.4) |

---

## 4. Confirmed Findings

### F6.1: Agent-Activity Endpoint Has No Cache and Performs Cascading Unbounded Reads (High)

**Severity: High**
**File:** `app/api/agent-activity/route.ts`, lines 7-8 (cache disabled), 636-716 (cascading reads)

The `/api/agent-activity` endpoint is the heaviest endpoint in the application and has **no server-side caching**:

```typescript
export const dynamic = 'force-dynamic'
export const revalidate = 0
```

Every request triggers a multi-level cascade of filesystem reads:

**Level 1 -- Agent enumeration:**
For each agent, stat every file in the sessions directory to find `lastActive` (lines 794-805):

```typescript
const files = await fs.readdir(agentSessionsDir)
for (const file of files) {
  const filePath = path.join(agentSessionsDir, file)
  const stat = await fs.stat(filePath)
  if (stat.mtimeMs > lastActive) lastActive = stat.mtimeMs
}
```

**Level 2 -- Parent session parsing:**
For "online" agents, `parseSubagents` reads up to `MAX_PARENT_SESSIONS_TO_PARSE` (40) full JSONL files (line 702):

```typescript
const candidates = sessionFiles.slice(0, MAX_PARENT_SESSIONS_TO_PARSE)
const nested = await Promise.all(candidates.map((s) =>
  parseSubagentsFromSessionFile(agentSessionsDir, s.filePath, s.sessionKey, sessionsIndex)
))
```

Each parent session file is read entirely into memory and every line is `JSON.parse()`d (lines 518-519).

**Level 3 -- Subagent transcript parsing:**
For each discovered subagent, `parseSubagentActivityEvents` reads the child session transcript file entirely (line 408):

```typescript
const content = await fs.readFile(transcriptPath, 'utf8')
const lines = content.split('\n').filter(l => l.trim())
```

**Level 4 -- Cron job transcript parsing:**
For each cron job, `parseCronJobs` reads the cron session transcript (line 746):

```typescript
const transcript = await fs.readFile(transcriptPath, 'utf8')
```

**Total I/O for a single request** with 3 agents, each having 40 parent sessions, 5 active subagents, and 10 cron jobs:
- 3 × (dir listing + N file stats) for mtime scan
- 3 × 40 = 120 full JSONL file reads (parent sessions)
- 3 × 5 = 15 full JSONL file reads (subagent transcripts)
- 3 × 10 = 30 full JSONL file reads (cron transcripts)
- Total: **165+ file reads, every request, with no caching**

No file size limits apply to any of these reads. Session files can grow to tens of MB over extended conversations.

**Impact:**
- Unauthenticated caller can trigger expensive multi-second filesystem scans at will
- No rate limiting; rapid-fire requests multiply the load linearly
- Node.js process memory grows proportionally to total session data loaded
- Under concurrent load, the event loop is saturated with I/O callbacks and JSON parsing

### F6.2: Path Traversal in `/api/stats/[agentId]` via Unvalidated URL Segment (High)

**Severity: High**
**File:** `app/api/stats/[agentId]/route.ts`, lines 17, 96-98
**Cross-ref:** F2.7, F5.1

The `agentId` parameter comes directly from the URL path and is used in filesystem path construction without validation:

```typescript
function parseSessions(agentId: string): Omit<DayStat, "responseTimes">[] {
  const sessionsDir = path.join(OPENCLAW_HOME, `agents/${agentId}/sessions`);
  // ...
  files = fs.readdirSync(sessionsDir).filter(f => f.endsWith(".jsonl") && !f.includes(".deleted."));
```

```typescript
export async function GET(_req: Request, { params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  const daily = parseSessions(agentId);
```

An attacker can request `/api/stats/../../.openclaw` to read and parse JSONL-like files from arbitrary directories. While the `.endsWith(".jsonl")` filter limits which files are read, `readdirSync` on the traversed directory reveals filenames, and any `.jsonl` files found are read entirely and their JSON content parsed and returned in the response.

**Attack example:**
```
GET /api/stats/../../some-directory-with-jsonl-files
```

This is the same root cause as F2.7 (no centralized `resolveAgentPath` utility, as recommended in F5.1). The `agentId` flows into `path.join(OPENCLAW_HOME, \`agents/${agentId}/sessions\`)`, and `path.join` normalizes `..` segments.

**Impact:**
- Directory listing of arbitrary directories (via error messages or response shape)
- Contents of `.jsonl` files outside the agents directory parsed and returned
- Overlaps with F2.7 but this instance was not listed there; adds another route to the path traversal surface

### F6.3: All Seven Endpoints Perform Unbounded Filesystem Scans Without Rate Limiting (High)

**Severity: High**
**Files:** All seven primary files

Every endpoint in this chunk follows the same pattern: enumerate agents, then read all (or many) session JSONL files per agent, parsing every line. None enforce:

- **File count limit:** No cap on how many files are read per agent or per request
- **File size limit:** No `stat()` check before `readFileSync`/`readFile`; files of any size are loaded entirely into memory
- **Request rate limiting:** No middleware or per-endpoint throttle
- **Concurrency limiting:** No semaphore or queue bounds concurrent scan requests

| Endpoint | Cache | Blocking I/O | Files Read |
|---|---|---|---|
| `/api/agent-activity` | **None** | Async (cascading) | All parent sessions + subagent + cron transcripts |
| `/api/config` | 30s | **Synchronous** | All 7-day JSONL files |
| `/api/stats-all` | 30s | Async parallel | All JSONL files for all agents |
| `/api/stats/[agentId]` | **None** | **Synchronous** | All JSONL files for one agent |
| `/api/stats-models` | 30s | Async parallel | All JSONL files for all agents (parsed twice) |
| `/api/activity-heatmap` | 5min | **Synchronous** | All JSONL files for all agents |
| `/api/pixel-office/idle-rank` | 5min | **Synchronous** | All JSONL files for all agents |

**Impact:**
- An attacker sending requests to multiple endpoints simultaneously multiplies the filesystem load
- Endpoints without caching (`agent-activity`, `stats/[agentId]`) are particularly vulnerable
- Even cached endpoints are vulnerable at cache boundaries -- first request after TTL expiry triggers the full scan
- An attacker who previously grew session data via test endpoints (F4.1, F4.3) amplifies the cost of each scan

**DoS cost estimate:**
If 3 agents have 50 JSONL files each averaging 500KB, a single cache-miss request to `/api/stats-all` loads ~75MB into memory. Sending 10 concurrent requests at cache expiry loads ~750MB. The process's default Node.js heap (1.5-4GB) can be exhausted with moderate concurrency.

### F6.4: Synchronous File I/O Blocks Node.js Event Loop in 4 of 7 Endpoints (Medium)

**Severity: Medium**
**Files:**
- `app/api/config/route.ts`, lines 43-58 (`getAgentSessionStatus`: `readdirSync`, `statSync`, `readFileSync`)
- `app/api/stats/[agentId]/route.ts`, lines 22-33, 29-32 (`readdirSync`, `readFileSync`)
- `app/api/activity-heatmap/route.ts`, lines 14-16, 28-33 (`readdirSync`, `statSync`, `readFileSync`)
- `app/api/pixel-office/idle-rank/route.ts`, lines 14-16, 34-42 (`readdirSync`, `statSync`, `readFileSync`)

These four endpoints use Node.js synchronous filesystem APIs within `async` route handlers:

```typescript
// config/route.ts -- getAgentSessionStatus
const allFiles = fs.readdirSync(sessionsDir).filter(f => f.endsWith(".jsonl") && !f.includes(".deleted."));
files = allFiles.filter(f => {
  try { return fs.statSync(path.join(sessionsDir, f)).mtimeMs >= cutoff; } catch { return false; }
});
// ...
try { content = fs.readFileSync(filePath, "utf-8"); } catch { continue; }
```

Node.js runs on a single event loop thread. Synchronous I/O calls block this thread entirely -- while one request is reading session files, **all other HTTP requests are stalled**, including health checks, other API calls, and WebSocket heartbeats.

**Amplification via `/api/config`:**
The `config` endpoint calls `getAgentSessionStatus` once per agent. Each call performs synchronous `readdirSync` + `statSync` (per file) + `readFileSync` (per recent file). With 3 agents and 50 files each, this is ~150 synchronous I/O operations blocking the event loop.

**Impact:**
- A single slow request blocks all other requests for its duration
- An attacker can cause visible UI freezes by targeting `/api/config` (which the dashboard polls regularly)
- Health monitoring endpoints become unresponsive during the block, potentially triggering false deployment restarts

### F6.5: Unbounded Parallel File Reads in Stats Endpoints Create Memory Spikes (Medium)

**Severity: Medium**
**Files:**
- `app/api/stats-all/route.ts`, lines 32-35
- `app/api/stats-models/route.ts`, lines 47-49

Both endpoints use `Promise.all` to read all session files simultaneously:

```typescript
// stats-all/route.ts
const fileContents = await Promise.all(fileNames.map(async (file) => {
  try { return await fs.promises.readFile(path.join(sessionsDir, file), "utf-8"); } catch { return null; }
}));
```

With no concurrency limit, all files for an agent are read into memory at once. Since this runs across all agents in parallel too (line 129: `Promise.all(agentIds.map(id => parseAgentSessions(id)))`), the total concurrent memory usage is proportional to the sum of all session file sizes across all agents.

**Impact:**
- Memory spikes proportional to total session data on disk
- File descriptor limits may be hit with many concurrent reads (default Linux limit: 1024 soft)
- Garbage collection pressure from transient string allocations causes stop-the-world pauses

### F6.6: `resolveCronStorePath` Follows Arbitrary Config-Sourced Filesystem Paths (Medium)

**Severity: Medium**
**File:** `app/api/agent-activity/route.ts`, lines 173-178
**Cross-ref:** F3.1 (unauthenticated config change)

```typescript
function resolveCronStorePath(config: any): string {
  const raw = typeof config?.cron?.store === 'string' ? config.cron.store.trim() : ''
  if (!raw) return path.join(OPENCLAW_HOME, 'cron', 'jobs.json')
  if (raw.startsWith('~')) return path.join(process.env.HOME || '', raw.slice(1))
  return path.resolve(raw)
}
```

The `cron.store` value from `openclaw.json` is resolved via `path.resolve()` with no validation. If an attacker tampers with the config file via F3.1 (setting `cron.store` to an absolute path), `resolveCronStorePath` will read and parse any JSON file on the filesystem that matches the `{ jobs: [...] }` shape.

Additionally, the `~` expansion (line 176) uses `process.env.HOME`, which could be manipulated in shared-host environments (cross-ref F5.4).

**Attack chain:**
1. Attacker changes config via gateway `config.patch` (F3.1): `"cron": { "store": "/etc/some-readable-json-file.json" }`
2. Next request to `/api/agent-activity` calls `loadCronJobs(config)`
3. `resolveCronStorePath` returns `/etc/some-readable-json-file.json`
4. File is read and parsed; if it contains a `jobs` array, individual entries' fields are extracted and returned in the API response

**Impact:**
- Arbitrary file read primitive (constrained to JSON files with a `jobs` array)
- Combined with F3.1, turns the unauthenticated config change into a file disclosure vulnerability

### F6.7: No Cache Thundering Herd Protection on Cached Endpoints (Low)

**Severity: Low**
**Files:**
- `app/api/stats-all/route.ts`, lines 7-8, 119-121
- `app/api/stats-models/route.ts`, lines 7-8, 25-28
- `app/api/config/route.ts`, lines 12, 257-260
- `app/api/activity-heatmap/route.ts`, lines 7-8, 63-65
- `app/api/pixel-office/idle-rank/route.ts`, lines 8-9, 83-85

All five cached endpoints use the same pattern:

```typescript
if (statsCache && Date.now() - statsCache.ts < CACHE_TTL_MS) {
  return NextResponse.json(statsCache.data);
}
// ... full scan ...
statsCache = { data, ts: Date.now() };
```

This is a check-then-act pattern with no locking. If N requests arrive simultaneously after the cache TTL expires, all N see the stale cache, all N trigger the full filesystem scan, and all N independently compute and write the result. Only the last writer's result is cached.

**Impact:**
- At cache boundaries, concurrent requests multiply the filesystem load by N
- Dashboard components that poll multiple endpoints simultaneously (e.g., page load fetching `config` + `stats-all` + `activity-heatmap`) create correlated cache-miss bursts
- An attacker who knows the cache TTLs can time requests to maximize concurrent scans

### F6.8: Double JSONL File Parsing in `stats-models/route.ts` (Low)

**Severity: Low**
**File:** `app/api/stats-models/route.ts`, lines 55-80 (first pass), 83-101 (second pass)

Each JSONL file is split by newlines and every line is `JSON.parse()`d twice in independent loops:

```typescript
// First pass: model token aggregation (lines 55-80)
const lines = content.trim().split("\n");
for (const line of lines) {
  let entry: any;
  try { entry = JSON.parse(line); } catch { continue; }
  // ... aggregate model tokens ...
}

// Second pass: response time calculation (lines 83-101)
for (const line of lines) {
  let entry: any;
  try { entry = JSON.parse(line); } catch { continue; }
  // ... calculate response times ...
}
```

Compare to `stats-all/route.ts` which performs both operations in a single pass (lines 43-81). The redundant parse doubles CPU cost and transient memory allocations per file.

**Impact:**
- Doubles JSON parsing CPU time for this endpoint
- Doubles transient GC pressure from intermediate parsed objects
- Not a vulnerability by itself, but amplifies the DoS cost of F6.3

### F6.9: Operational Intelligence Leakage via Unauthenticated Analytics Endpoints (Low)

**Severity: Low**
**Files:** All seven primary files
**Cross-ref:** F1.3 (no authentication)

All seven endpoints expose operational data without authentication:

| Endpoint | Data Exposed |
|---|---|
| `/api/agent-activity` | Agent states, active subagent names/labels, cron job IDs/names/payloads/errors, session keys |
| `/api/config` | Token usage per agent (daily/weekly), session counts, response times, platform bindings, model names, gateway token (F2.1) |
| `/api/stats-all` | Daily/weekly/monthly token counts and response times across all agents |
| `/api/stats/[agentId]` | Per-agent daily token breakdown |
| `/api/stats-models` | Per-model/per-provider token usage and response times |
| `/api/activity-heatmap` | Hourly activity patterns per agent (when the bot is active/dormant) |
| `/api/pixel-office/idle-rank` | Agent uptime, active time, idle percentage |

**Reconnaissance value:**
- Activity heatmap reveals when the bot (and its operator) are active/dormant -- useful for timing attacks to coincide with off-hours
- Model usage stats reveal which LLM providers are in use and their cost profile -- useful for targeted credit exhaustion (F4.7)
- Cron job names and payloads in agent-activity reveal scheduled automation (security checks, backups, etc.) -- useful for suppressing detection
- Response time trends reveal system load patterns -- useful for choosing optimal DoS timing

---

## 5. Suspected Findings (Require Dynamic Validation)

### S6.1: File Descriptor Exhaustion Under Concurrent Load

**Files:**
- `app/api/stats-all/route.ts`, lines 32-35
- `app/api/stats-models/route.ts`, lines 47-49

Both endpoints open all session files simultaneously via `Promise.all`. The Linux default soft limit for open file descriptors is 1024 (`ulimit -n`). With multiple agents each having 100+ session files, concurrent requests to these endpoints could exceed the file descriptor limit.

**Needs validation in Chunk 10 (Dynamic Verification):**
- Check `ulimit -n` in the Docker container / systemd service
- Measure peak concurrent file descriptors during a `/api/stats-all` request with production session data
- Confirm whether Node.js `EMFILE` errors are thrown and how they propagate (crash vs. graceful error)

### S6.2: Memory Exhaustion via Crafted Large JSONL Files

**Files:** All seven primary files (all perform unbounded file reads)
**Cross-ref:** F5.6 (unbounded file reads in bridge layer)

If an attacker can grow session JSONL files to extreme sizes (via repeated test-session calls per F4.3, or by exploiting path traversal to point reads at large files), the total memory consumed by a single request could exceed the Node.js heap limit.

**Scenario:**
1. Attacker sends 1000 requests to `/api/test-session` creating large session transcripts (F4.3)
2. Session files grow to 10MB+ each
3. Request to `/api/stats-all` loads all files for all agents into memory simultaneously
4. With 3 agents × 100 files × 10MB = 3GB, exceeding the default V8 heap (1.7GB)
5. Process crashes with `FATAL ERROR: CALL_AND_RETRY_LAST Allocation failed - JavaScript heap out of memory`

**Needs validation in Chunk 10 (Dynamic Verification):**
- Measure actual session file sizes in the production environment
- Confirm whether the Node.js heap limit in the Docker container is configured
- Test memory behavior of `/api/stats-all` with progressively larger session data

### S6.3: `toLocaleString` Timezone Conversion Performance Under Volume

**File:** `app/api/activity-heatmap/route.ts`, line 42

```typescript
const shanghai = new Date(dt.toLocaleString("en-US", { timeZone: "Asia/Shanghai" }));
```

This pattern creates a `Date` object from a locale-formatted string on every message line in every session file. `toLocaleString` is known to be slow in V8 (it calls into ICU for locale data). With thousands of messages across all agents, this may create measurable CPU overhead.

**Needs validation in Chunk 10 (Dynamic Verification):**
- Benchmark `toLocaleString` vs. manual UTC offset for Shanghai timezone
- Measure CPU time of `/api/activity-heatmap` with realistic session data volumes

---

## 6. Exploit Chain Summary

### Chain 1: Sustained Application DoS via Uncached Endpoints

```
1. Attacker identifies /api/agent-activity (no cache) and /api/stats/<agentId> (no cache)
2. Attacker sends rapid-fire requests to both endpoints concurrently
3. Each request to agent-activity triggers 100+ cascading file reads
4. Each request to stats/<agentId> triggers synchronous event-loop-blocking reads
5. Node.js event loop becomes saturated; all other requests time out
6. Dashboard UI becomes unresponsive; health checks fail; operator loses visibility
```

### Chain 2: Amplified DoS via Session Data Growth + Heavy Parser Triggering

```
1. Attacker grows session data via F4.1/F4.3 (unauthenticated test-session calls)
2. Session JSONL files accumulate; total data on disk grows to hundreds of MB
3. Attacker times requests to /api/stats-all and /api/stats-models at cache expiry
4. Both endpoints load ALL session data into memory simultaneously
5. Memory spikes above V8 heap limit → process crash (OOM kill)
6. Dashboard is down until container restarts; session data persists, so crash recurs
```

### Chain 3: Config Tampering → Arbitrary File Read via Cron Store Path

```
1. Attacker changes config via F3.1: "cron": {"store": "/home/krox/.openclaw/openclaw.json"}
2. Request to /api/agent-activity calls loadCronJobs → resolveCronStorePath → reads target file
3. If the target file contains a "jobs" array, its contents are parsed and exposed in the response
4. Attacker iterates with different paths to probe filesystem content
```

### Chain 4: Path Traversal + Analytics = Filesystem Content Disclosure

```
1. Attacker sends GET /api/stats/../../some-path-with-jsonl-files
2. parseSessions() calls readdirSync on the traversed directory
3. Any .jsonl files found are read entirely and parsed for "usage" and "timestamp" fields
4. Parsed data returned in response → attacker learns file contents and structure
5. Error messages on non-existent paths may reveal filesystem layout
```

---

## 7. Positive Security Observations

| Pattern | Where | Assessment |
|---------|-------|------------|
| `MAX_PARENT_SESSIONS_TO_PARSE` cap of 40 | `agent-activity/route.ts`, line 10 | **Partial.** Limits parent session files read per agent, but 40 is still substantial and each may cascade into subagent reads. |
| `SESSION_LOOKBACK_MS` 7-day cutoff | `agent-activity/route.ts`, line 9 | **Good.** Limits which files are considered based on modification time, reducing the scan surface to recent activity. |
| `SUBAGENT_MAX_ACTIVE_MS` 30-minute timeout | `agent-activity/route.ts`, line 12 | **Good.** Evicts stale subagent entries, preventing unbounded subagent list growth in the response. |
| `SUBAGENT_ACTIVITY_EVENT_LIMIT` of 6 | `agent-activity/route.ts`, line 13 | **Good.** Caps the number of activity events per subagent in the response. |
| 7-day file filter in `getAgentSessionStatus` | `config/route.ts`, lines 46-49 | **Good.** `statSync` check filters files by mtime, reducing the number of files read. However, the stat call itself is synchronous and runs on every file. |
| 30-second cache on `config`, `stats-all`, `stats-models` | Various | **Partial.** Reduces sustained load but does not protect against cache-miss bursts or first-request cost. |
| 5-minute cache on `activity-heatmap`, `idle-rank` | Various | **Better.** Longer TTL reduces the frequency of expensive scans, though still vulnerable to thundering herd. |
| `truncateSummary` limits output length | `agent-activity/route.ts`, line 167 | **Good.** Prevents excessively large strings in the response, though the full source data is still loaded into memory. |
| Subagent session ID regex validation | `agent-activity/route.ts`, line 359 | **Partial.** The regex `agent:[^:\s]+:subagent:[a-f0-9-]+` constrains child session key format, but the session ID portion is used in `path.join` without boundary checking. |
| `.filter(f => !f.includes(".deleted."))` | Multiple stats endpoints | **Good.** Skips explicitly deleted session files, reducing scan surface. |

---

## 8. Open Questions

| # | Question |
|---|----------|
| Q1 | How many JSONL session files exist per agent in production? What is the typical and maximum file size? This determines the real-world severity of F6.1/F6.3. |
| Q2 | Is the Node.js heap limit configured in the Dockerfile (`--max-old-space-size`)? The default V8 limit (~1.7GB) determines the threshold for memory exhaustion in S6.2. |
| Q3 | What is the `ulimit -n` (max open files) inside the Docker container? This determines the threshold for file descriptor exhaustion in S6.1. |
| Q4 | Is the `/api/agent-activity` endpoint polled on a timer by the dashboard frontend? If so, what's the polling interval? Rapid polling of the uncached heaviest endpoint compounds the DoS risk. |
| Q5 | Does the gateway enforce a maximum size for `openclaw.json` or individual session JSONL files? If not, accumulated data growth has no natural ceiling. |
| Q6 | Are there plans to add authentication to the dashboard? The entire DoS surface is accessible because of F1.3 (no auth). Rate limiting is a mitigation; auth is the fix. |

---

## 9. Remediation Priorities from This Chunk

1. **Add rate limiting middleware to all analytics endpoints.** A simple per-IP or global rate limit (e.g., 10 requests/minute per endpoint) prevents rapid-fire DoS. This is the highest-impact, lowest-effort mitigation for F6.1/F6.3. Consider using Next.js middleware or a lightweight in-memory rate limiter.

2. **Add server-side caching to `/api/agent-activity` and `/api/stats/[agentId]`.** These are the only two endpoints with no cache. A 30-60 second cache would reduce the worst-case load by 30-60×.

3. **Implement cache stampede protection.** Replace the check-then-act cache pattern with a lock-based pattern: the first request after TTL expiry acquires a lock, performs the scan, and updates the cache. Concurrent requests wait or serve stale data. This eliminates the thundering herd problem (F6.7).

4. **Convert synchronous file I/O to async.** Replace `readFileSync`, `readdirSync`, and `statSync` in `config/route.ts`, `stats/[agentId]/route.ts`, `activity-heatmap/route.ts`, and `idle-rank/route.ts` with their `fs.promises` equivalents. This prevents event loop blocking (F6.4) and allows concurrent request handling during I/O waits.

5. **Add file size checks before reads.** Before calling `readFile`/`readFileSync`, check `stat().size` and skip files above a threshold (e.g., 20MB). This prevents a single large file from consuming excessive memory (F6.3, S6.2).

6. **Add concurrency limits to parallel file reads.** Replace `Promise.all(files.map(readFile))` with a bounded-concurrency utility (e.g., `p-limit` or manual semaphore) that caps concurrent file reads to 10-20. This prevents file descriptor exhaustion (S6.1) and memory spikes (F6.5).

7. **Validate `agentId` in `/api/stats/[agentId]`.** Apply the same `resolveAgentPath` fix recommended in F5.1: validate `agentId` against `/^[a-zA-Z0-9_-]+$/` and confirm the resolved path stays within `OPENCLAW_AGENTS_DIR` (F6.2).

8. **Validate `cron.store` path in `resolveCronStorePath`.** Ensure the resolved path stays within `OPENCLAW_HOME`. Reject absolute paths and `~` expansion that escape the expected directory (F6.6).

9. **Eliminate double parse in `stats-models/route.ts`.** Merge the model token aggregation loop and response time loop into a single pass (as `stats-all` already does). This halves CPU/memory cost per request (F6.8).

10. **Consider streaming JSONL parsing.** Instead of loading entire files into memory, parse them line-by-line using a streaming approach (e.g., `readline` or chunked reading). This bounds per-file memory to one line at a time rather than the full file contents.
