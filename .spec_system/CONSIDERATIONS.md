# Considerations

> Institutional memory for AI assistants. Updated between phases via /carryforward.
> **Line budget**: 600 max | **Last updated**: Phase 02 (2026-03-31)

---

## Active Concerns

Items requiring attention in upcoming phases. Review before each session.

### Technical Debt
<!-- Max 5 items -->

- [P03] **Atomic alert config writes**: `app/api/alerts/route.ts` still needs rename-and-swap persistence so crash recovery cannot leave a partial config file behind.
- [P03] **Mutable config cache**: `lib/config-cache.ts` still returns shared object references; later callers must treat cached config as read-only or clone before mutation.
- [P03] **Environment path overrides need a hard boundary**: `lib/openclaw-paths.ts` should keep rejecting any filesystem override that escapes approved roots.
- [P03] **Browser storage needs retention limits**: client `localStorage` still needs pruning and expiry so operator state does not accumulate without bound.

### External Dependencies
<!-- Max 5 items -->

- [P03] **Cloudflare Access remains the non-local auth boundary**: the deployment still depends on the documented Access plus Tunnel model, not in-app JWT verification.
- [P03] **GitHub username discovery can be absent**: the pixel-office contributions widget can remain empty in minimal runtimes until identity data is available.

### Performance / Security
<!-- Max 5 items -->

- [P03] **Security headers are still incomplete**: middleware coverage needs the remaining header tightening work once the route hardening work settles.
- [P03] **Read-heavy routes must keep bounded budgets**: future read endpoints should reuse the shared async read helper instead of reintroducing sync scans or unbounded directory walks.

### Architecture
<!-- Max 5 items -->

- [P03] **New read routes should compose through shared helpers**: keep request-body, bridge, path, and read-path helpers centralized instead of duplicating route-local logic.
- [P03] **Remaining low-priority read routes are deferred intentionally**: `agent-status`, `pixel-office/idle-rank`, and `pixel-office/tracks` stayed out of phase 02 scope and should be handled deliberately in phase 03.

---

## Lessons Learned

Proven patterns and anti-patterns. Reference during implementation.

### What Worked
<!-- Max 15 items -->

- [P02] **Shared bounded request-body parsing**: reject malformed or oversize write payloads before privileged work begins.
- [P02] **Shared bridge helpers and typed failures**: one canonical parse contract prevents bridge drift and raw parser leaks.
- [P02] **Boundary-checked runtime path resolvers**: config-derived file access stays safe when it passes through one shared resolver.
- [P02] **Shared bounded async read helpers**: in-flight dedupe plus size and count limits protect hot read routes.
- [P02] **Stable sanitized failure contracts**: browser-visible route errors should stay fixed and operator-safe.
- [P01] **Shared sensitive-route guards**: central enforcement is easier to reason about than per-route ad hoc checks.
- [P00] **Dry-run-first diagnostics**: keep live-send and probe surfaces explicit and opt-in.
- [P00] **Sanitized browser payloads**: redact config and skills responses before serialization even when the caller is only rendering read-only UI.

### What To Avoid
<!-- Max 10 items -->

- [P02] **Route-local parser and bridge duplication**: it creates drift and makes fixes land inconsistently.
- [P02] **Sync I/O in request paths**: even read-only handlers can become event-loop bottlenecks.
- [P02] **Unbounded filesystem scans**: heavy analytics and skills routes need entry and byte ceilings.
- [P02] **Returning raw filesystem or parser errors to clients**: sanitize failure surfaces and keep internals server-side.
- [P01] **GET aliases for side-effect routes**: never reintroduce method aliases that can trigger hidden work.
- [P00] **Trusting config-sourced file paths without validation**: path values from config or env must pass through a shared boundary check before any filesystem access.
- [P00] **Auto-polling on page load without auth gates**: unauthenticated mount-time requests amplify volume and widen the abuse surface.

### Tool/Library Notes
<!-- Max 5 items -->

- [P02] **`lib/openclaw-cli.ts`**: canonical OpenClaw bridge surface for execution and mixed-output parsing.
- [P02] **`lib/openclaw-read-paths.ts`**: reuse for any future heavy read route needing TTL caching or in-flight dedupe.
- [P02] **`fs/promises`**: preferred baseline for request-time file access.
- [P00] **Next.js middleware runs at the edge**: keep Node-only auth logic in route handlers, not middleware.
- [P00] **Biome remains the formatting and linting baseline**: no separate ESLint path is needed for this repo.

---

## Resolved

Recently closed items (buffer - rotates out after 2 phases).

| Phase | Item | Resolution |
|-------|------|------------|
| P02 | Write payload ceilings on alert, model, and layout routes | Added bounded JSON parsing and no-write/no-gateway denial behavior before privileged work could start. |
| P02 | Duplicate runtime bridge behavior | Consolidated on shared OpenClaw bridge helpers and boundary-checked runtime resolvers. |
| P02 | CLI mixed-output parsing leaks | Hardened the parse contract and mapped malformed output to stable failures. |
| P02 | Heavy read routes without bounds or dedupe | Added bounded async read helpers, cache reuse, and sanitized failure contracts. |
| P02 | Skills route JSON parse crashes | Moved skills discovery and content reads onto safe async helpers with explicit error mapping. |

---

*Auto-generated by carryforward. Manual edits allowed but may be overwritten.*
