# Pixel Office Page Port to OpenClaw Bot Dashboard - Technical Plan

I want to recreate the functionality from `/Users/manruixie/code/pixel_agent/pixel-agents` inside `/Users/manruixie/code/pixel_agent/OpenClaw-bot-review`, by adding a new page to the OpenClaw-bot-review project. Please design the technical approach first; implementation is not needed yet.

The proposed technical approach is as follows:

## Pixel Agents Page Port to OpenClaw Bot Dashboard - Technical Plan

### 1. Goal

Add a new `/pixel-office` page to OpenClaw-bot-review, a Next.js web dashboard, and recreate the core behavior of pixel-agents: a pixel-art virtual office where each OpenClaw agent appears as an animated character whose behavior reflects the agent's working state in real time.

### 2. Core Differences and Adaptation

| Dimension | Original (VS Code extension) | Ported version (Next.js web) |
|---|---|---|
| Data source | Watches JSONL files under `~/.claude/projects/` | Reads OpenClaw session state and agent config through APIs |
| Agent discovery | Manual terminal creation / JSONL scanning | Reads all agent entries from `openclaw.json` |
| State updates | VS Code Webview `postMessage` | SSE (Server-Sent Events) or WebSocket/polling |
| Runtime environment | VS Code Webview (restricted browser) | Standard browser |
| Asset loading | Embedded base64 sprite data | Also embedded, or moved into `/public` static assets |

### 3. Architecture Design

```text
app/
  pixel-office/
    page.tsx              <- page entry (client component)
    components/
      PixelOffice.tsx     <- main component, manages Canvas + game loop
      ToolOverlay.tsx     <- tool-status overlay (reusing original logic)
      OfficeToolbar.tsx   <- bottom toolbar (layout edit, zoom, etc.)
  api/
    agent-activity/
      route.ts            <- endpoint for pushing or serving agent realtime state
lib/
  pixel-office/
    engine/
      officeState.ts      <- office state manager (ported directly)
      characters.ts       <- character state machine (ported directly)
      gameLoop.ts         <- Canvas game loop (ported directly)
      renderer.ts         <- renderer (ported directly)
    sprites/
      spriteData.ts       <- pixel sprite data (ported directly)
      spriteCache.ts      <- sprite cache (ported directly)
    layout/
      tileMap.ts          <- tile map and BFS pathfinding (ported directly)
      layoutSerializer.ts <- layout serialization (ported directly)
      furnitureCatalog.ts <- furniture catalog (ported directly)
    types.ts              <- type definitions (ported + adapted)
    agentBridge.ts        <- new core adaptation layer: maps OpenClaw agent state to character actions
```

### 4. Key Module Design

#### 4.1 Agent State Bridge (`agentBridge.ts`)

This is the core adaptation layer for the port. The original system derives agent state by parsing Claude Code JSONL transcripts. The ported version should instead read from OpenClaw.

```ts
interface AgentActivity {
  agentId: string
  state: 'idle' | 'working' | 'waiting' | 'offline'
  currentTool?: string
  toolStatus?: string
  lastActive: number
}
```

Two options for data retrieval:

- Option A - Polling:
  - The frontend calls `/api/agent-activity` every 10 seconds.
  - The backend reads OpenClaw session files and derives the latest state.
- Option B - SSE push:
  - The backend watches session file changes and pushes updates through SSE.

Recommendation: start with Option A because it is simpler and more reliable, then upgrade to SSE later if needed.

#### 4.2 Backend API (`/api/agent-activity/route.ts`)

Responsibilities:

- Read the latest session state for each agent
- Data sources:
  1. Session files under `~/.openclaw/...`
  2. Recent message history to determine the current agent state
  3. `openclaw.json` for the agent list and model info

```ts
interface AgentActivityResponse {
  agents: Array<{
    id: string
    name: string
    emoji: string
    state: 'idle' | 'working' | 'waiting' | 'offline'
    currentTool?: string
    toolStatus?: string
  }>
}
```

#### 4.3 Game Engine Layer (Direct Port)

These modules can be ported almost as-is, with `vscode` dependencies removed:

- `officeState.ts`: office-state management, character add/remove, seat assignment, collision handling
- `characters.ts`: character state machine (`IDLE -> WALK -> TYPE`) and BFS pathfinding
- `gameLoop.ts`: `requestAnimationFrame` game loop
- `renderer.ts`: Canvas 2D rendering, z-sorting, sprite drawing
- `sprites/`: sprite data and sprite caching
- `layout/`: map, furniture, and pathfinding

#### 4.4 Main Frontend Component (`PixelOffice.tsx`)

Core flow:

1. Fetch the agent list from `/api/config` and create one character per agent
2. Poll `/api/agent-activity` for realtime state and update character animation/state
3. Render the Pixel Office through the canvas game loop
4. Support character click interactions to show agent details or navigate to the session page

```ts
function PixelOffice() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const officeRef = useRef<OfficeState>(new OfficeState())

  // Initialize: load agents and create characters
  // Poll: fetch agent state and update characters
  // Render: start gameLoop
}
```

#### 4.5 Sidebar Integration

Add a new item to `NAV_ITEMS` in `sidebar.tsx`:

```ts
{
  group: "nav.monitor",
  items: [
    // ...existing items
    { href: "/pixel-office", icon: "🎮", labelKey: "nav.pixelOffice" },
  ],
}
```

### 5. State Mapping Rules

| OpenClaw Agent State | Character Behavior |
|---|---|
| `working` (active session exists) | Sit at workstation and play typing animation (`TYPE`) |
| `working` + using Read/Grep tool | Sit at workstation in a reading animation |
| `idle` (> 5 min no activity) | Stand up and wander (`IDLE -> WALK`) |
| `waiting` (waiting for user input) | Show a speech/status bubble (`💬`) |
| `offline` (no session) | Hidden or shown as grayed-out and static |

### 6. Layout Persistence

The original system stores layout in `~/.pixel-agents/layout.json`.  
The ported version can instead:

- store it in `~/.openclaw/pixel-office/layout.json`
- read and write it through `/api/pixel-office/layout`

### 7. Suggested Implementation Order

1. Build the page skeleton:
   - `/pixel-office/page.tsx`
   - sidebar entry
   - i18n entry
2. Port the engine layer:
   - move pure logic into `lib/pixel-office/`
   - remove `vscode` dependencies
3. Implement the agent-state API:
   - `/api/agent-activity`
   - read OpenClaw session data
4. Implement the bridge layer:
   - `agentBridge.ts`
   - map API data into character state
5. Assemble the main component:
   - canvas rendering
   - polling
   - interactions
6. Add the layout editor:
   - can be deferred to Phase 2

### 8. Work Estimate

- Phase 1 (core functionality): engine port + API + base page -> about 2-3 days
- Phase 2 (full experience): layout editor + sound + subagent visualization -> about 1-2 days

---

The core idea of this plan is:

- Port the game engine layer mostly as-is
- Replace the original Claude Code JSONL parsing with OpenClaw agent/session data
- Focus the adaptation work on the data bridge rather than rewriting the engine
