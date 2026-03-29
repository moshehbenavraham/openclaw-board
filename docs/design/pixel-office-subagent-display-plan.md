# Pixel Office Subagent Display Plan (Design Only)

## 1. Background and Current State

The current Pixel Office already has some foundational subagent support:

- `/api/agent-activity` can already return `subagents[]`, inferred from `tool_use` / `tool_result` entries in session logs.
- `syncAgentsToOffice` already supports subagent creation and removal through `addSubagent` / `removeSubagent`.
- However, the top agent area only displays main agents, not subagents.
- Subagents can already be created on the canvas, but their label has not been standardized to `Contractor`.

As a result, users still do not get a clear sense of the subagent lifecycle.

## 2. Goals

- Display subagents explicitly on the Pixel Office page.
- Standardize the subagent display name to `Contractor`.
- Keep subagents in the Pixel Office permanently displayed as `working` while they exist, with no `idle`, `waiting`, or `offline` state.
- Show a subagent as soon as it is created and remove it immediately when it ends, based on the existing polling cadence.
- Keep the behavior compatible with both mobile and desktop layout logic.

## 3. Non-Goals

- No changes to the card structure on the main dashboard page (`/`).
- No new permission model or dedicated subagent settings page.
- No refactor of the current rendering engine or pathfinding logic.

## 4. Core Plan

## 4.1 Data Layer (API)

Continue using `/api/agent-activity` to return `subagents`, but normalize it so it only returns active subagents:

- Creation rule: a `tool_use` entry appears that matches a subtask/subagent pattern.
- Completion rule: when the matching `tool_result` appears, remove it from the active set.
- If the parent agent enters `idle` or `offline`, force `subagents = []` to avoid stale entries.

Keep the response shape unchanged for minimal code churn:

```ts
subagents?: Array<{
  toolId: string
  label: string // frontend does not use this yet; always render as "Contractor"
}>
```

## 4.2 Sync Layer (`agentBridge` / `officeState`)

- Keep using `toolId` as the lifecycle key for each subagent.
- Continue diff-based sync in `syncAgentsToOffice`:
  - Newly appeared `toolId` => `addSubagent`
  - Missing `toolId` => `removeSubagent`
- After creating a subagent, always set `ch.label = 'Contractor'`.
- After creating a subagent, force it into an active working state:
  - `office.setAgentActive(subId, true)`
  - no waiting bubble
  - do not feed it into the parent agent's `idle` / `offline` state transitions
- When removing it, reuse the existing despawn animation and seat-release logic.

## 4.3 Presentation Layer (Pixel Office Page)

Extend the top agent area so it renders a unified list of main agents plus subagents:

- Flatten `agents` into `displayAgents`:
  - Main agents continue to render normally.
  - Subagents are represented as virtual display items, suggested key: `${agentId}:${toolId}`.
- Subagent display rules:
  - Name is fixed as `Contractor`
  - Status is fixed to `working`
  - Styling may match a normal working agent, with an optional lightweight marker such as a `SUB` badge

The existing mobile 3x3 pagination and desktop wrapping logic should both consume `displayAgents` directly, with no special-case branch.

## 5. Lifecycle Definition

- `Starts showing`: the current `agent-activity` poll returns that `toolId`
- `Stops showing`: the current poll no longer returns that `toolId`, or the parent agent is no longer working
- `State definition`: a subagent is always treated as `working` for its entire visible lifetime
- Consistency rule: the frontend should not add long-lived caches or delayed retention; it should follow polling output strictly

## 6. Edge Cases

- Multiple subagents under the same parent agent: show multiple `Contractor` entries, even with duplicate names
- Parent agent goes offline: remove both the main agent and all of its subagents
- Log parsing fails: return no subagents for that polling cycle, but do not block the main agent display
- Rapid creation and completion within one polling interval: may be skipped, which is acceptable under a polling-based model

## 7. Definition of Done

- When a parent agent creates a subtask, a `Contractor` entry appears at the top of Pixel Office
- When the subtask completes, the `Contractor` entry disappears
- The matching subagent label on the canvas also shows `Contractor`
- The subagent always appears as `working` in both the canvas and top list, with no `idle`, `waiting`, or `offline` state
- Both mobile and desktop layouts remain stable
- No regressions in main-agent state, status bubbles, stats panels, or performance

## 8. Suggested Implementation Steps

1. API: normalize active subagent output and tie it to parent-agent state  
2. Bridge / Office: apply the unified `Contractor` label on creation and remove immediately on completion  
3. Pixel Office UI: introduce flattened `displayAgents` rendering  
4. Integration and regression: mobile/desktop, single/multiple subagents, and navigation-away / return flows  

---

This document is a design draft only and does not include code implementation.
