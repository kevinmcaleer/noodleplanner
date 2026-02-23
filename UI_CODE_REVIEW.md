# Noodle Planner - Frontend UI Code Review

**Date:** 2026-02-23
**Scope:** All frontend code in `packages/noodle-web/` (HTML templates, JavaScript, CSS)
**Files reviewed:**
- `templates/index.html` (~2,026 lines)
- `static/script.js` (~14,389 lines)
- `static/kanban.js` (~3,477 lines)
- `static/planning-room.js` (~1,496 lines)
- `static/style.css` (~7,759 lines)
- `templates/_editor_toolbar.html` (~33 lines)

---

## Executive Summary

This review identified **150+ distinct UI issues** across the frontend codebase. The findings are grouped by severity and category below. The most critical issues involve **security vulnerabilities (XSS)**, **memory leaks from unremoved event listeners**, **missing null checks causing crashes**, and **completely broken features** (e.g., undo/redo, flow file upload). There are also widespread **accessibility gaps** and **performance concerns** that will degrade experience on mobile devices and with large plans.

### Issue Breakdown by Severity

| Severity | Count | Description |
|----------|-------|-------------|
| **Critical** | 8 | Broken features, XSS vulnerabilities, crashes |
| **High** | 25 | Memory leaks, missing null checks, data corruption |
| **Medium** | 45 | Performance, race conditions, state bugs |
| **Low** | 75+ | Accessibility, styling inconsistencies, dead code |

---

## 1. CRITICAL: Broken Features

### 1.1 `handleFlowUpload` function does not exist
**File:** `planning-room.js:131`
```javascript
flowUpload.addEventListener('change', handleFlowUpload);
```
The function `handleFlowUpload` is never defined. Uploading a flow file will throw `ReferenceError` and silently fail. **The flow file upload feature is completely broken.**

### 1.2 `renderPlan()` called but does not exist
**File:** `planning-room.js:1194`
```javascript
renderPlan(); // Should be renderText()
```
Inside `copyToEditor()`, `renderPlan()` is called but does not exist anywhere. The "Copy to Editor" button in the planning room will crash with a `ReferenceError`.

### 1.3 Undo/Redo system is non-functional
**File:** `planning-room.js` (throughout)
`saveUndoState()` is only called once during `initPlanningRoom()` at line 69. No subsequent user actions (editing outline, moving nodes, creating/deleting edges, generating plan) ever call it. Ctrl+Z / Ctrl+Shift+Z will never have anything to undo or redo. Additionally, the undo history index calculation at lines 1295-1299 has an off-by-one bug when `maxSize` is exceeded.

### 1.4 `renameLabel` uses undefined variable `trimmedNewName`
**File:** `kanban.js:2904`
```javascript
lines[i] = line.replace(labelPattern, `#${trimmedNewName}`);
```
The variable defined is `normalizedNewName` (line 2845), but `trimmedNewName` is referenced. This throws `ReferenceError` at runtime, so **label renaming on task lines is completely broken** (though the front matter rename succeeds).

### 1.5 `removeLabel` corrupts `inFrontMatter` state
**File:** `kanban.js:3077-3101`
The `inFrontMatter` variable is left in an inconsistent state (`true`) after the first loop. The second loop reuses it, causing it to misidentify the first `---` as the *end* of front matter, potentially stripping labels from front matter resource lines.

### 1.6 Broken regex in Task class
**File:** `script.js:6446-6465`
```javascript
extractIndent(line) {
    const match = line.match(/^(\\s*)/);  // Matches literal \s, not whitespace!
    return match ? match[1] : '';
}
```
In regex literals, `\\s` matches the literal characters `\s`, not the whitespace character class `\s`. This means `extractIndent` always returns an empty string, breaking plan hierarchy indentation. The same issue affects `parseFromLine` at line 6465 where `\\d` and `\\s` patterns are used.

### 1.7 SVG rect painted over text in flow diagram
**File:** `planning-room.js:714-730`
Duration and resource text elements are appended to the SVG group *before* the rectangle. Since SVG paints in document order, the rectangle renders on top of the text, making duration and resource labels invisible.

### 1.8 Keyboard shortcuts override textarea editing
**File:** `planning-room.js:1353-1416`
The global keyboard shortcut handler doesn't check if the user is typing in a text input. Ctrl+Z (undo) prevents the browser's native undo in the outline editor textarea, replacing it with the non-functional custom undo system.

---

## 2. CRITICAL: Security Vulnerabilities (XSS)

### 2.1 Template card innerHTML injection
**File:** `script.js:5087-5101`
```javascript
card.innerHTML = `
    <h3>${template.title}</h3>
    <p class="template-description">${template.description}</p>
    <span class="template-author">by ${template.author}</span>
    <button onclick="useTemplate('${template.id}')">Use This Template</button>
`;
```
All template fields from the API are injected directly into `innerHTML` without escaping. A crafted `template.id` like `'); alert('xss` breaks out of the onclick handler.

### 2.2 Dependency row task names unescaped
**File:** `script.js:5690-5707`
`taskName` from user-editable content is injected into `innerHTML` via `value="${taskName}"`. A task name containing `">` can inject arbitrary HTML.

### 2.3 Category names from API injected unescaped
**File:** `script.js:5056-5061`
```javascript
li.innerHTML = `<a onclick="filterTemplates('${category}')">${category}</a>`;
```
Category values containing `'` or `"` break the HTML and enable script injection.

### 2.4 Kanban breadcrumb XSS
**File:** `kanban.js:825`
```javascript
crumbEl.innerHTML = `<a href="#">${crumb.name}</a>`;
```
`crumb.name` comes from user-provided task names and is not escaped. The `escapeHtml` method exists at line 1592 but is never called here.

### 2.5 Resource/user names in workload view unescaped
**File:** `script.js:12769-12776`
```javascript
header.innerHTML = `<h3>${user}</h3>`;
```
Resource names from plan text are injected directly into innerHTML.

### 2.6 File name unescaped in drop zone
**File:** `script.js:1074`
```javascript
dropZone.innerHTML = `<p>Selected: ${file.name}</p>`;
```
A filename containing HTML will be rendered as HTML.

### 2.7 Analysis insight items contain user data
**File:** `script.js:11937`
```javascript
itemsHTML += '<li>' + item + '</li>';
```
Items are constructed from user plan data (resource names, task names) without escaping.

---

## 3. HIGH: Memory Leaks & Event Listener Issues

### 3.1 Gantt bar drag listeners never removed
**File:** `script.js:5483-5485`
```javascript
document.addEventListener('mousemove', onMouseMove);  // NEVER REMOVED
document.addEventListener('mouseup', onMouseUp);       // NEVER REMOVED
```
Every Gantt re-render adds new `mousemove` and `mouseup` listeners to `document` for each bar. Old bars are destroyed via `innerHTML = ''`, but the document-level listeners are never removed. After several re-renders, hundreds of orphaned listeners accumulate, each running on every mouse movement. **This is the most impactful performance bug in the codebase.**

### 3.2 Piechart popup close handler leaks
**File:** `script.js:5955-5961`
If the popup is removed by DOM re-render rather than by clicking outside, the `closeHandler` on `document` is never removed.

### 3.3 Subtask resource picker close handler leaks
**File:** `script.js:7253`
Same pattern -- the `document` click handler persists if the picker is removed by re-render.

### 3.4 Flow diagram drag double-registration
**File:** `planning-room.js:880-881`
If `onNodeMouseDown` fires twice rapidly (e.g., double-click), `mousemove` and `mouseup` listeners are registered twice on `document` before the first `mouseup` fires.

### 3.5 Colour picker close handler in kanban not cleaned up
**File:** `kanban.js:3271-3278`
`hideColumnColourPicker` removes the DOM element but does not remove the `mousedown` listener from `document`.

### 3.6 Bidirectional editor sync causes double processing
**File:** `script.js:10370-10384`
Every keystroke in either editor triggers `dispatchEvent(new Event('input'))` on the other, which fires the full processing pipeline (syntax highlighting, auto-save, debounced render) twice per keystroke.

---

## 4. HIGH: Missing Null Checks (Crash Risks)

At least **25+ functions** access DOM elements via `getElementById` without null-checking the result. A missing element causes an uncaught `TypeError` that halts the entire calling function. Key locations:

| Function | File:Line | Element(s) at risk |
|---|---|---|
| `openDetailPane` | script.js:97-109 | `detailPaneOverlay`, `detailPane` |
| `render` | script.js:1330-1332 | spinner, message, output |
| `showMessage` | script.js:6368-6372 | message element |
| `openMilestoneTaskForm` | script.js:6927-6954 | `planEditor` |
| `updateRagDisplay` | script.js:7590-7593 | `ragDisplay`, `ragReasoning` |
| `updateProgressBar` | script.js:7596-7617 | `progressBar`, `progressText` |
| `filterTemplates` | script.js:9118 | querySelector result |
| `populateProjectDetailsFromFrontMatter` | script.js:9968 | `planEditor` |
| `clearProjectDetailsForm` | script.js:10071-10080 | multiple form inputs |
| `openRaidForm` | script.js:10949-10966 | multiple form inputs |
| `updateRaidFormScore` | script.js:10989-10994 | `raidScoreDisplay` |
| `showInspectorEmpty` | script.js:14028-14032 | `inspectorBody`, `inspectorTaskTitle` |
| `switchPlanningStage` | planning-room.js:151,157 | stage tab/content elements |
| `setFlowMode` | planning-room.js:1101 | flow mode button |
| `parseOutline` | planning-room.js:192 | `outlineEditor` |
| `syncOutlineToFlow` | planning-room.js:543 | `outlineEditor` |
| `formatDateShort` | script.js:13137-13141 | crashes on null from `parseLocalDate` |
| `Content-Type` header | script.js:1357 | `response.headers.get()` can return null |
| `column.name` in kanban | kanban.js:1077 | produces `"undefined column"` ARIA labels (should be `column.title`) |

---

## 5. HIGH: Duplicate/Conflicting Function Definitions

### 5.1 `escapeHtml()` defined twice -- second removes null safety
**File:** `script.js:11136` and `script.js:12187`
The second definition lacks `if (!text) return ''`, so `escapeHtml(null)` produces the literal string `"null"` in the UI wherever a missing value passes through it.

### 5.2 `handleDependencyInput()` defined twice with different signatures
**File:** `script.js:8373` and `script.js:8616`
The second overwrites the first. The first uses hardcoded element IDs; the second takes an `input` parameter. Dead code confusion.

### 5.3 `handleDependencyKeydown()` and `selectDependency()` also duplicated
**File:** `script.js:8419/8657` and `script.js:8457/8696`

### 5.4 `isWeekend()` defined identically twice
**File:** `script.js:2573` and `script.js:6641`

---

## 6. MEDIUM: Performance Issues

### 6.1 Full SVG re-render on every mouse move during drag/pan
**File:** `planning-room.js:896, 1048`
`renderFlowDiagram()` clears and rebuilds the *entire* SVG DOM on every `mousemove` event during node dragging or panning. No `requestAnimationFrame` throttling. Will cause severe jank with many nodes.

### 6.2 No debounce on `saveTask()` from autocomplete inputs
**File:** `script.js:8385-8770`
Every keystroke in dependency, resource, or label autocomplete triggers `saveTask()` which reads the entire editor, parses the task line, reconstructs the editor content, and dispatches an input event. O(n) on every keystroke.

### 6.3 Syntax highlighting rebuilt entirely on every keystroke
**File:** `script.js:519, 549`
Line numbers and the highlight layer are rebuilt from scratch via `innerHTML` on every input event. For 500+ line plans this is expensive.

### 6.4 Scroll handlers without throttle
**File:** `script.js:627, 9484-9496`
`syncScroll` runs on every scroll event. The Gantt scroll sync sets and immediately resets an `isSyncing` flag synchronously, providing no actual debounce.

### 6.5 Resizer/splitter mousemove without requestAnimationFrame
**File:** `script.js:9374-9387, 9425-9440`

### 6.6 `hasSubtasks()` is O(n) called for every card -- O(n^2) total
**File:** `kanban.js:276-303`

### 6.7 `filterTasksByHierarchyLevel` has O(n^3) complexity
**File:** `kanban.js:381-405`

### 6.8 `innerHTML +=` destroys event listeners on "Fix It" buttons
**File:** `script.js:11881`
Using `innerHTML +=` serializes and re-parses existing DOM, destroying all previously attached click handlers on "Fix It" buttons in the analysis panel.

### 6.9 RAID table render triggers cascading re-renders
**File:** `script.js:11128-11130`
`renderRaidTable` calls `syncRaidLogToPlanText` which modifies the editor and dispatches `input`, which triggers the kanban sync, which dispatches another event -- a potential cascade.

---

## 7. MEDIUM: State Management & Race Conditions

### 7.1 30+ global mutable state variables
**File:** `script.js` (throughout)
All state is stored in module-level mutable variables with no encapsulation. Any function can modify any state at any time.

### 7.2 `render()` allows concurrent calls
**File:** `script.js:1323-1407`
No guard prevents multiple concurrent API calls. A fast double-trigger causes the first response to overwrite the second.

### 7.3 `saveTask()` + `renderText()` race via setTimeout
**File:** `script.js:7964`
`saveTask()` triggers `renderText()` after 10ms. Calling `saveTask()` again within that window creates stale data.

### 7.4 Calendar day calculation uses calendar days, not working days
**File:** `script.js:7449-7454`
`onDateChange` calculates duration as calendar days (including weekends), but the rest of the system uses working days. Changing dates in the task form produces incorrect durations.

### 7.5 `toISOString().split('T')[0]` timezone mismatch
**File:** `script.js:6534, 6726, 6735, 6743, 7484`
`toISOString()` converts to UTC. In negative UTC offsets, displayed dates can be off by one day. Other code correctly uses `formatLocalDate()`, but the `Task` class does not.

### 7.6 `kanbanIsUpdating` flag not resilient to errors
**File:** `kanban.js` (multiple locations)
If any code inside the `setTimeout` callbacks throws, `kanbanIsUpdating(false)` never executes, permanently disabling auto-sync from the editor.

### 7.7 Double-fire bug on Enter in inline Gantt editing
**File:** `script.js:5354-5366`
Both `blur` and `keydown` Enter handlers call `saveEdit()`. Pressing Enter triggers both (Enter -> saveEdit -> DOM removal -> blur -> saveEdit again).

### 7.8 Confetti spawns on every re-render for 100% tasks
**File:** `script.js:5912-5918`
`updatePiechartAppearance` fires confetti for every 100%-complete task on every Gantt re-render, not just when the user changes progress.

---

## 8. MEDIUM: Responsive Design & Layout Issues

### 8.1 Hardcoded inline grid layouts on forms
**File:** `index.html:1321, 1337, 1366, 1400, 1459`
```html
<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
```
Inline styles cannot be overridden by media queries. On mobile, form fields will be squeezed to unusable widths.

### 8.2 Resizer/splitter min-widths break on narrow screens
**File:** `script.js:9380-9381`
`minWidth = 300` and `maxWidth = container.offsetWidth - 300 - 5` means on screens <605px, `maxWidth < minWidth` and the splitter becomes non-functional.

### 8.3 Welcome screen 330px top padding
**File:** `style.css:2609`
`padding: 330px 20px 200px 20px` pushes content off-screen on short viewports with no media query reduction.

### 8.4 Detail pane 600px width overflows on tablets
**File:** `style.css:3300`
On screens 601-768px wide, the detail pane overflows. Mobile query only kicks in at 768px.

### 8.5 `100vh` vs `100%` height inconsistency
**File:** `style.css:22-34`
`.container-fluid` uses `height: 100%` while `.container` uses `height: 100vh`. On mobile browsers (where URL bars shrink/expand), `100vh` is larger than visible viewport.

### 8.6 No mobile touch support for kanban drag-and-drop
**File:** `kanban.js` (entire file)
The HTML5 Drag and Drop API has no native support on most mobile browsers. Cards are completely immovable on mobile devices. No `touchstart/touchmove/touchend` handlers exist.

### 8.7 No print stylesheet
**File:** `style.css`
Zero `@media print` rules. Printing includes navigation, dark editor panels, drag handles, and animations.

---

## 9. LOW-MEDIUM: Accessibility Issues

### 9.1 Navigation menu items are `<div>` elements, not focusable
**File:** `index.html:118-225`
All dropdown items use `<div onclick="...">` with no `tabindex`, `role="menuitem"`, or keyboard handlers.

### 9.2 No `:focus` styles on any buttons
**File:** `style.css` (throughout)
14+ interactive element classes (`.tab`, `.btn`, `.btn-primary`, `.btn-secondary`, `.save-btn`, `.export-btn`, `.close-btn`, `.drill-down-btn`, `.fix-it-btn`, `.template-use-btn`, `.raid-action-btn`, etc.) have `:hover` states but no `:focus` states. Keyboard users have no visible focus indicator.

### 9.3 Close buttons have no `aria-label`
**File:** `index.html:1315, 1493, 1587, 1624, 1707, 1745, 1758, 1822, 1893, 1956`
All close buttons use `&times;` with no `aria-label="Close"`.

### 9.4 `outline: none` without visible focus replacement
**File:** `style.css:2570, 3851, 6490`
Focus outlines removed on textareas and inputs with only subtle border color changes as replacement.

### 9.5 Insufficient color contrast (WCAG AA failures)
- `.timesheet-hours-none { color: #ccc; }` on white -- ~1.6:1 ratio (style.css:903)
- `.kanban-column-empty { color: #adb5bd; }` on white -- ~2.3:1 ratio (style.css:4671)
- `.calendar-day-header { color: #aaa; }` on `#3a3a3a` -- ~2.8:1 ratio (style.css:7591)
- `textarea::placeholder { color: #666; }` on `#1e1e1e` -- ~3.0:1 ratio (style.css:2574)

### 9.6 No ARIA drag-and-drop attributes
**File:** `kanban.js` (entire file)
Cards lack `aria-grabbed`, `aria-dropeffect`, `aria-roledescription`. Columns lack `role="list"`. No keyboard-based card movement is possible.

### 9.7 Gantt table cells only editable via double-click
**File:** `script.js:5059-5170`
No `tabindex`, no `role="button"`, no keyboard handlers. Keyboard users cannot edit any Gantt table cell.

### 9.8 Piechart has no keyboard support
**File:** `script.js:5809-5890`
Only mouse/touch events. No `tabindex`, `role`, or `keydown` handler.

### 9.9 Toolbar buttons are emoji-only with no `aria-label`
**File:** `_editor_toolbar.html:2-31`
All buttons use emoji as sole content. `title` attribute is not reliably announced by screen readers.

### 9.10 Flow diagram has zero keyboard navigation
**File:** `planning-room.js:732-734`
Nodes only respond to mouse events. Edge deletion requires Ctrl+Click, which is undiscoverable.

### 9.11 `<a>` tags used as buttons without `href`
**File:** `index.html:534, 614, 667, 745, 1084, 1726`
Non-focusable by keyboard by default.

### 9.12 `contenteditable` div lacks `role="textbox"`
**File:** `index.html:1314`

### 9.13 Clickable table rows lack `role="button"` and keyboard handlers
**File:** `script.js:12347, 12608, 12803`

---

## 10. LOW: CSS Issues

### 10.1 Duplicate/conflicting CSS rule blocks
Six class selectors are defined in two places with conflicting values:
- `.templates-modal` (lines 6785 vs 7208) -- entirely different purposes (inner modal vs overlay)
- `.template-card` (lines 6940 vs 7323) -- different border-radius (8px vs 12px), different border width
- `.templates-grid` (lines 6926 vs 7317) -- different gap values
- `.templates-loading` (lines 6842 vs 7277) -- different layout approaches
- `.kanban-column-empty` (lines 4668 vs 5113)
- `.output-panel` (lines 257 vs 2811)

The entire block at lines 7204-7479 appears to be a second, competing template modal implementation.

### 10.2 Zero CSS custom properties
Not a single CSS variable is defined. Every color is hardcoded, appearing 200+ times. Theming/dark mode is impossible without changing both CSS and JS. Inconsistent color usage:
- 3 different greens (`#51cf66`, `#4caf50`, `#28a745`)
- 5 different reds (`#ff6b6b`, `#f44336`, `#dc3545`, `#c62828`, `#e53e3e`)
- Inconsistent hex casing (`#108BB9` vs `#108bb9`)

### 10.3 17 `!important` declarations
Including on `.resource-sheet-task-col`, `.timesheet-weekend`, `.timesheet-holiday`, `.editor-textarea`, `.modal-header input`.

### 10.4 RAID table text-overflow broken
**File:** `style.css:5629`
```css
.raid-table td { max-width: 250px; overflow: hidden; text-overflow: ellipsis; }
```
Missing `white-space: nowrap` -- text wraps instead of truncating with ellipsis.

### 10.5 `transition: all` used widely
Lines 92, 2073, 2308, 4509, etc. Transitions every property change, causing unintended visual artifacts.

### 10.6 Deprecated `-webkit-overflow-scrolling: touch`
Lines 2863, 3001, 3026, 3053, 3161, 5759. No longer needed in modern iOS Safari.

### 10.7 `kanban-panel` has conflicting `width: 100%` with `flex: 1`
**File:** `style.css:4381`

---

## 11. LOW: HTML Issues

### 11.1 Missing `</html>` closing tag
**File:** `index.html` -- file ends at `</body>` with no `</html>`.

### 11.2 No SRI hashes on CDN resources
**File:** `index.html:12-13, 2019`
Bootstrap CSS, Bootstrap Icons, and html2canvas are loaded from CDN without `integrity` or `crossorigin` attributes.

### 11.3 Duplicate welcome screen markup
**File:** `index.html:297-308` and `442-454` -- identical HTML in two views.

### 11.4 No `<h1>` on page; `<h1>` exists only inside a modal
**File:** `index.html:1955` -- heading hierarchy skips from none to `<h2>` on the page.

### 11.5 `required` attributes have no effect on auto-save forms
**File:** `index.html:1764, 1770`
Buttons use `type="button"` with `onclick`, bypassing native HTML validation entirely.

### 11.6 Bootstrap JS not loaded
**File:** `index.html`
Only Bootstrap CSS is included. Any Bootstrap JS components (tooltips, modals, dropdowns) will not function.

---

## Recommendations

### Immediate (Critical/High Priority)

1. **Fix broken functions:** Define `handleFlowUpload` or wire it correctly; change `renderPlan()` to `renderText()` in planning-room.js
2. **Fix `renameLabel` undefined variable:** Change `trimmedNewName` to `normalizedNewName`
3. **Fix broken regex:** Change `\\s` to `\s` and `\\d` to `\d` in Task class regex literals
4. **Sanitize all innerHTML:** Create a central `escapeHtml()` function and use it everywhere user data enters innerHTML. Better yet, switch to DOM API (`createElement`/`textContent`) for user-derived content
5. **Fix Gantt bar listener leak:** Move `document.addEventListener` into `mousedown` and add corresponding `removeEventListener` in `mouseup`
6. **Consolidate `escapeHtml()`:** Remove the duplicate definition and ensure the null check is preserved
7. **Fix SVG paint order:** Append `rect` before text elements in flow diagram nodes

### Short-term (Medium Priority)

8. **Add null checks:** Adopt a consistent guard pattern for all `getElementById` calls
9. **Add debounce/throttle:** Use `requestAnimationFrame` for drag handlers; debounce `saveTask()` from autocomplete inputs
10. **Fix date calculations:** Use working days (not calendar days) in `onDateChange`; use `formatLocalDate()` instead of `toISOString()` in the Task class
11. **Prevent double-fire:** Add re-entrancy guards to inline edit save functions
12. **Add mobile touch support:** Implement touch event handlers for kanban drag-and-drop
13. **Extract inline styles:** Move all inline `style=` attributes to CSS classes for responsive overrides
14. **Implement CSS custom properties:** Define a color/spacing/radius variable system

### Longer-term (Low Priority)

15. **Add `:focus` styles:** Every interactive element needs a visible focus indicator
16. **Add ARIA attributes:** `role`, `aria-label`, `aria-expanded`, `aria-live` throughout dynamic content
17. **Add `@media print` styles**
18. **Remove duplicate CSS blocks:** Consolidate the two template modal implementations
19. **Add SRI hashes** to CDN resources
20. **Add error boundaries:** Wrap async operations in try/catch with user-visible error feedback
