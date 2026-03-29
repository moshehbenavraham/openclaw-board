# Pixel Office - Gateway Health SRE Character Plan (Design Only)

## 1. Goals

- Add a special Pixel Office character type tightly bound to OpenClaw `gateway` health: the `On-call SRE`.
- Let users recognize gateway state changes at a glance through visible behavior changes, improving observability and adding a lightweight game-like feedback loop.
- This document is design only and does not include implementation.

## 2. Non-Goals

- No automatic gateway restart or self-healing strategy in this phase.
- No changes to the existing agent/subagent business-state semantics.
- No structural layout changes for desktop or mobile; only a new character and behavior layer.

## 3. Character Definition

- Character name: `On-call SRE`
- Display text:
  - Chinese: `值班SRE`
  - English: `On-call SRE`
- Uniqueness: only one such system character exists per Pixel Office page and it does not count against the normal agent roster.

## 4. State Model (Gateway -> Character)

Define three states:

1. `healthy`
- Condition: `/api/gateway-health` returns `ok=true` and response time stays below a threshold.
- Behavior: slow patrol in a fixed area with a green label.

2. `degraded`
- Suggested conditions:
  - Response time nears the timeout ceiling for `N` consecutive checks (suggested: 2), or
  - `ok=true` but latency exceeds a threshold (suggested: `>1500ms`)
- Behavior: alert patrol with faster movement and a flashing yellow label, prioritizing the gateway area.

3. `down`
- Condition: `ok=false` such as `ECONNREFUSED`, timeout, or non-2xx HTTP status.
- Behavior: sprint to a designated "firefighting" point near the gateway workstation and remain there with a flashing red label.

Recovery rule:

- `down/degraded -> healthy` should require `M` consecutive successful healthy results (suggested: 2) to avoid state flapping.

## 5. Data Flow Design

Existing endpoint: `GET /api/gateway-health` returns `{ ok, error?, data?, webUrl? }`.

Recommended backward-compatible additions:

- `checkedAt`: millisecond timestamp
- `responseMs`: response time for the current check
- `status`: `healthy | degraded | down`
  - If the backend does not calculate this, the frontend can derive it from `ok + responseMs + consecutive failure count`

Polling strategy:

- Reuse the current 10-second polling cadence to avoid additional pressure.
- Pixel Office and the top-level gateway status component should share the same cached health state, so a single request can feed multiple consumers.

## 6. Pixel Office Behavior Design

### 6.1 Spawn and Persistence

- Create the system character `sre-gateway-1` when the page loads.
- If gateway status is unknown, keep the character idle at a standby position with a gray `Monitoring` label.

### 6.2 Behavior Zones

- Patrol zone: upper-right office area plus the corridor entrance, avoiding the break area to reduce distraction.
- Firefighting point: near the gateway workstation, suggested around the existing `pc-r` tile.

### 6.3 Animation and Speed

- `healthy`: `moveSpeedMultiplier = 0.9`
- `degraded`: `moveSpeedMultiplier = 1.4` with label flashing
- `down`: `moveSpeedMultiplier = 2.2`, directly rush to the firefighting point, then perform a small back-and-forth loop after a short stay

### 6.4 Labels and Tooltips

- Overhead label:
  - Healthy: `Fire Captain` (green)
  - Degraded: `Fire Captain` (yellow)
  - Down: `Fire Captain` (dark red + flashing)
- Hover tooltip:
  - `Gateway healthy`
  - `Gateway degraded: latency high`
  - `Gateway down: <error message>`

## 7. Code Placement (Implementation Guidance)

Design only; do not implement in this document.

1. [`app/api/gateway-health/route.ts`](../../app/api/gateway-health/route.ts)
- Add `responseMs` and `checkedAt`, and optionally `status`.

2. [`app/pixel-office/page.tsx`](../../app/pixel-office/page.tsx)
- Introduce gateway health polling or reuse a shared store.
- Feed the health state into the office engine.

3. [`lib/pixel-office/engine/officeState.ts`](../../lib/pixel-office/engine/officeState.ts)
- Add system-character helpers such as `ensureGatewaySre()` and `updateGatewaySreState()`.
- Add a three-state behavior machine and target-point selection.

4. [`lib/pixel-office/engine/characters.ts`](../../lib/pixel-office/engine/characters.ts)
- Reuse the existing WALK / IDLE framework and add SRE-specific behavior strategies such as patrol vs. firefighting.

5. [`lib/pixel-office/engine/renderer.ts`](../../lib/pixel-office/engine/renderer.ts)
- Render label colors and flashing based on SRE state.

6. [`lib/i18n.tsx`](../../lib/i18n.tsx)
- Add new copy keys under `pixelOffice.gatewaySre.*`.

## 8. Configuration and Thresholds

Suggested configurable values:

- `gatewaySre.pollMs = 10000`
- `gatewaySre.degradedLatencyMs = 1500`
- `gatewaySre.downConsecutiveFailures = 2`
- `gatewaySre.recoverConsecutiveSuccess = 2`
- `gatewaySre.patrolRadiusTiles = 5`

## 9. Test Plan

Functional tests:

- Stop the gateway manually: the character should enter `down` behavior within 1 to 2 polling intervals.
- Restore the gateway: it should return to `healthy` after consecutive successful checks.
- Artificially inject slow responses: it should enter `degraded`.

Regression tests:

- Must not affect movement, seat selection, labels, or tooltips for normal agents or subagents.
- The SRE character must display correctly on both desktop and mobile without causing lag.

## 10. Risks and Mitigations

- Risk of state flapping: use consecutive counters and delayed recovery.
- Rendering performance risk: only one additional system character is added, reusing the existing frame loop, so the impact should remain small.
- Semantic collision risk: use a dedicated `id` and an `isSystemRole` marker so the SRE is not confused with business agents.

## 11. Acceptance Criteria

- The SRE character is visible after entering Pixel Office.
- The SRE behavior changes within an acceptable delay when gateway health changes.
- Overall page FPS does not drop noticeably and existing interactions do not regress.
