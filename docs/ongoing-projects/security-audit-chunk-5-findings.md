# Chunk 5 Findings: Filesystem and Local Runtime Bridge Review

Date: 2026-03-30
Auditor: Cursor (automated)
Status: **Complete**

---

## 1. Files Reviewed

| File | Purpose |
|------|---------|
| `lib/openclaw-cli.ts` | Subprocess bridge to `openclaw` CLI binary; `execOpenclaw`, `callOpenclawGateway`, JSON output parsing, config snapshot hashing |
| `lib/openclaw-paths.ts` | Path constants (`OPENCLAW_HOME`, `OPENCLAW_CONFIG_PATH`, `OPENCLAW_AGENTS_DIR`, `OPENCLAW_PIXEL_OFFICE_DIR`) and package location discovery (`getOpenclawPackageCandidates`) |
| `lib/openclaw-skills.ts` | Skill discovery across builtin/extension/custom directories; file reading; agent-skill association from session JSONL; config parsing |
| `lib/json.ts` | BOM stripping, `JSON.parse` wrappers, synchronous and async file-to-JSON helpers |
| `lib/gateway-url.ts` | Gateway URL construction for client components; host override logic; query param injection |

Supporting files analyzed (consumers of the bridge layer):

| File | Relevance |
|------|-----------|
| `lib/model-probe.ts` | Contains a **duplicate** of `execOpenclaw`, `quoteShellArg`, and `parseJsonFromMixedOutput`; reads `models.json` for provider credentials; makes direct HTTP requests to LLM APIs |
| `lib/session-test-fallback.ts` | Imports `execOpenclaw` from `openclaw-cli.ts`; passes attacker-controlled `agentId` to CLI |
| `lib/config-cache.ts` | In-memory cache returning mutable references (cross-ref F3.9) |

---

## 2. Threat Model Summary for This Surface

These five library files form the **foundation layer** that every API route and client component depends on. They bridge the Next.js application to:

1. **Local filesystem** -- reading config, sessions, skills, layout, and models from `~/.openclaw/` and the OpenClaw package installation
2. **CLI subprocesses** -- invoking `openclaw` binary commands with user-influenced parameters
3. **Gateway connectivity** -- constructing URLs that client components use to reach the OpenClaw gateway

The bridge layer is security-critical because it is the **only place** where path construction, subprocess invocation, and JSON parsing of untrusted output occur. A vulnerability here multiplies across every route that uses the affected function.

**Key architectural concern:** The bridge layer provides path *constants* but no path *boundary enforcement*. There is no `resolveSafePath(base, userInput)` utility. Every route that constructs filesystem paths from user input must implement its own validation independently -- and as confirmed in F2.7, the existing routes don't.

---

## 3. Trust Boundaries and Attacker-Controlled Inputs

| Input Source | Bridge Function | How Propagated | Risk |
|---|---|---|---|
| `agentId` from URL path / request body | `path.join(OPENCLAW_AGENTS_DIR, agentId, ...)` in consumer routes | Used directly in filesystem paths by 8+ route handlers | Path traversal (confirmed F2.7) -- bridge provides no guard |
| `method` arg to `callOpenclawGateway` | Passed as CLI arg via `execOpenclaw(["gateway", "call", method, ...])` | Hardcoded by callers -- not directly attacker-controlled | Low (safe) |
| `params` arg to `callOpenclawGateway` | `JSON.stringify(params)` passed as `--params` CLI arg | Contains attacker-influenced data (agentId, model names) from request bodies | Safe on Linux (`execFile`); injectable on Windows (`exec` + `cmd.exe`) |
| `agentId` in `testSessionViaCli` | Passed as `--agent` CLI arg via `execOpenclaw` | Attacker-controlled from `/api/test-session` body (F4.5) | Safe on Linux; injectable on Windows |
| `providerId` in `probeProviderViaOpenclaw` | Passed as `--probe-provider` CLI arg | Attacker-controlled from `/api/test-model` body | May appear in CLI output, poisoning JSON parser |
| `process.env.OPENCLAW_HOME` | Sets `OPENCLAW_HOME`, base for all path constants | All filesystem reads rooted here | If overridable, redirects entire data surface |
| `process.env.OPENCLAW_PACKAGE_DIR` and 5 other env vars | Sets OpenClaw package candidate paths | Skills, extensions read from package path | Package hijack in shared-host environments |
| `hostOverride` in `buildGatewayUrl` | Used as hostname in constructed URL | Comes from `gateway.host` in config (modifiable via F3.1) | Client-side open redirect; gateway token sent to attacker |
| CLI stdout/stderr | `parseJsonFromMixedOutput` extracts first JSON object | Returned as parsed result to callers | Output injection if attacker-influenced data appears before real JSON |

---

## 4. Confirmed Findings

### F5.1: Bridge Layer Provides No Path Boundary Enforcement (High)

**Severity: High**
**File:** `lib/openclaw-paths.ts` (entire file)
**Cross-ref:** F2.7 (path traversal via `[agentId]`), S1.2 (suspected path traversal)

The bridge layer exports four path constants:

```typescript
export const OPENCLAW_HOME = process.env.OPENCLAW_HOME || path.join(home, ".openclaw");
export const OPENCLAW_CONFIG_PATH = path.join(OPENCLAW_HOME, "openclaw.json");
export const OPENCLAW_AGENTS_DIR = path.join(OPENCLAW_HOME, "agents");
export const OPENCLAW_PIXEL_OFFICE_DIR = path.join(OPENCLAW_HOME, "pixel-office");
```

But it provides **no utility function** to safely resolve user-supplied path segments within these directories. Every consuming route must independently validate path inputs. Current consumers construct paths like:

```typescript
path.join(OPENCLAW_HOME, `agents/${agentId}/sessions/sessions.json`)
path.join(OPENCLAW_AGENTS_DIR, agentId, "sessions", "sessions.json")
```

Node's `path.join` normalizes `..` segments, so `path.join("/home/krox/.openclaw", "agents/../../etc/passwd")` resolves to `/home/krox/etc/passwd`. No consumer validates that the resolved path stays within the intended root.

**Impact:**
- This is the structural root cause of F2.7 (path traversal via `[agentId]`)
- All 8+ routes that accept `agentId` are affected: `sessions/[agentId]`, `stats/[agentId]`, `config/agent-model`, `test-session`, `test-sessions`, `test-dm-sessions`, `agent-status`, `agent-activity`
- A single missing validation in any new route will reintroduce path traversal
- The correct fix is a centralized `resolveAgentPath(agentId)` that validates the input pattern and confirms the resolved path stays within `OPENCLAW_AGENTS_DIR`

**Recommended pattern:**

```typescript
export function resolveAgentPath(agentId: string, ...segments: string[]): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(agentId)) {
    throw new Error(`Invalid agent ID: ${agentId}`);
  }
  const resolved = path.resolve(OPENCLAW_AGENTS_DIR, agentId, ...segments);
  if (!resolved.startsWith(OPENCLAW_AGENTS_DIR + path.sep)) {
    throw new Error(`Path escapes agent directory: ${resolved}`);
  }
  return resolved;
}
```

### F5.2: Windows cmd.exe Shell Argument Injection in `quoteShellArg` (Medium)

**Severity: Medium**
**Files:**
- `lib/openclaw-cli.ts`, lines 8-11 (canonical implementation)
- `lib/model-probe.ts`, lines 62-65 (duplicate implementation)

The `quoteShellArg` function is used on Windows to construct shell command strings:

```typescript
function quoteShellArg(arg: string): string {
  if (/^[A-Za-z0-9_./:=@-]+$/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '""')}"`;
}
```

On cmd.exe, double-quoted strings still undergo environment variable expansion (`%VAR%`), delayed expansion (`!VAR!`), and caret escaping (`^`). The function only escapes `"` characters.

If attacker-controlled data reaches the Windows code path (e.g., `agentId` containing `%COMPUTERNAME%` in the `callOpenclawGateway` note field, or `providerId` containing `%PATH%` in `probeProviderViaOpenclaw`), cmd.exe would:

1. Expand `%COMPUTERNAME%` to the server's hostname (information disclosure)
2. Expand `%PATH%` to the full system PATH (information disclosure)
3. With delayed expansion enabled, `!` characters cause additional expansion

**Deployment context:** The current deployment (Ubuntu 24.04 VPS) uses the `execFile` path which does not invoke a shell. The Windows `exec`+`cmd.exe` path is unreachable. Severity is Medium due to the code defect existing in the codebase -- future portability or CI testing on Windows would expose it.

**Impact if Windows path were reached:**
- Environment variable values leaked into CLI arguments
- Potential command injection if `%` characters align with shell syntax

### F5.3: Duplicate Bridge Implementations with Divergent Behavior (Medium)

**Severity: Medium (code quality with security implications)**
**Files:**
- `lib/openclaw-cli.ts` (canonical)
- `lib/model-probe.ts` (duplicate)

`model-probe.ts` contains its own copies of `execOpenclaw` (lines 67-83), `quoteShellArg` (lines 62-65), and `parseJsonFromMixedOutput` (lines 85-118). These are functionally similar to the versions in `openclaw-cli.ts` but have divergent error handling:

| Function | `openclaw-cli.ts` behavior | `model-probe.ts` behavior |
|---|---|---|
| `parseJsonFromMixedOutput` on parse failure | Returns `null` | Throws `Error("Failed to parse JSON output...")` |
| `execOpenclaw` | Identical | Identical |
| `quoteShellArg` | Identical | Identical |

**Impact:**
- A security fix applied to `openclaw-cli.ts` (e.g., improved `quoteShellArg` escaping, bounds on `parseJsonFromMixedOutput`) would NOT automatically apply to `model-probe.ts`
- The divergent error handling means callers have different assumptions about failure modes
- Code review of one file gives false confidence that the other is also safe

### F5.4: Environment Variable Overrides Redirect All Filesystem Operations (Medium)

**Severity: Medium**
**File:** `lib/openclaw-paths.ts`, lines 6-9; lines 15-35

The root of all filesystem operations is controlled by environment variables:

```typescript
export const OPENCLAW_HOME = process.env.OPENCLAW_HOME || path.join(home, ".openclaw");
```

If `OPENCLAW_HOME` is overridden, every path constant shifts:
- `OPENCLAW_CONFIG_PATH` → reads a different `openclaw.json` (potentially with attacker-controlled credentials)
- `OPENCLAW_AGENTS_DIR` → reads agent sessions from a different directory
- `OPENCLAW_PIXEL_OFFICE_DIR` → writes layout to a different directory

Additionally, `getOpenclawPackageCandidates` checks 6 environment variables:

| Variable | Effect |
|---|---|
| `OPENCLAW_PACKAGE_DIR` | First-priority package location |
| `npm_config_prefix` / `PREFIX` | npm prefix for package lookup |
| `APPDATA` | Windows-specific package path |
| `HOMEBREW_PREFIX` | macOS-specific package path |
| (Node `process.version`) | Determines nvm/fnm version path |

**Attack vector:**
- On shared hosting where the web server process inherits environment from other users
- In CI/CD environments where environment variables are configured externally
- Docker deployments where `docker run -e OPENCLAW_HOME=/attacker/dir` would redirect all reads

**Impact:** An attacker who can set `OPENCLAW_HOME` or `OPENCLAW_PACKAGE_DIR` controls which config, credentials, sessions, and skill files the dashboard reads. The `findOpenClawPkg()` function in `openclaw-skills.ts` returns the first candidate path that contains a `package.json`, so placing a `package.json` in a higher-priority candidate directory hijacks all skill reads.

### F5.5: `parseJsonFromMixedOutput` Susceptible to CLI Output Injection (Medium)

**Severity: Medium**
**Files:**
- `lib/openclaw-cli.ts`, lines 31-64
- `lib/model-probe.ts`, lines 85-118

Both implementations scan the combined stdout+stderr for the first complete JSON object:

```typescript
for (let i = 0; i < output.length; i++) {
  if (output[i] !== "{") continue;
  // ... match balanced braces, attempt JSON.parse ...
}
```

The parser returns the **first** valid JSON object found in the output stream. If attacker-influenced data appears in the CLI output before the real JSON response, the parser returns the attacker's data instead.

**Concrete attack path (via `model-probe.ts` line 312-322):**

```typescript
const { stdout, stderr } = await execOpenclaw([
    "models", "status", "--probe", "--json",
    "--probe-timeout", String(timeoutMs),
    "--probe-provider", String(params.providerId),
]);
const parsed = parseJsonFromMixedOutput(`${stdout}\n${stderr || ""}`);
```

`params.providerId` is attacker-controlled (from `/api/test-model` request body). If the CLI echoes the provider ID in an error or diagnostic message before the JSON output -- e.g., `"Unknown provider: <providerId>"` -- an attacker could set `providerId` to a crafted value containing a JSON object:

```
{"auth":{"probes":{"results":[{"provider":"evil","status":"ok","mode":"api_key"}]}}}
```

If this appears in stderr before the real JSON output, `parseJsonFromMixedOutput` would return the attacker's crafted object, causing `probeProviderViaOpenclaw` to report a forged "ok" result.

**Mitigating factors:**
- Requires the CLI to echo the attacker-controlled argument in its output
- The crafted JSON must be syntactically valid and appear before the real output
- Needs dynamic validation to confirm whether the CLI echoes provider IDs

### F5.6: Unbounded File Reads and JSON Parsing Enable Memory Exhaustion (Medium)

**Severity: Medium**
**Files:**
- `lib/json.ts`, lines 11-17
- `lib/openclaw-skills.ts`, lines 51, 89, 140, 158

The JSON helpers read files with no size validation:

```typescript
export function readJsonFileSync<T = any>(filePath: string): T {
  return parseJsonText<T>(fs.readFileSync(filePath, "utf-8"));
}
```

And `openclaw-skills.ts` reads files without bounds:

```typescript
const content = fs.readFileSync(skillMd, "utf-8");           // line 51 -- skill files
const content = fs.readFileSync(path.join(sessionsDir, file), "utf-8"); // line 89 -- JSONL files
const sessions = JSON.parse(fs.readFileSync(OPENCLAW_CONFIG_PATH, "utf-8")); // line 140 -- config
```

**Attack vectors:**
- If `openclaw.json` grows very large (e.g., via repeated gateway config patches that append data), every call to `listOpenclawSkills` blocks the event loop while parsing it
- Session JSONL files can grow unbounded; `getAgentSkillsFromSessions` reads the 3 most recent per agent with no size limit
- `readJsonFileSync` in `model-probe.ts` reads `models.json` -- if this file were corrupted to be very large, every model probe blocks

**Impact:** While file sizes are controlled by the gateway under normal operation, an attacker who can write to config (F3.1) or who exploits path traversal (F2.7) could point these reads at large files, causing memory exhaustion or event loop blocking.

The `getAgentSkillsFromSessions` function partially mitigates this by only processing 5000 characters from the `skillsSnapshot` marker (line 92: `content.slice(idx, idx + 5000)`), but it reads the full file into memory first.

### F5.7: Uncaught `JSON.parse` in `listOpenclawSkills` Crashes Route (Low)

**Severity: Low**
**File:** `lib/openclaw-skills.ts`, line 140

```typescript
const config = JSON.parse(fs.readFileSync(OPENCLAW_CONFIG_PATH, "utf-8"));
```

This line has no try/catch. If `openclaw.json` is corrupted, truncated, or empty (e.g., from a non-atomic write as noted in F3.5), this throws an unhandled exception that crashes the `/api/skills` and `/api/skills/content` route handlers.

Compare to `model-probe.ts` line 122, which wraps the same pattern in try/catch:

```typescript
try {
  const parsed = readJsonFileSync<any>(MODELS_PATH);
  // ...
} catch {
  return null;
}
```

**Impact:** A corrupted config file makes the skills endpoints permanently unavailable until the file is repaired. Under normal operation this is unlikely, but combined with the non-atomic alert write (F3.5) or concurrent config patches (S3.2), temporary corruption is possible.

### F5.8: 10MB `maxBuffer` per CLI Invocation Enables Memory Pressure (Low)

**Severity: Low**
**Files:**
- `lib/openclaw-cli.ts`, line 18: `maxBuffer: 10 * 1024 * 1024`
- `lib/model-probe.ts`, lines 72, 79: `maxBuffer: 10 * 1024 * 1024`

Each `execOpenclaw` call allocates up to 10MB for stdout and 10MB for stderr buffering. Under concurrent load (e.g., `/api/test-bound-models` firing multiple probes simultaneously, or `/api/test-sessions` testing all agents), memory usage scales as `N × 20MB` where N is concurrent CLI invocations.

With no concurrency limit on CLI invocations and no rate limiting on the triggering endpoints (F4.3, F4.9), an attacker could force dozens of simultaneous CLI calls, consuming hundreds of MB in buffers alone.

**Mitigating factors:**
- CLI commands typically produce small output (< 10KB)
- The maxBuffer is a ceiling, not a pre-allocation
- Node.js garbage collection reclaims buffers after completion

### F5.9: Gateway URL Construction Blindly Trusts Config Host Override (Low)

**Severity: Low (requires F3.1 chain)**
**File:** `lib/gateway-url.ts`, lines 9-31
**Cross-ref:** F3.1 (unauthenticated config change), S1.1 (client-side token propagation)

```typescript
export function buildGatewayUrl(port, path, params, hostOverride) {
  const base = hostOverride?.trim() || "";
  if (base.includes("://")) {
    const origin = base.replace(/\/$/, "");
    url = new URL(`${origin}${path}`);
  } else {
    const host = base || (typeof window !== "undefined" ? window.location.hostname : "localhost");
    url = new URL(`http://${host}:${port}${path}`);
  }
```

Client components (`agent-card.tsx`, `sessions/page.tsx`, `pixel-office/page.tsx`) call this function with `hostOverride` sourced from the config endpoint's `gateway.host` field. If an attacker modifies the gateway config via F3.1 to set `host` to `attacker.com`, subsequent client-side URL construction would point to the attacker's server.

**Attack chain:**
1. Attacker changes config via PATCH `/api/config/agent-model` or gateway `config.patch` (F3.1)
2. Config now contains `gateway.host: "attacker.com"`
3. Dashboard UI fetches config, passes `hostOverride: "attacker.com"` to `buildGatewayUrl`
4. Client components render links and make fetch requests to `http://attacker.com:18789/...`
5. The gateway auth token (already in client memory from F2.1) may be sent in request headers to the attacker's server

**Mitigating factors:**
- The gateway token is already exposed via `/api/config` (F2.1), so the redirect doesn't leak new secrets
- The redirect only affects the client-side UI, not server-side operations
- Requires F3.1 (unauthenticated config change) as a prerequisite

---

## 5. Suspected Findings (Require Dynamic Validation)

### S5.1: Package Candidate Path Hijacking in Shared-Host Environments

**File:** `lib/openclaw-paths.ts`, lines 15-35; `lib/openclaw-skills.ts`, lines 20-26

`getOpenclawPackageCandidates` returns up to 13 filesystem paths including several under user-home directories. `findOpenClawPkg()` returns the **first** path that contains a `package.json`:

```typescript
function findOpenClawPkg(): string {
  const candidates = getOpenclawPackageCandidates();
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "package.json"))) return candidate;
  }
  return candidates[0];
}
```

On shared systems where multiple users share a home directory parent, or in environments where environment variables like `OPENCLAW_PACKAGE_DIR` or `npm_config_prefix` are attacker-influenced, placing a `package.json` in a higher-priority path would hijack all skill file reads.

The hijacked package could contain:
- Malicious `SKILL.md` files with crafted frontmatter
- Skill content designed to exploit downstream consumers
- Extension directories with additional malicious skill files

**Needs validation in Chunk 10 (Dynamic Verification):** Confirm candidate path priority ordering and whether Docker deployments expose any writable candidate paths.

### S5.2: Symlink Traversal in Skill Directories

**File:** `lib/openclaw-skills.ts`, lines 64-71

`scanSkillsDir` iterates directory entries and constructs paths:

```typescript
for (const name of fs.readdirSync(dir).sort()) {
  const skill = readSkillFile(path.join(dir, name, "SKILL.md"), source, name);
```

Neither `readdirSync` nor the subsequent `readFileSync` in `readSkillFile` resolves or checks for symbolic links. A symlink in the skills directory pointing outside the intended scope would be followed, causing:
- Reading of arbitrary files as skill content (F2.6 expansion)
- Absolute paths of linked targets exposed in `location` field (F2.5 expansion)

**Needs validation in Chunk 10 (Dynamic Verification):** Check whether any skill directories contain symlinks, and whether the OpenClaw installer creates symlinks for extension skills.

### S5.3: CLI Output Poisoning via Attacker-Controlled `--probe-provider` Argument

**File:** `lib/model-probe.ts`, lines 309-322

As detailed in F5.5, the `--probe-provider` argument to `openclaw models status` is attacker-controlled. If the CLI echoes this argument in diagnostic or error output, and the output appears before the real JSON response, `parseJsonFromMixedOutput` returns the attacker's crafted JSON instead of the real probe result.

To confirm this:
1. Run `openclaw models status --probe --json --probe-provider '{"auth":{"probes":{"results":[]}}}'`
2. Check whether the crafted argument appears in stdout or stderr
3. If it does, confirm that `parseJsonFromMixedOutput` picks up the crafted JSON

**Needs validation in Chunk 10 (Dynamic Verification).**

---

## 6. Exploit Chain Summary

### Chain 1: Path Traversal Foundation (Cross-Chunk)

```
1. Bridge layer (openclaw-paths.ts) exports path constants with no boundary enforcement
2. Consumer routes construct paths: path.join(OPENCLAW_AGENTS_DIR, agentId, ...)
3. Attacker sends agentId = "../../etc" via URL path or request body
4. path.join normalizes ".." segments → path escapes OPENCLAW_AGENTS_DIR
5. Route reads files outside intended directory (F2.7, confirmed in Chunk 2)
6. Root cause: bridge layer provides constants without guards
```

### Chain 2: Environment Variable Takeover (Requires Shared Host)

```
1. Attacker sets OPENCLAW_HOME=/tmp/evil via shared environment
2. All path constants (OPENCLAW_CONFIG_PATH, OPENCLAW_AGENTS_DIR, etc.) shift to /tmp/evil/
3. Dashboard reads attacker-controlled openclaw.json → attacker-supplied gateway token, host
4. Dashboard reads attacker-controlled sessions, skills, models → poisoned data in all API responses
5. Dashboard writes alert config and pixel-office layout to /tmp/evil/ → attacker can read them
```

### Chain 3: CLI Output Injection → Forged Probe Results (Requires Dynamic Validation)

```
1. Attacker sends POST /api/test-model with provider = crafted JSON string
2. model-probe.ts passes provider as --probe-provider to openclaw CLI
3. CLI echoes the argument in stderr (e.g., "Unknown provider: {crafted JSON}")
4. parseJsonFromMixedOutput finds the crafted JSON before the real output
5. Attacker-controlled probe result returned → forged "ok" status shown in dashboard
```

---

## 7. Positive Security Observations

| Pattern | Where | Assessment |
|---------|-------|------------|
| `execFile` on Linux (no shell) | `lib/openclaw-cli.ts`, line 17; `lib/model-probe.ts`, line 71 | **Correct.** Arguments passed as array, no shell injection possible on the production platform. |
| `FORCE_COLOR: "0"` in CLI env | `lib/openclaw-cli.ts`, line 14 | **Good.** Prevents ANSI escape sequences in output, reducing output parsing confusion. |
| BOM stripping before JSON parse | `lib/json.ts`, line 3 | **Good.** Prevents BOM-related parse failures that could cause fallback to unsafe behavior. |
| Skill content access gated by enumerated list | `lib/openclaw-skills.ts`, lines 153-161 | **Good.** `getOpenclawSkillContent` validates `source` and `id` against the enumerated skill list before reading files. Direct path traversal via skill parameters is not possible. |
| Session JSONL processing bounded to 5000 chars | `lib/openclaw-skills.ts`, line 92 | **Partial.** The `getAgentSkillsFromSessions` function limits regex scanning to 5000 chars from the `skillsSnapshot` marker. However, the full file is still read into memory first. |
| Only 3 recent JSONL files read per agent | `lib/openclaw-skills.ts`, line 88 | **Good.** `jsonlFiles.slice(-3)` limits the number of files read, bounding I/O for agents with many sessions. |
| `buildGatewayUrl` uses `URL` constructor | `lib/gateway-url.ts`, line 23 | **Partial.** The `URL` constructor validates and normalizes the result, preventing malformed URLs. But it does not validate the hostname against an allowlist. |
| `resolveConfigSnapshotHash` provides tamper detection | `lib/openclaw-cli.ts`, lines 78-83 | **Good.** Config snapshot hashing enables optimistic concurrency control, detecting if config changed between read and write operations. |

---

## 8. Open Questions

| # | Question |
|---|----------|
| Q1 | Does the `openclaw` CLI binary echo command arguments (like `--probe-provider` or `--agent`) in its stdout/stderr output? If so, `parseJsonFromMixedOutput` is vulnerable to output injection (F5.5/S5.3). |
| Q2 | In Docker deployments, which environment variables are available to the Next.js process? Can `OPENCLAW_HOME` or `OPENCLAW_PACKAGE_DIR` be overridden via Docker `-e` flags or `.env` files? |
| Q3 | Are there any OpenClaw package installation methods that create symlinks in skill directories (e.g., `pnpm` global installs using symlinks)? |
| Q4 | Is there a maximum size for `openclaw.json` or `models.json` enforced by the gateway? If not, accumulated config patches could cause unbounded file growth. |
| Q5 | Should `buildGatewayUrl` validate the hostname against a strict allowlist (e.g., `localhost`, `127.0.0.1`, or configured hostnames only) to prevent open redirects? |

---

## 9. Remediation Priorities from This Chunk

1. **Add centralized path boundary enforcement to `openclaw-paths.ts`.** Export a `resolveAgentPath(agentId, ...segments)` function that validates `agentId` against `/^[a-zA-Z0-9_-]+$/` and confirms the resolved path stays within `OPENCLAW_AGENTS_DIR`. Migrate all consumer routes to use this function. This is the **highest-priority architectural fix** and addresses the root cause of F2.7 across all current and future routes.

2. **Deduplicate the bridge implementations.** `model-probe.ts` should import `execOpenclaw`, `quoteShellArg`, and `parseJsonFromMixedOutput` from `openclaw-cli.ts` instead of maintaining its own copies. This ensures security fixes apply uniformly (F5.3).

3. **Add file size checks before unbounded reads.** Before `readFileSync` on config, JSONL, or skill files, check `fs.statSync(filePath).size` and reject files above a reasonable threshold (e.g., 10MB for config, 50MB for JSONL). This prevents memory exhaustion via large files (F5.6).

4. **Wrap `listOpenclawSkills` config read in try/catch.** The bare `JSON.parse(fs.readFileSync(...))` on line 140 should handle parse errors gracefully, matching the pattern used in `model-probe.ts` (F5.7).

5. **Fix `quoteShellArg` for cmd.exe metacharacters.** If Windows support is intended, escape `%`, `!`, `^`, `&`, `|`, `<`, `>` inside double-quoted strings. Better: use `execFile` on all platforms (it works on Windows too) and remove the `exec`+`cmd.exe` path entirely (F5.2).

6. **Validate `OPENCLAW_HOME` at startup.** Before accepting the environment variable, check that the path is absolute, exists, and is owned by the current user. Log a warning if overridden from the default (F5.4).

7. **Harden `parseJsonFromMixedOutput` against output injection.** Consider parsing from the **end** of the output (where the real JSON response is most likely to appear) rather than from the beginning. Alternatively, require the CLI to emit a known delimiter before the JSON output (F5.5).

8. **Add hostname validation to `buildGatewayUrl`.** Reject or warn on hostnames that are not `localhost`, `127.0.0.1`, or a configured allowlist. This prevents client-side open redirects when config is tampered with (F5.9).

9. **Limit concurrent CLI invocations.** Add a semaphore or queue to `execOpenclaw` that caps concurrent subprocesses (e.g., 4-8). This bounds memory usage from CLI buffers under concurrent load (F5.8).
