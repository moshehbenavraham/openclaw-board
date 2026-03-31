# Implementation Notes

**Session ID**: `phase02-session02-runtime-bridge-consolidation-and-safe-parsing`
**Started**: 2026-03-31 09:42
**Last Updated**: 2026-03-31 09:57

---

## Session Progress

| Metric | Value |
|--------|-------|
| Tasks Completed | 15 / 15 |
| Estimated Remaining | 0 hours |
| Blockers | 0 |

---

## Task Log

### 2026-03-31 - Session Start

**Environment verified**:
- [x] Prerequisites confirmed
- [x] Tools available
- [x] Directory structure ready

---

### Task T001 - Verify the duplicate OpenClaw CLI execution, parser call sites, and downstream response contracts

**Started**: 2026-03-31 09:42
**Completed**: 2026-03-31 09:42
**Duration**: 0 minutes

**Notes**:
- Confirmed duplicated OpenClaw CLI execution helpers remain in both `lib/model-probe.ts` and `app/api/gateway-health/route.ts`, each carrying their own `quoteShellArg(...)`, Windows `exec` fallback, and `execFile` execution path instead of reusing `lib/openclaw-cli.ts`.
- Confirmed duplicated mixed-output JSON parsing remains in both consumers. `lib/model-probe.ts` throws `Failed to parse JSON output from openclaw models status --probe --json`, while `app/api/gateway-health/route.ts` throws `Failed to parse JSON from openclaw gateway status output`.
- Confirmed `lib/session-test-fallback.ts` already uses `execOpenclaw(...)` from `lib/openclaw-cli.ts`, but still depends on the weaker shared parse helper contract that returns `null` for malformed mixed output and can therefore fall back to raw stdout.
- Confirmed the downstream consumer contracts that must stay stable on the success path:
  - `probeModel(...)` returns `ModelProbeOutcome` with `ok`, `elapsed`, `model`, `mode`, `status`, `source`, `precision`, and optional `text` or `error`.
  - `GET /api/gateway-health` returns operator-facing `healthy`, `degraded`, or `down` states with `openclawVersion`, `checkedAt`, `responseMs`, and `launchPath` only on healthy or degraded success paths.
  - `testSessionViaCli(...)` returns `{ ok, reply?, error?, elapsed }` and currently prefers parsed reply fields before falling back to raw stdout.

**Files Changed**:
- `.spec_system/specs/phase02-session02-runtime-bridge-consolidation-and-safe-parsing/implementation-notes.md` - created the session log and recorded the duplicated execution and parsing inventory plus the downstream success-path contracts

### Task T002 - Document the runtime file inputs, approved OpenClaw boundaries, and current malformed-output failure modes

**Started**: 2026-03-31 09:43
**Completed**: 2026-03-31 09:43
**Duration**: 0 minutes

**Notes**:
- Confirmed the runtime file inputs touched by the bridge consumers today:
  - `lib/model-probe.ts` reads `models.json` from `OPENCLAW_HOME/agents/main/agent/models.json` through an inline `path.join(...)`.
  - `app/api/gateway-health/route.ts` reads `openclaw.json` through `OPENCLAW_CONFIG_PATH`, which is derived from `OPENCLAW_HOME`.
- Confirmed the approved OpenClaw filesystem boundaries already available in shared code:
  - `lib/openclaw-paths.ts` centralizes `OPENCLAW_HOME`, `OPENCLAW_CONFIG_PATH`, the `agents/` tree boundary, and boundary helpers such as `isPathWithinBoundary(...)` and `resolveWithinBoundary(...)`.
  - No dedicated runtime file resolver exists yet for `agents/main/agent/models.json`, so `lib/model-probe.ts` still trusts a config-derived path shape without a consumer-specific allowlist helper.
- Confirmed the current malformed-output failure modes that must be closed:
  - `lib/model-probe.ts` throws a parser error when mixed CLI output does not contain a valid JSON object, which can abort the probe flow before returning a stable provider-level error.
  - `app/api/gateway-health/route.ts` collapses CLI parse failures into the returned `error` field and can surface parser-specific messages instead of a stable operator-facing down-state failure.
  - `lib/session-test-fallback.ts` treats an unparseable CLI response as a successful raw-stdout reply, which is too permissive for the hardened shared contract required by this session.

**Files Changed**:
- `.spec_system/specs/phase02-session02-runtime-bridge-consolidation-and-safe-parsing/implementation-notes.md` - documented the current runtime file inputs, approved boundaries, and malformed-output failure modes that require fail-closed handling

### Task T003 - Define the canonical bridge helper contract, sanitized failure mapping, and deferred non-scope items

**Started**: 2026-03-31 09:44
**Completed**: 2026-03-31 09:44
**Duration**: 0 minutes

**Notes**:
- Defined the canonical bridge contract for `lib/openclaw-cli.ts`:
  - keep `execOpenclaw(...)` as the only subprocess execution entry point
  - add shared typed helpers for version, gateway status, and provider probe commands
  - make mixed-output parsing explicitly fail closed when no valid JSON object is present
  - keep raw stdout and stderr out of downstream route responses
- Defined the sanitized failure mapping expected from bridge consumers:
  - malformed CLI output becomes a stable invalid-runtime-data failure instead of a raw parser exception
  - missing probe matches become a stable provider-level `unknown` failure for `probeModel(...)`
  - gateway-health maps malformed or failed CLI probes to `status: "down"` with a sanitized `error` field instead of raw stderr, parser internals, or filesystem details
  - session CLI fallback reports malformed output as an explicit error result instead of a successful raw reply
- Recorded deferred non-scope work that must not be pulled into this session:
  - async caching and read-path concurrency controls remain owned by Phase 02 Session 03
  - alert write integrity and cache cleanup remain owned by Phase 03
  - documentation closeout and accepted-risk tracking remain owned by later workflow steps

**Files Changed**:
- `.spec_system/specs/phase02-session02-runtime-bridge-consolidation-and-safe-parsing/implementation-notes.md` - documented the canonical shared bridge contract, sanitized downstream failure mapping, and deferred out-of-scope work

### Task T004 - Refactor the canonical OpenClaw bridge helper surface for shared execution, mixed-output parsing, and typed probe results with timeout, stderr fallback, and malformed-output rejection

**Started**: 2026-03-31 09:44
**Completed**: 2026-03-31 09:47
**Duration**: 3 minutes

**Notes**:
- Expanded `lib/openclaw-cli.ts` into the canonical bridge surface instead of leaving consumer-local execution and parsing logic in place.
- Added typed shared helpers for:
  - required mixed-output JSON parsing with explicit invalid-output failures
  - gateway status probing
  - provider probe status extraction
  - version lookup
  - shared sanitized error handling through `OpenclawJsonCommandError`
- Preserved the existing `execOpenclaw(...)` and `callOpenclawGateway(...)` entry points while moving command parsing and failure typing behind one reusable helper path.

**Files Changed**:
- `lib/openclaw-cli.ts` - added typed JSON-command helpers, gateway and provider probe helpers, version lookup, and sanitized shared bridge errors

**BQC Fixes**:
- Failure path completeness: malformed CLI output now fails through one explicit typed error path instead of per-consumer parser behavior drift (`lib/openclaw-cli.ts`)
- Error information boundaries: bridge consumers can now map command and parse failures to stable operator-facing errors without surfacing raw stderr by default (`lib/openclaw-cli.ts`)

### Task T005 - Add validated runtime file resolvers for bridge consumers with boundary-checked OpenClaw path handling

**Started**: 2026-03-31 09:47
**Completed**: 2026-03-31 09:47
**Duration**: 0 minutes

**Notes**:
- Added shared runtime-path resolvers for:
  - `OPENCLAW_HOME/openclaw.json`
  - `OPENCLAW_HOME/agents/<agentId>/agent/`
  - `OPENCLAW_HOME/agents/<agentId>/agent/models.json`
- Kept the new helpers on top of the existing shared boundary checks so bridge consumers can validate runtime file paths without rebuilding path joins inline.

**Files Changed**:
- `lib/openclaw-paths.ts` - added shared OpenClaw runtime file resolvers for config and agent models paths

**BQC Fixes**:
- Trust boundary enforcement: runtime file reads now have explicit shared boundary-checked resolvers instead of consumer-local joins (`lib/openclaw-paths.ts`)

### Task T006 - Extend bridge-helper unit tests for malformed mixed output, stderr-only JSON, empty output, and typed result contracts

**Started**: 2026-03-31 09:47
**Completed**: 2026-03-31 09:49
**Duration**: 2 minutes

**Notes**:
- Rewrote `lib/openclaw-cli.test.ts` around the new shared bridge contract.
- Added focused regression coverage for:
  - mixed stdout and stderr parsing
  - required malformed-output rejection
  - typed command-failure wrapping
  - shared gateway status and provider probe helpers
  - version lookup and gateway-call compatibility
- Verified the focused bridge test target passes:
  - `npx vitest run lib/openclaw-cli.test.ts`

**Files Changed**:
- `lib/openclaw-cli.test.ts` - added shared bridge helper coverage for malformed output, stderr fallback, typed failures, and typed helper contracts

### Task T007 - Extend runtime-path tests for invalid `OPENCLAW_HOME`-derived file paths and approved-boundary resolution

**Started**: 2026-03-31 09:48
**Completed**: 2026-03-31 09:49
**Duration**: 1 minute

**Notes**:
- Extended `lib/openclaw-paths.test.ts` with runtime config and `models.json` resolution coverage.
- Added explicit regression checks for path traversal attempts against the new shared runtime-path helpers.
- Verified the focused runtime-path test target passes:
  - `npx vitest run lib/openclaw-paths.test.ts`

**Files Changed**:
- `lib/openclaw-paths.test.ts` - added runtime config and models path resolution plus escape rejection regressions

### Task T008 - Route provider-probe CLI fallback through the shared bridge helper and validated `models.json` resolution with timeout, retry, and failure-path handling

**Started**: 2026-03-31 09:49
**Completed**: 2026-03-31 09:54
**Duration**: 5 minutes

**Notes**:
- Removed the consumer-local OpenClaw subprocess and mixed-output parser logic from `lib/model-probe.ts`.
- Routed CLI fallback through `probeOpenclawProviderStatus(...)` in `lib/openclaw-cli.ts`.
- Resolved `models.json` through `resolveOpenclawAgentModelsFile("main")` before reading provider config.
- Changed fallback failures from thrown parser or subprocess errors into stable `ModelProbeOutcome` failure results so operator routes receive explicit down-state data instead of generic 500s.
- Preserved the direct HTTP probe timeout and retry behavior for supported provider configs.

**Files Changed**:
- `lib/model-probe.ts` - reused the shared provider probe helper, validated `models.json`, and converted fallback failures into stable probe results

**BQC Fixes**:
- Trust boundary enforcement: provider config now comes only from a boundary-checked `models.json` resolver before any runtime file read (`lib/model-probe.ts`)
- Failure path completeness: CLI fallback failures now return explicit probe outcomes instead of throwing raw parser or command errors (`lib/model-probe.ts`)

### Task T009 - Route gateway version and CLI health probes through the shared bridge helper with explicit degraded and down-state error mapping

**Started**: 2026-03-31 09:51
**Completed**: 2026-03-31 09:54
**Duration**: 3 minutes

**Notes**:
- Replaced the route-local version and CLI gateway status helpers with the shared `getOpenclawVersion(...)` and `probeOpenclawGatewayStatus(...)` bridge helpers.
- Added `resolveOpenclawConfigFile()` validation before reading the OpenClaw runtime config.
- Preserved the existing HTTP health probe, web fallback, and operator-visible healthy or degraded success responses while keeping down-state errors sanitized.

**Files Changed**:
- `app/api/gateway-health/route.ts` - reused shared bridge helpers for version and CLI status probing and validated the OpenClaw config path before reading it

**BQC Fixes**:
- Error information boundaries: gateway-health now reports stable down-state errors from the shared bridge instead of route-local parser messages (`app/api/gateway-health/route.ts`)
- Contract alignment: healthy, degraded, and down-state mapping remains explicit while CLI probe behavior now comes from one shared helper contract (`app/api/gateway-health/route.ts`)

### Task T010 - Align session CLI fallback parsing with the hardened shared bridge contract and explicit malformed-output handling

**Started**: 2026-03-31 09:53
**Completed**: 2026-03-31 09:54
**Duration**: 1 minute

**Notes**:
- Replaced permissive mixed-output parsing in `lib/session-test-fallback.ts` with `parseRequiredOpenclawJsonOutput(...)`.
- Session CLI fallback now returns an explicit error when the CLI output is malformed instead of treating raw stdout as a successful reply.
- Preserved reply extraction for valid JSON responses, nested reply fields, and explicit CLI error payloads.

**Files Changed**:
- `lib/session-test-fallback.ts` - enforced the hardened shared parse contract and explicit malformed-output denial for session CLI fallback

**BQC Fixes**:
- Failure path completeness: malformed CLI fallback output now produces an explicit caller-visible failure instead of a silent success-path fallback (`lib/session-test-fallback.ts`)

### Task T011 - Remove the remaining duplicated bridge execution and parser branches from bridge consumers while preserving existing operator-visible success responses

**Started**: 2026-03-31 09:54
**Completed**: 2026-03-31 09:57
**Duration**: 3 minutes

**Notes**:
- Completed the consumer migration by removing the remaining route-local and helper-local OpenClaw subprocess and mixed-output parser branches from:
  - `lib/model-probe.ts`
  - `app/api/gateway-health/route.ts`
  - `lib/session-test-fallback.ts`
- Verified no duplicate bridge execution helpers remain in those files with:
  - `rg -n "node:child_process|quoteShellArg|parseJsonFromMixedOutput|execFileAsync|execAsync" lib/model-probe.ts app/api/gateway-health/route.ts lib/session-test-fallback.ts`
- Preserved the operator-visible success responses for provider probes, gateway health, and session diagnostics while consolidating failure behavior behind the shared bridge.

**Files Changed**:
- `lib/model-probe.ts` - removed duplicate CLI execution and parser branches
- `app/api/gateway-health/route.ts` - removed duplicate CLI execution and parser branches
- `lib/session-test-fallback.ts` - removed the permissive standalone parse branch in favor of the shared bridge contract

### Task T012 - Extend provider-probe tests for malformed CLI output, invalid runtime paths, missing probe matches, and shared-helper reuse

**Started**: 2026-03-31 09:54
**Completed**: 2026-03-31 09:57
**Duration**: 3 minutes

**Notes**:
- Updated `lib/model-probe.test.ts` to match the hardened failure contract:
  - CLI fallback failures now resolve to stable `ModelProbeOutcome` failure objects instead of rejected promises
  - invalid `models.json` path resolution fails closed
  - malformed shared-helper output fails closed with a sanitized error
  - missing provider probe matches return a stable `unknown` failure
  - shared helper reuse is asserted through `probeOpenclawProviderStatus(...)` calls
- Verified the focused provider probe test target passes:
  - `npx vitest run lib/model-probe.test.ts`

**Files Changed**:
- `lib/model-probe.test.ts` - added malformed-output, invalid runtime path, missing-match, and shared-helper reuse regressions

### Task T013 - Extend gateway-health tests for CLI fallback success, malformed runtime output, and sanitized down-state responses

**Started**: 2026-03-31 09:55
**Completed**: 2026-03-31 09:56
**Duration**: 1 minute

**Notes**:
- Extended `app/api/gateway-health/route.test.ts` to cover:
  - CLI fallback success after HTTP and web probes fail
  - malformed CLI output producing a sanitized down-state error
  - preserved healthy same-origin launch path behavior
- Verified the focused gateway-health test target passes:
  - `npx vitest run app/api/gateway-health/route.test.ts`

**Files Changed**:
- `app/api/gateway-health/route.test.ts` - added CLI fallback success and malformed-output down-state coverage

### Task T014 - Extend session fallback tests for malformed output and shared parse-contract behavior

**Started**: 2026-03-31 09:55
**Completed**: 2026-03-31 09:56
**Duration**: 1 minute

**Notes**:
- Updated `lib/session-test-fallback.test.ts` to mock the hardened shared parse helper.
- Replaced the permissive raw-stdout success expectation with an explicit malformed-output failure expectation.
- Verified the focused session fallback test target passes:
  - `npx vitest run lib/session-test-fallback.test.ts`

**Files Changed**:
- `lib/session-test-fallback.test.ts` - aligned the session CLI fallback tests with the hardened shared parse contract

### Task T015 - Run focused Vitest coverage, verify ASCII and LF on touched files, manually exercise gateway health and provider probe diagnostics, and record outcomes

**Started**: 2026-03-31 10:03
**Completed**: 2026-03-31 10:04
**Duration**: 1 minute

**Notes**:
- Focused regression and coverage run passed:
  - `npx vitest run lib/openclaw-cli.test.ts lib/openclaw-paths.test.ts lib/model-probe.test.ts app/api/gateway-health/route.test.ts lib/session-test-fallback.test.ts --coverage.enabled true`
  - Result: `5` test files, `92` tests passed
  - Coverage highlights for touched helper files:
    - `lib/openclaw-cli.ts`: `91.81%` statements, `76.08%` branches
    - `lib/openclaw-paths.ts`: `97.95%` statements, `89.36%` branches
    - `lib/model-probe.ts`: `86.45%` statements, `72.16%` branches
    - `lib/session-test-fallback.ts`: `96.29%` statements, `88.46%` branches
- ASCII and LF verification passed on all touched session files:
  - `rg -n "[^\\x00-\\x7F]" ...`
  - `rg -n $'\\r' ...`
- Manual exercise passed through a temporary Vitest harness using the real route and helper modules plus a controlled mock `openclaw` binary and temp OpenClaw runtime files:
  - Gateway health success path: returned `ok: true`, `status: "healthy"`, and `launchPath: "/gateway/chat"` from the real `GET /api/gateway-health` route.
  - Provider probe success path: returned `ok: true`, `source: "direct_model_probe"`, and `model: "custom/model-1"` from the real `probeModel(...)` helper.
  - Malformed runtime failure path: returned `ok: false`, `source: "openclaw_provider_probe"`, and sanitized error `Provider probe returned malformed OpenClaw output` from the real `probeModel(...)` helper.

**Files Changed**:
- `.spec_system/specs/phase02-session02-runtime-bridge-consolidation-and-safe-parsing/implementation-notes.md` - recorded focused coverage, ASCII and LF verification, and manual exercise outcomes
