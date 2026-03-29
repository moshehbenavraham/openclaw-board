# OpenBug to OpenClaw-bot-review Migration Plan

## 1. Background and Goals

### 1.1 Background

- `OpenBug` is currently a **Windows WPF transparent desktop overlay app** (`net8.0-windows`) whose core value is procedural bug-swarm animation and behavior.
- This project is a **Next.js web application** that already includes `pixel-office` canvas rendering and an entity/state-machine foundation for characters, pets, and interaction easter eggs.

### 1.2 Goals

- Bring the core OpenBug experience to the web:
1. Procedural bugs with IK-style walking visuals and swarm behavior
2. Low-distraction ambient presence as a focus companion
3. Configurable count, behavior weights, and toggles
4. Coexistence with the current Pixel Office and room for future extension

### 1.3 Non-Goals (Not in the first phase)

- No Windows-native tray functionality; use web UI instead
- No true system-level desktop overlay; browser sandboxes do not allow it
- No line-by-line C# port; rebuild in TypeScript instead

---

## 2. Migration Strategy (Recommended)

Use **"behavior-kernel migration + rendering-layer rebuild"**:

- Migrate behavior and data structures from C# to TypeScript so they remain testable and evolvable
- Plug rendering directly into the existing `pixel-office` canvas pipeline
- Ship in phases: visible first, then realism, then performance tuning

Reasons:

- The repo already has a mature loop: `OfficeState.update(dt)` + `renderFrame(...)`
- Reusing it reduces integration cost and avoids maintaining two parallel engines

---

## 3. Architecture Design

### 3.1 Module Placement

Suggested new files:

- `lib/pixel-office/bugs/types.ts`
- `lib/pixel-office/bugs/config.ts`
- `lib/pixel-office/bugs/bugEntity.ts`
- `lib/pixel-office/bugs/bugBehavior.ts`
- `lib/pixel-office/bugs/spatialGrid.ts`
- `lib/pixel-office/bugs/pheromoneField.ts`
- `lib/pixel-office/bugs/ik2d.ts`
- `lib/pixel-office/bugs/renderer.ts`

Integration points:

- [`lib/pixel-office/engine/officeState.ts`](../../lib/pixel-office/engine/officeState.ts)
  - Hold `bugSystem` and tick it in `update(dt)`
- [`lib/pixel-office/engine/renderer.ts`](../../lib/pixel-office/engine/renderer.ts)
  - Render the bug swarm before or after the character layer, with configurable ordering
- [`app/pixel-office/page.tsx`](../../app/pixel-office/page.tsx)
  - Provide UI controls such as enable/disable, count, and performance mode

### 3.2 Data Model (Core)

Suggested `BugEntity`:

- `id`
- `x, y, vx, vy, heading`
- `behaviorType: social | loner | edgeDweller`
- `state: idle | moving | interacting`
- `speedScale, turnScale`
- `legs[6]` (target point, joints, gait phase)
- `color, sizeScale`
- `trailTargetId?`
- `visible`

`BugSystemState`:

- `bugs: BugEntity[]`
- `spatialGrid`
- `pheromoneField`
- `spawnTimer`
- `swarmEventTimer/cooldown`
- `paused`

### 3.3 Update Loop

Per frame:

1. Build or update the spatial grid for neighborhood queries
2. Update the pheromone field with evaporation
3. Run behavior decisions for each bug:
   - separation / alignment / cohesion (Boids)
   - edge preference
   - wandering noise
   - mouse repulsion if enabled
4. Update movement state such as position and heading
5. Update gait and IK, including foot placement and two-bone solving
6. Write back to the render cache

---

## 4. Feature Mapping (OpenBug -> Web)

### 4.1 Behavior-System Mapping

- `AntBehaviorType` -> `BugBehaviorType` while keeping the same three major classes
- `_stateTimer` / `_wanderTimer` -> JS timer fields
- `_swarmActive` + random events -> keep the mechanic with tunable parameters
- `SpatialGrid.Query` -> TypeScript grid index equivalent
- `PheromoneField` -> TypeScript 2D grid using `TypedArray`

### 4.2 Lifecycle Mapping

- Start with 5 bugs and generate more on a timer, defaulting to every 10 minutes
- Maximum count, suggested first-release cap: 120, with performance-mode scaling
- Manual increase/decrease controls to replace the tray menu

### 4.3 UI Replacement for the Tray

Add a `Bug Panel` to the Pixel Office top bar:

1. `Enable Bugs` toggle
2. `Count` slider
3. `Spawn Interval`
4. `Performance Mode` (`low` / `medium` / `high`)
5. `Hide/Show` for pausing update + rendering

---

## 5. Rendering Plan

### 5.1 First-Release Rendering Tiers

#### V1 (Fast Launch)

- Simplified body made of head / thorax / abdomen as three ellipses plus six polyline legs
- No complex anti-aliasing effects
- Goal: validate behavior and performance first

#### V2 (More Realistic)

- Two-bone leg IK interpolation
- Improved gait phase timing such as tripod gait
- Progressive changes in color and body scale over lifetime

#### V3 (Visual Polish)

- Subtle shadows or depth illusion
- Short pause animations during swarm communication
- Optional debug visualization layer for radius and pheromone heatmaps

### 5.2 Layering Recommendation

- Floor -> furniture -> bug swarm -> characters/pets, configurable if needed
- Avoid covering major interaction hotspots such as whiteboards, clocks, and model panels

---

## 6. Performance Design

### 6.1 Budget

- Target device: mid-range laptop browser
- Metrics:
1. 60 FPS target / 30 FPS acceptable lower bound
2. No obvious interaction lag at 100 bugs
3. Controlled CPU usage without idle spikes

### 6.2 Techniques

- Neighborhood queries must use a spatial grid and never fall back to full `O(n^2)` scans
- Use sparse updates or a low-resolution grid for pheromones
- Decouple IK from behavior, for example behavior at 30Hz and rendering at 60Hz
- Minimize allocations inside `requestAnimationFrame`; prefer array reuse
- Keep debug overlays off by default

---

## 7. Persistence and Configuration

Suggested storage priority:

1. `localStorage` for per-user local preferences
2. Optional backend config API later

Suggested keys:

- `pixel-office-bugs-enabled`
- `pixel-office-bugs-count`
- `pixel-office-bugs-mode`
- `pixel-office-bugs-spawn-interval`

---

## 8. Development Milestones

### M1: Minimal Playable Version (2-3 days)

- Base `BugSystem` data structures
- Random wandering and boundary handling
- Simplified canvas rendering
- Control panel for enable/disable and count adjustment

### M2: Behavior and Ecology (3-5 days)

- `SpatialGrid` neighborhood support
- Boids three-force model plus three personality types
- Timed spawning, cap control, and pause/resume

### M3: IK and Realism (4-6 days)

- Two-bone leg IK
- Tripod gait phases
- Pheromone field and trail following

### M4: Optimization and Acceptance (2-3 days)

- Performance profiling
- Parameter tuning and default-value hardening
- Documentation and regression testing

---

## 9. Risks and Mitigations

1. **Browser performance is insufficient at high bug counts**
- Mitigation: tiered rendering, lower update frequency, and hard caps

2. **Conflicts with existing character interactions such as hit detection or visual overlap**
- Mitigation: make the bug layer order configurable and prioritize business-entity hit testing over bugs

3. **Excessive realism causes schedule creep**
- Mitigation: follow the M1 -> M4 progression strictly and avoid skipping phases

4. **Too many parameters become hard to maintain**
- Mitigation: centralize them in `config.ts` and provide presets such as `focus`, `calm`, and `chaos`

---

## 10. Acceptance Criteria (First Release)

Functional acceptance:

1. The bug-swarm system can be enabled and disabled
2. Count changes take effect immediately in both directions
3. At least three behavior preferences are supported: `social`, `loner`, and `edge`
4. Timed spawning and cap limits work

Performance acceptance:

1. Page interaction remains smooth with 80 bugs
2. No abnormal continuous memory growth after running for 30 minutes

Experience acceptance:

1. Default settings do not steal attention from the main UI
2. A "hide swarm" option exists for demos and screen recording

---

## 11. Recommended Implementation Order

1. Start with a `BugSystem` shell and minimal rendering (M1)
2. Integrate it into `officeState.update` and `renderer.renderScene`
3. Add the UI control panel
4. Then port Boids, grid, and pheromones
5. Finish with IK polish and performance tuning

---

## 12. Optional Extensions

- `Focus mode` preset: lower density, lower speed, lower distraction
- `Chaos mode` preset: higher density and more frequent swarm events
- Integration with the current pet system so cats or lobsters react to bugs
- Add a `Bug Activity` metric to the stats page
