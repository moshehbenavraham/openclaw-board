# OpenClaw Bot Dashboard Mobile Adaptation Plan

## 1. Goals

- Fully support mobile devices without sacrificing the desktop experience, with priority for iPhone 12/13/14 and mainstream Android widths between 360 and 430.
- Ensure the core paths remain usable: Agents, Models, Sessions, Stats, Alerts, and Pixel Office.
- Move from merely "opens on mobile" to genuinely "operable on mobile": navigation, filtering, test buttons, overlays, charts, tables, and Pixel Office interactions must all work.

## 2. Current State and Main Issues

Based on the current code structure, the main mobile risks are:

- The global layout uses a fixed left sidebar (`RootLayout + Sidebar`), which noticeably squeezes the main content on small screens.
- Several pages use desktop spacing and dense button groups (`p-8`, multiple CTAs on a single row), which can wrap badly or overflow on small screens.
- Some pages prioritize desktop information density, especially the Models table and the Stats four-card layout, making them hard to read on phones.
- Pixel Office is a high-interaction canvas page, but touch gestures, mobile performance, and overlay readability have not been designed specifically for mobile.

## 3. Scope

- Global framework: [`app/layout.tsx`](../../app/layout.tsx), [`app/sidebar.tsx`](../../app/sidebar.tsx), [`app/globals.css`](../../app/globals.css)
- Pages: `/`, `/models`, `/sessions`, `/stats`, `/alerts`, `/skills`, `/pixel-office`
- Components: overlays, chart containers, table containers, button groups, top info bars
- Out of scope for this phase: PWA offline support, native apps, tablet-specific layout systems

## 4. Design Principles

- Mobile First: define the mobile layout first, then expand to `md` / `lg`.
- Information parity: do not remove key functionality on mobile, only adjust hierarchy and interaction patterns.
- Lower interaction cost: tap targets `>= 40px`; no critical action should depend on hover.
- Performance first: reduce high-frequency animations and unnecessary polling on mobile by default.

## 5. Solution Design

### 5.1 Global Layout and Navigation

- Change the fixed left sidebar into a responsive dual-mode layout:
  - `md` and above: keep the current sidebar.
  - Below `md`: use a top bar + drawer navigation opened by a hamburger button and closed by tapping the mask.
- On mobile, make the main area full-width and fluid, with no reserved sidebar spacer.
- Keep only the highest-priority controls in the top bar: menu, page title, and language/theme toggles, with lower-priority items allowed to collapse into the menu.

### 5.2 Shared Page Framework

- Make outer page spacing responsive:
  - Mobile: `p-3` / `p-4`
  - Desktop: `md:p-6` / `lg:p-8`
- Change top action areas from a single horizontal row to a wrapping or stacked layout:
  - Mobile: vertical grouping, with primary buttons on one row and secondary actions moved into a "more" menu or a second row.
  - Desktop: keep the horizontal layout.
- Introduce shared mobile utility rules:
  - Minimum readable font sizes (body text `>= 12px`)
  - Touch-friendly sizing classes for buttons, switches, and form controls

### 5.3 Data Presentation Strategy

- Models page:
  - Replace wide-table mode on mobile with summary cards and expandable details.
  - Keep "test model" actions, but place them in the bottom action area of each card.
- Stats page:
  - Change the four summary cards to `grid-cols-2`, with `grid-cols-1` on extra-small screens if needed.
  - Keep charts horizontally scrollable, but provide a minimum readable width and fixed titles.
- Sessions page:
  - Layer card information more clearly and de-emphasize secondary fields such as the session key, which can be collapsed by default.
  - Move test buttons into a dedicated action row so they do not fight for space with timestamps.

### 5.4 Pixel Office Mobile Adaptation

- Interaction model:
  - Add touch semantics alongside mouse semantics: tap, long-press, and drag.
  - On mobile, prioritize bottom-sheet style overlays for key furniture interactions such as the phone, clock, and sofa.
- View and performance:
  - Dynamically set default zoom and overlay sizing based on screen width.
  - Reduce non-critical animation density on mobile, such as bug count limits and floating element frequency.
- Usability:
  - Let the top agent chips scroll horizontally on mobile so they do not block the main canvas.
  - Make close areas and return paths for overlays visually obvious and easy to tap.

### 5.5 Accessibility and Readability

- Add touch-friendly focus styles and keyboard accessibility, including `Esc` to close drawers and modals.
- Re-check color contrast in light theme, especially given the existing light-mode overrides.
- Standardize truncation behavior for IDs and model names, with tooltips or expand-to-view behavior where needed.

## 6. Implementation Plan (Phased)

### Phase 1: Structural Skeleton (1-2 days)

- Complete the global responsive layout and mobile drawer navigation.
- Make page containers and top action areas responsive.
- Establish shared mobile style rules for spacing, touch targets, and font scaling.

### Phase 2: Page Adaptation (2-3 days)

- Adapt the Home, Models, Sessions, Stats, Alerts, and Skills pages.
- Convert model tables into cards, improve stats grids, and rearrange action areas.

### Phase 3: Pixel Office Adaptation (2-3 days)

- Complete touch event support, bottom-sheet overlays, and performance downgrade strategies.
- Run dedicated mobile interaction regression tests for furniture taps, overlays, back navigation, and scroll conflicts.

### Phase 4: Polish and Acceptance (1 day)

- Run regression tests across the device matrix.
- Perform performance and accessibility checks.
- Update docs and change notes.

## 7. Acceptance Criteria

- No full-page horizontal overflow at 360px width.
- Core pages become operable within 3 seconds on the first screen in a local-network scenario.
- All key buttons have a clickable area of at least `40px`.
- Pixel Office on mobile supports: opening the page, tapping furniture to open overlays, closing overlays, and navigating back to other pages.
- No blocking-level UI defects such as overlap, clipping, or untappable controls.

## 8. Test Plan

- Device coverage:
  - iOS Safari (`390x844`)
  - Android Chrome (`360x800` / `412x915`)
- Breakpoint coverage:
  - `<640`, `640~767`, `768~1023`, `>=1024`
- Scenario coverage:
  - Light/dark theme switching
  - Chinese/English switching
  - Heavy data volume (many agents, models, sessions)

## 9. Risks and Mitigations

- Risk: desktop layout regressions
  - Mitigation: use breakpoint-based incremental changes and keep desktop defaults unchanged.
- Risk: Pixel Office touch changes interfere with existing mouse interactions
  - Mitigation: abstract the input layer (`pointer` / `touch` / `mouse`) and introduce a compatibility layer before replacing call sites.
- Risk: unstable mobile performance
  - Mitigation: enable lightweight mode defaults and provide a toggle.

## 10. Deliverables

- Responsive navigation and page layout changes
- Pixel Office mobile interaction, overlay, and performance adaptations
- Test records (devices, breakpoints, issue list)
- Updated maintenance docs for adaptation rules and breakpoint standards
