# UI inventory, pass 2: component tagging

[`design-system.md`](design-system.md) §5 called this the next highest-value
artefact after the screen map: tag which component families appear on each
of the app's screens, then tally how many screens each family reaches. The
frequency count is the Storybook build order — fix the most-used component
first and it pays off across the most screens.

Re-run it after any view or markup change:

```sh
npm run design:map    # pass 1 -- must run first, this reads its output
npm run design:tag    # pass 2 -- writes docs/design/component-tagging.json
```

The script is `scripts/component-tagging.mjs`; this report is written from
`docs/design/component-tagging.json`.

## Method

Mechanical, not hand-curated, for the same reason pass 1 was: a list a
person assembles by eye goes stale the day after the next view is added.

- **Screens** are pass 1's own list — the 30 project views, 9 portfolio
  views, and every surface (slide-ins, detail forms, overlays, wizard steps,
  standalone forms, panels) from `docs/design/ui-structure.json`. 85 in
  total.
- **Each screen's container** is resolved the way the app's own router
  resolves it, not guessed: project views try `#<name>-view` then
  `#<name>-tab` (`NavigationController`'s registry in `script.js`), portfolio
  views try `#portfolio<Name>View` (the `switch` in `portfolio.js`), and
  surfaces reuse the id pass 1 already found. All 85 resolved to a real
  element — none needed the fallback.
- **A screen's markup** is extracted with a depth-balanced tag scan (the
  same tag nested inside itself is tracked correctly), not a fixed character
  window.
- **JS-rendered screens** — the 9 portfolio views are empty `<div>` shells
  in `index.html`, filled entirely by their own `portfolio-*.js` file — get
  a second pass: every `static/*.js` file that mentions the container id
  contributes a windowed excerpt around each mention (800 characters before,
  2,500 after), not the whole file. Without windowing, a container id that
  happens to appear in `script.js` (17,926 lines, touches nearly every view)
  would make every screen "contain" almost everything; windowing keeps the
  tally about that screen's own rendering code.
- **Component families** are the same seven `scripts/token-audit.mjs`
  already established — button, badge, input, card, modal, table, nav —
  matched the same way: hyphen/underscore-separated class-name segments
  against each family's word set, not a substring. A screen count here means
  the same thing as a rule count there, so the two reports are comparable.

## What it found

| Family | Screens | % of 85 | Distinct class names | Top class name |
|---|---|---|---|---|
| button | 57 | 67.1% | 48 | `close-btn` (31 screens) |
| table | 43 | 50.6% | 75 | `form-grid-2col` (11) |
| nav | 38 | 44.7% | 46 | `output-tab-content` (24) |
| input | 38 | 44.7% | 24 | `form-group` (18) |
| modal | 36 | 42.4% | 21 | `modal-body` (30) |
| badge | 26 | 30.6% | 26 | `summary-label` (4) |
| card | 14 | 16.5% | 13 | `wizard-panel` (4) |

### Button is confirmed as the right first component, but not for the reason assumed

67% of screens carry a button class, which backs design-system.md §6's
button as the highest-frequency target — that part of the plan needed no
correction. What the class-name breakdown adds is *which* button matters
most: **`close-btn` alone reaches 31 screens, more than any of
`btn-primary` (22), `btn-secondary` (23) or `btn-danger` (12) individually.**
The single most-repeated button in the app is not a CTA — it's the button
that dismisses a modal or panel.

### The panel/header pattern is already the second-highest-value target — and it's real, not proposed

Design-system.md §6 named "panel + header" as the next component to build
after button, on the strength of the surface map alone (5 slide-in panels,
18 overlays). Pass 2 shows that guess understated it: **`modal-header` (27
screens) and `modal-body` (30 screens) are already the second- and
third-most-repeated class names in the entire app**, ahead of every button
variant except `close-btn`. `task-form-modal` alone — one specific dialog —
appears on 13 screens.

That is a striking gap against the **`card`** family, which is where a
literal "panel" class name would have landed (`card`/`tile`/`panel` are one
family in this taxonomy): only 14 screens (16.5%), topped by `wizard-panel`
at 4. Read together, this says the app already has a strong *de facto*
convention — `modal-header`/`modal-body`/`close-btn` — repeated by hand
dozens of times, rather than a `panel` class that never caught on. That
convention, not a fresh design, is what design-system.md §6's Panel/Header
component should canonicalise: the shape to extract already exists in the
markup 27–31 times over.

### Table and badge confirm what the token audit already found

Table has the most distinct class names of any family (75) against 43
screens — consistent with `token-audit.md`'s 212 distinct table class names
project-wide; this pass shows they're spread thin rather than concentrated
on a few dense views. Badge is the extreme case of the same shape: 26
distinct class names across 26 screens but a top count of only 4 — almost
no class name is reused more than once or twice, matching the audit's
"badges are worse in relative terms" finding on focus-state coverage. Both
are evidence *against* rushing table/badge componentisation before button
and panel: there is no single dominant shape to extract yet, unlike
`close-btn` or `modal-header`.

### Nav is mostly structural, not a nav component

`nav`'s top entries — `output-tab-content` (24 screens) and `ribbon-banner`
(21, plus its `--blue`/`--dark`/`--orange` variants) — are layout and theming
classes rather than an interactive nav element. Read this family's count as
"how many screens sit inside the shared shell", not as evidence for a nav
component to build next.

## Revised build order

Combined with `design-system.md` §6, the frequency data changes nothing
about which component is first, but sharpens what "first" and "second" mean:

1. **Button**, and specifically make `close-btn`'s hierarchy (it is a
   dismiss action, not a primary/secondary/tertiary CTA) an explicit
   variant of `<np-button>` rather than assuming the three-hierarchy axis
   in §6 already covers it.
2. **Panel + header**, built directly from the `modal-header`/`modal-body`/
   `modal-overlay`/`close-btn` shape already repeated 27–31 times, rather
   than designed fresh. `task-form-modal` (13 screens) is the largest single
   consumer and the natural first target to rewire once the component
   exists.
3. Table and badge stay lower priority than §6 implied by surface count
   alone: both are real problems (per `token-audit.md`), but neither has the
   single dominant, extractable shape that button and panel already do.

## Caveats

- **Presence, not usage weight.** A screen counts once per family regardless
  of how many buttons or table rows it has. This answers "how many screens
  does fixing this component touch", which is what the build order needs;
  it does not answer "how prominent is it on that screen".
- **Windowed JS excerpts can miss a class name** if it's assembled far from
  every mention of the container id (rare, but possible in a 17,926-line
  file). This would under-count, never over-count, so the ranking above is
  conservative rather than inflated.
- **The `card` family's low count is partly a naming artefact.** Elements
  that read as panels in the UI but are named `-pane` rather than `-panel`
  (`detail-pane`, `editor-pane`) don't match this taxonomy's word list. The
  `modal`-family numbers are the more reliable signal for panel/header
  specifically, since `modal-header`/`modal-body` is how the app actually
  names the pattern.
