# Mobile Adaptation Acceptance Checklist (Tested on Desktop)

> Project: OpenClaw Bot Dashboard  
> Test Date: ____ / __ / __  
> Tester: ________

## 1. Test Environment

- [ ] Browser: latest Chrome
- [ ] DevTools device mode enabled (`Cmd/Ctrl + Shift + M`)
- [ ] `Disable cache` checked
- [ ] Testing the same build version throughout (to avoid local cache interference)

## 2. Breakpoints and Device Matrix

### 2.1 Breakpoint Coverage

- [ ] Width 360 (small Android)
- [ ] Width 390 (iPhone 12/13/14)
- [ ] Width 412 (large Android)
- [ ] Width 768 (tablet / small desktop boundary)
- [ ] Width 1024 (desktop baseline)

### 2.2 Orientation Coverage

- [ ] Portrait
- [ ] Landscape

## 3. Global Layout and Navigation

- [ ] No full-page horizontal scrollbar (excluding local table scrolling)
- [ ] Top or side navigation opens and closes correctly
- [ ] Navigation links route to the correct pages
- [ ] Current-page highlight state is correct
- [ ] Language switch works (Chinese / English)
- [ ] Theme switch works (dark / light)

## 4. Page Usability Checks

### 4.1 Home `/`

- [ ] Hero/first-screen cards do not overlap or overflow
- [ ] Top button groups remain usable on mobile widths
- [ ] Agent card content is readable and key fields are not obscured

### 4.2 Models `/models`

- [ ] Provider sections are laid out correctly
- [ ] Tables/detail areas are browsable on mobile (scrolling or card layout works)
- [ ] Test buttons are clickable and status feedback is visible

### 4.3 Sessions `/sessions`

- [ ] Agent list card layout is correct
- [ ] Session list items do not overlap
- [ ] Test buttons and time info display correctly

### 4.4 Stats `/stats`

- [ ] Stats cards do not get cramped or overlap on mobile
- [ ] Chart area is visible and readable
- [ ] Time-range switch buttons are operable

### 4.5 Alerts `/alerts`

- [ ] Rule and trigger sections display completely
- [ ] Form inputs and toggles are usable
- [ ] Buttons provide proper click feedback

### 4.6 Skills `/skills`

- [ ] Skill card grid wraps correctly on mobile
- [ ] Tags and buttons do not overflow

## 5. Pixel Office Specific Checks `/pixel-office`

- [ ] Page opens and the first screen is visible (no blank screen or freeze)
- [ ] Canvas area displays correctly on mobile
- [ ] Tapping furniture opens the corresponding overlay (phone / clock / sofa, etc.)
- [ ] Overlay content scrolls correctly and can be closed
- [ ] No stale mask/overlay remains after navigating away
- [ ] Performance is acceptable (no obvious frame drops or stutter)

## 6. Interaction and Accessibility

- [ ] All key buttons have sufficiently large tap targets (about `>= 40px`)
- [ ] Text is readable (no large blocks of critical text below `10px`)
- [ ] Color contrast remains readable in light mode
- [ ] No critical feature depends only on hover

## 7. Regression and Stability

- [ ] Repeatedly switching pages 10 times does not cause obvious layout corruption
- [ ] Layout remains stable after changing language or theme
- [ ] Page refresh preserves a valid state and layout

## 8. Issue Log Template

| ID | Page | Device / Width | Steps to Reproduce | Actual Result | Expected Result | Severity |
|---|---|---|---|---|---|---|
| 1 |  |  |  |  |  |  |
| 2 |  |  |  |  |  |  |
| 3 |  |  |  |  |  |  |

## 9. Acceptance Result

- [ ] Pass (ready to release)
- [ ] Conditional pass (low/medium priority issues remain)
- [ ] Fail (blocking issues exist)
