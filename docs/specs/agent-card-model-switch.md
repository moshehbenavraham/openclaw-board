# Agent Card Model Switching Plan

## 1. Background

The current dashboard overview page can already display the model each agent is using, but that model information is read-only. If a user wants to switch the model for an agent, they still need to edit the configuration manually.

The goal is to move that action directly into the agent card so that:

1. Users can switch an agent's model directly in the page
2. The updated configuration is persisted
3. The page immediately shows the new model
4. All related tests and displays launched from the dashboard use the new model afterward

Relevant current code:

- Home overview page: [`app/page.tsx`](../../app/page.tsx)
- Agent card component: [`app/components/agent-card.tsx`](../../app/components/agent-card.tsx)
- Config read endpoint: [`app/api/config/route.ts`](../../app/api/config/route.ts)
- Config path resolution: [`lib/openclaw-paths.ts`](../../lib/openclaw-paths.ts)

After validating the local OpenClaw capabilities, it turns out OpenClaw already exposes a gateway-side `config.patch` capability for safely applying partial config updates, and that operation automatically triggers a restart so the new configuration actually takes effect.

Because of that, this feature cannot be implemented as a frontend-only display change, and the dashboard should not write configuration files directly. It should use the standard Gateway `config.patch` flow.

## 2. Goals

Goals for this phase:

1. Add a model-switch entry point to each agent card
2. Let the user select a new model for a single agent
3. Update that agent's model through Gateway `config.patch`
4. Automatically trigger Gateway restart so the new model actually takes effect
5. Refresh dashboard data after restart so the page reflects the latest state

## 3. Non-Goals

The following are out of scope for this phase:

1. Bulk-switching models for multiple agents
2. Editing the global default model or fallback models
3. Managing provider API keys or auth profiles
4. Designing a separate reload protocol
5. Handling persistence for agents that are auto-discovered from the filesystem but do not exist in `agents.list`

## 4. User Story

As a dashboard user, I want to switch an agent's model directly from the agent card so I do not need to edit config manually, and so that the new model is automatically applied by the system afterward.

## 5. Current State Analysis

## 5.1 Source of Model Data

The current `/api/config` endpoint reads `openclaw.json` and derives:

1. `agents[]`
2. `providers[]`
3. `defaults.model`
4. `defaults.fallbacks`

The final model shown for each `agent` is derived as follows:

- Use `agent.model` first if it exists
- Otherwise fall back to the global default model

## 5.2 Current Card Capabilities

The current `AgentCard` only displays:

1. Agent name, ID, and status
2. Current model
3. Platform info
4. Session stats

It has no model-edit action and no submit callback.

## 5.3 Where the Effective Configuration Lives

For model switching to really take effect, the ultimate config field that must change is still:

`config.agents.list[i].model`

That means the config-layer behavior should be:

- If the agent already has an explicit `model`, replace it
- If the agent currently inherits the default model, add an explicit `model` entry for that agent

However, the dashboard should not write the file directly. The update should be performed through Gateway `config.patch`.

## 6. Interaction Design

## 6.1 Redesigning the Model Area in the Agent Card

The current model area contains:

- a model badge
- model test status

Recommended new behavior:

- Normal state: show the current model badge plus a `Switch Model` button
- Editing state: show a model selector plus `Save` and `Cancel`
- Saving state: disable controls and show a `Saving and applying...` state
- Failure state: keep the editor open and show an error message

The save action should make it clear to the user that it does not merely update UI state. It updates config and applies it.

## 6.2 Recommended Interaction Pattern

Use inline editing directly inside the card. Do not navigate to a separate page and do not open a heavyweight modal.

Reasons:

1. The operation stays in the clearest possible context: the user is already looking at that agent
2. The scope of change is small, so it fits the current card structure well
3. It avoids extra page-level state complexity

## 6.3 Model Selector Content

Build the selector from the existing `data.providers` returned on the home page, grouped by provider.

Each option should display:

- `providerId / model.name`
- If there is no `name`, use `providerId / model.id`

The submitted value should always use:

`providerId/modelId`

## 7. API Design

Add a dedicated write endpoint:

- `PATCH /api/config/agent-model`

Request body:

```json
{
  "agentId": "main",
  "model": "openai/gpt-4.1"
}
```

Success response:

```json
{
  "ok": true,
  "agentId": "main",
  "model": "openai/gpt-4.1",
  "applied": true
}
```

Failure response:

```json
{
  "ok": false,
  "error": "Agent not found"
}
```

## 8. Backend Implementation Plan

Suggested location for the new route:

- [`app/api/config/agent-model/route.ts`](../../app/api/config/agent-model/route.ts)

Backend flow:

1. Read the current config snapshot
2. Validate `agentId`
3. Validate `model`
4. Verify that the target model exists in the currently available provider/model list
5. Build the smallest possible patch based on the current config, changing only the target agent's `model`
6. Call Gateway `config.patch`
7. Wait for Gateway to persist the config and restart automatically
8. Clear the in-memory cache used by `/api/config`
9. Have the frontend poll or retry `/api/config` and gateway health
10. Return success

## Recommended Invocation Method

The backend must not modify `openclaw.json` directly. It should call OpenClaw through the Gateway capability instead:

1. Fetch the current config snapshot and `baseHash`
2. Submit a minimal patch through `config.patch`

Benefits:

1. Only one thing is modified, which reduces risk
2. The implementation stays aligned with OpenClaw's own config write flow
3. Restart happens automatically after writing, so the new model really takes effect
4. The dashboard avoids owning complex concurrent config-write logic

## Patch Construction Guidance

The backend should always generate the patch from the latest config snapshot plus `baseHash`. The frontend must never submit raw patch content.

Recommended approach:

1. Call Gateway `config.get`
2. Extract:
   - the current config snapshot
   - `baseHash`
3. Find the target agent in server memory
4. Update only that agent's `model`
5. Generate a minimal patch
6. Call Gateway `config.patch`

Patch goals:

- Only change the target agent's `model` inside `agents.list`
- Do not change the global default model
- Do not change fallback models
- Do not modify any other agent config
- Do not modify provider config

Implementation principles:

1. The frontend only sends `agentId` and `model`
2. The patch is generated entirely on the backend
3. Concurrency control relies entirely on `baseHash`

This minimizes the risk of accidentally damaging unrelated config.

## 9. Validation Rules

The following cases must be rejected:

1. Missing `agentId`
2. Missing `model`
3. Missing `agents.list`
4. Target agent does not exist
5. Target model does not exist in the current known provider/model list
6. Current config snapshot or `baseHash` cannot be fetched
7. Gateway `config.patch` fails

## 10. Frontend Implementation Plan

## 10.1 Home Page [`app/page.tsx`](../../app/page.tsx)

New responsibilities:

1. Derive `modelOptions` from `data.providers`
2. Implement `onModelChange(agentId, model)`
3. Call `PATCH /api/config/agent-model` in that callback
4. After success, wait until Gateway restarts and becomes available again
5. Reuse the existing `fetchData(true)` flow to refresh data
6. Pass `modelOptions` and `onModelChange` into `AgentCard`

## 10.2 Card Component [`app/components/agent-card.tsx`](../../app/components/agent-card.tsx)

Suggested new props:

```ts
modelOptions?: Array<{
  providerId: string
  providerName: string
  accessMode?: "auth" | "api_key"
  models: Array<{ id: string; name: string }>
}>
onModelChange?: (agentId: string, model: string) => Promise<void>
```

Suggested new local state:

1. `isEditingModel`
2. `draftModel`
3. `isSavingModel`
4. `modelSaveError`

## 10.3 Suggested Card Behavior

When entering edit mode:

1. Default to the current model
2. If the current model is not in the selectable list, still show a placeholder option such as `Current model (unknown)` so the user does not lose context

Conditions for enabling `Save`:

1. A model is selected
2. The new model differs from the current model
3. The card is not currently saving

After save succeeds:

1. Exit edit mode
2. Clear any error message
3. Show the latest model after the page refreshes
4. Optionally show a short success hint such as `Model applied`

After save fails:

1. Stay in edit mode
2. Keep the user's current selection
3. Display the error message

## 11. Definition of "The New Model Takes Effect"

Under this new design, "the model takes effect" means all of the following are true:

1. Gateway `config.patch` has succeeded
2. Gateway has restarted through the standard OpenClaw mechanism
3. After restart, `/api/config` returns the new model
4. The agent card shows the new model
5. Any model tests or agent tests triggered from the dashboard after that use the new model

That means this feature is not just "change config". It is "change config and apply config".

This covers:

1. What the agent card displays
2. Refresh behavior on the home page
3. Existing dashboard test logic

## 12. Runtime Notes

This plan no longer depends on uncertain hot-reload support.

Because OpenClaw's current `config.patch` implementation triggers restart after writing, the model switch becomes effective through the standard restart flow.

The product semantics should therefore be explicit:

- The dashboard initiates a model switch
- OpenClaw updates config through `config.patch`
- The system restarts automatically and then applies the new model

This is safer than assuming hot-reload support and better aligned with the current OpenClaw behavior.

## 13. Cache Handling

The current [`app/api/config/route.ts`](../../app/api/config/route.ts) uses a 30-second in-memory cache.

If nothing is done about that cache, the page may still show the old model for a short time even after Gateway has restarted successfully.

Recommended solution:

Add a shared cache module:

- [`lib/config-cache.ts`](../../lib/config-cache.ts)

Provide:

1. `getConfigCache()`
2. `setConfigCache()`
3. `clearConfigCache()`

Then:

- `GET /api/config` reads and writes through this shared cache
- `PATCH /api/config/agent-model` calls `clearConfigCache()` after success

This keeps cache logic centralized instead of spreading it across multiple files.

## 14. Security Requirements

1. The dashboard must not accept arbitrary file paths and write them directly
2. Config changes must only go through Gateway `config.patch`
3. Only validated model values can be saved
4. Only the smallest possible patch may be submitted
5. No other config fields may be modified

## 15. Edge Cases

1. The agent currently has no explicit `model`
   - Add an explicit `model` field when switching

2. The agent is auto-discovered from the filesystem but not present in `agents.list`
   - Reject the modification in this phase
   - Reason: `config.patch` requires a stable config write target

3. The provider exists, but the model is only inferred
   - Allow selection as long as it appears in the candidate model list returned by the backend

4. Multiple pages modify the same agent model at the same time
   - Rely on `baseHash` for concurrency control
   - If the underlying config changed first, require the frontend to retry

5. Gateway is restarting or temporarily unavailable
   - Show a message such as `Applying configuration, please wait`

6. `config.patch` returns a `baseHash` conflict
   - Tell the user to refresh and retry

## 16. Implementation Steps

1. Extract shared config cache
2. Add `PATCH /api/config/agent-model`
3. Wrap Gateway `config.get` and `config.patch` on the backend
4. Build the candidate model list on the home page
5. Add inline model-edit UI to `AgentCard`
6. Wait for Gateway restart after save, then refresh home-page data
7. Add error messaging
8. Add the necessary validation

## 17. Test Plan

## Manual Tests

1. Switch an agent from model A to model B and confirm the card updates
2. Observe Gateway restart briefly during the switch, then recover
3. Refresh the page and confirm model B still appears
4. Run `test all models` or `test agent` after switching and confirm the new model is used
5. Switch an agent that originally inherited the default model and confirm the patch succeeds
6. Submit an invalid model and confirm the API rejects it
7. Simulate Gateway unavailability or patch failure and confirm the card stays in edit mode with an error message

## Suggested Automated Tests

1. API test: valid `agent/model` pair triggers `config.patch`
2. API test: invalid model is rejected
3. API test: nonexistent agent is rejected
4. API test: `baseHash` conflict returns a readable error
5. API test: cache is cleared after success
6. Component test: the card can enter edit mode and submit a save

## 18. Acceptance Criteria

1. Every agent card can enter model-switch mode
2. The user can only select from a valid model list
3. The backend performs a minimal config update through Gateway `config.patch`
4. The system restarts automatically and applies the new model
5. `/api/config` returns the updated model after recovery
6. The card shows the new model without requiring a manual refresh
7. Existing dashboard test capabilities continue to work
8. Invalid input does not corrupt config

## 19. Files Involved

Suggested files:

1. [`app/components/agent-card.tsx`](../../app/components/agent-card.tsx)
2. [`app/page.tsx`](../../app/page.tsx)
3. [`app/api/config/agent-model/route.ts`](../../app/api/config/agent-model/route.ts)
4. [`app/api/config/route.ts`](../../app/api/config/route.ts)
5. [`lib/openclaw-cli.ts`](../../lib/openclaw-cli.ts)
6. Optional new file: [`lib/config-cache.ts`](../../lib/config-cache.ts)

## 20. Conclusion

Recommended implementation:

- inline editing inside the card
- a dedicated model-update API
- backend calls to Gateway `config.patch`
- use OpenClaw's standard restart flow to apply config
- clear cache and refresh the home page after success

This is the safest plan under the current code structure because it reuses OpenClaw's built-in configuration update mechanism, does not depend on uncertain hot-reload behavior, and genuinely satisfies the requirement that the new model should take effect after switching.
