# The NoodlePlanner design system

This is the charter: why the design system exists, the principles that decide
open questions, and the working rules for anyone — human or Claude Code —
touching UI code. The other files in this directory are the evidence and the
mechanics:

| | |
|---|---|
| What exists today, measured | [`token-audit.md`](token-audit.md) |
| Token reference (values) | [`tokens.md`](tokens.md) |
| Every screen, every component on it, and the build-order tally | [`noodleplanner-ui-inventory.md`](noodleplanner-ui-inventory.md) |
| What can merge, and the Penpot/Storybook handoff | [`consolidation-and-handoff.md`](consolidation-and-handoff.md) |
| The prioritised work list | [`standardisation-backlog.md`](standardisation-backlog.md) |
| CI gates and when to add a token vs. a component | [`contributing.md`](contributing.md) |

Read this one first. It tells you *why* the others say what they say, and
which parts of the original plan are done versus still open.

## 1. The problem

NoodlePlanner was built without a design framework. CSS, components and
visual values are bespoke per screen and drifted: multiple near-identical
buttons, ad-hoc padding values, fonts applied directly rather than through any
system. `token-audit.md` put numbers on it — 549 colours against a canonical
palette of ~40, 825 distinct component class names, 137 button classes alone.

The goal is a standardised design system: a fixed set of tokens, a canonical
component for each UI element, and Storybook as the source of truth for what
"canonical" means.

## 2. Principles

These are the decisions that settle arguments before they start. When a new
question looks like one of these, this is the answer, not a fresh debate.

**Tokens first, then components.** A button is not a primitive — it is an
assembly of tokens (colour, type, spacing). Canonicalising components before
tokens means re-deciding "what green, what padding" for every component,
which is how the sprawl happened in the first place. Tokens are settled
first; components reference them. **Status: done** — colour, spacing,
type, radius and elevation scales are locked in `visual-system.css`
(bands 1 and 3 of the backlog).

**This is a re-skin, not a migration.** Do not map old values to new ones, or
find-and-replace near-match colours. Each component is rebuilt once against
the fixed tokens; old arbitrary values are abandoned as components are
rebuilt, not converted. "Convert everything" is unbounded; "rebuild each
component once" is finite. This is why the backlog's band 2 (mechanical
merges) and the palette question in band 4 are kept separate from band 3
(component rebuilds): merging duplicate spellings is safe automation, and
choosing the surviving palette is the one decision a person has to make
(see "Explicitly out of scope" in `standardisation-backlog.md`).

**Storybook is the source of truth.** If a component or variant is not in
Storybook, it is not official. Authority is decided, not discovered — where
several variants of a component exist, pick the one closest to the target
direction and declare it canonical. **Status: set up** in #1197; see §7.

**Penpot is downstream, not the driver.** The bottleneck is standardising
components that already exist in code, which is Storybook's job — Penpot is
design-stage tooling for mocking up look and layout *before* code exists.
New component and screen standardisation work should route through tokens
and Storybook, not Penpot.

*Reconciling this with what's already built:* `consolidation-and-handoff.md`
documents a working Penpot pipeline — token export
(`docs/design/tokens/*.json`) and a screen-audit board
(`npm run design:screens`) — built to support the one outstanding palette
decision (whether the surviving greys adopt the warm palette). That work
stands and stays useful for that specific decision. Going forward, treat
Penpot as parked for anything else: reach for it again only when designing a
genuinely new component or screen, not for standardising ones that already
exist in the app.

## 3. Vocabulary

Standard industry terms, used consistently across these docs:

- **Design system** — the whole thing: tokens, components, and rules for use.
- **Component library / pattern library** — the visual reference of
  components and their variants. Storybook is the tool for this.
- **UI inventory / interface inventory** — the every-screen, every-component
  map described in §5.
- **Atomic Design** (Brad Frost) — build from smallest up: atoms (tokens,
  button, label) → molecules (search box) → organisms (panel with header) →
  pages. This is the tokens-then-components logic in §2, with a vocabulary.

## 4. Tokens

Three groups, all settled before component work begins: colour, typography,
spacing. Full values and rationale are in [`tokens.md`](tokens.md); the
short version:

- **Spacing** is a numeric scale on a 4px base (`--np-space-4` through
  `--np-space-64`), not Bootstrap-style `sm`/`md`/`lg` — t-shirt sizes get
  ambiguous (is "large" the third step or the fourth?) and 4px gives enough
  rungs for both tight button padding and roomy panel margins without
  inventing off-scale values. A scale makes most numbers illegal, which is
  what makes drift impossible by construction, rather than merely discouraged.
- **Typography** is a defined type pairing (Newsreader for headings,
  Instrument Sans for UI, IBM Plex Mono for data), applied through
  `--np-font-*`/`--np-text-*`/`--np-weight-*` tokens, not set ad hoc per
  component.
- **Colour** is a defined warm palette (`--np-paper`, `--np-ink`,
  `--np-accent`, the status pairs), referenced by token only.

**Rule: never hardcode a colour, font or spacing value. Always reference a
token. If no token fits, stop and flag it rather than inventing one.** This
is enforced mechanically by `npm run lint:design` and `npm run
check:contrast` — see `contributing.md`.

## 5. UI inventory

A single map of the whole app: every screen, every state, then every
component tagged onto them with a frequency count. It is the highest-value
artefact for sequencing component work, because *the frequency count is the
Storybook build order* — fix the most-used component first and it pays off
across the most screens.

**Pass 1 — screen map.** Workspace by workspace, name every screen and every
state: Markdown view, Mind Map, Board, product views, plus every slide-out
panel and every dialog that can appear over them. Names only, no description.
When the list stops growing, the problem is bounded.

**Pass 2 — component tagging.** Go back through and tag the components on
each screen (task details panel → panel, header, input, button; board → card,
column, button). Maintain a deduplicated component list with a tally of how
many screens each appears on.

Do the naming pass in one sitting, even roughly, before tagging anything.
Getting the full list visible is what settles the scope; detail comes after.

**Status: done.** `npm run design:map` generates
`docs/design/ui-structure.json` — pass 1's screen and surface names. Pass 2
is [`noodleplanner-ui-inventory.md`](noodleplanner-ui-inventory.md): every
`*-view`/`*-tab`/`*View` container in `templates/index.html` walked as a DOM
tree, every render module in `static/` scanned for the class names it emits
for the ten views built entirely in JS, and every component on every screen
listed by name and tallied. Pass 1 also caught two real nav bugs (`lessons`
and `escalations` — see the backlog).

93 screens and surfaces, 139 distinct components, 952 total sightings. The
build order this gives — read the full tally in the inventory — tops out at
**Panel header (39 screens)**, **Empty state (37)**, **Close button (36)**,
then the button family (`Button (secondary)` and `Icon button` at 33,
`Button (primary)` at 32) and **Data table (32)**. §6 below is revised to
match: the highest-leverage unbuilt components are panel header, empty
state and close button, not button — button's three main variants already
have Storybook stories, just not wired into any screen.

## 6. First components

[`noodleplanner-ui-inventory.md`](noodleplanner-ui-inventory.md)'s tally
(§5) now backs this order with a measured build order rather than the
surface map alone, and it reorders what was here before: **panel header,
empty state and close button rank above button**, because button's main
variants are already partway built.

### Panel header

**Measured: 39 of 93 screens — the single most-repeated component in the
app**, ahead of every other row in the inventory's tally. Every slide-out
panel, every dialog and several chrome surfaces (session chat, AI chat, task
peek) use one.

- **Header** is its own sub-component: title, optional subtitle, close
  button, gradient.
- **Body** is a slot — it holds whatever form goes inside.
- Story shows: empty shell, shell with a representative form, and
  slide-from-side if it varies.

Discipline: panel shell and contents stay separate, so every slide-out shares
one shell and only the inner form changes.

**One decision blocks the story, and the inventory names it exactly:** only
three of the sixteen `#detailPane` sections (Task details, Product details,
Task Inspector) use the drawer's own `.detail-pane-header`; the other
thirteen borrow `.modal-header` from the dialog shell. Drawer and dialog
share a header today by accident, not by design — pick one before building
the Storybook story, per the inventory's §5 "Panel headers are
inconsistent."

**Status: not started.** No extracted panel/header component yet. This is
now the single highest-leverage unbuilt component in the app.

### Empty state

**Measured: 37 screens**, second-highest in the tally — and the inventory's
own open questions explain why it's messier than the count alone suggests:
there are **four different kinds of "nothing here"** (welcome screen,
pre-render placeholder, empty state, loading), which look different and mean
different things, so they likely stay separate components sharing one
shell rather than collapsing into one. Within the empty-state family alone,
19 per-area classes (`.raid-empty-state`, `.budget-empty-state`, …) do the
same job — the inventory calls this "the strongest single consolidation
target in the app."

**Status: not started.**

### Close button

**Measured: 36 screens.** The inventory tracks it as its own component,
separate from the button-hierarchy variants below — it is a dismiss action
inside a panel or modal header, not a point on a primary/secondary/tertiary
scale. Building it alongside the panel header (it's part of that header in
almost every occurrence) is likely more efficient than as a fully separate
story.

**Status: not started.**

### Button

**Measured: `Button (secondary)` and `Icon button` at 33 screens each,
`Button (primary)` at 32** — high-frequency, but **already substantially
underway**: `Button (secondary)`, `Button (primary)`, `Button (danger)` and
`Button (outline)` all have Storybook stories against `<np-button>`
(`static/components/button/`), ticked in the inventory's tally. The `neutral`
tone and `outline` modifier were added in #1212 as a worked example of
picking hierarchy roles.

Variants fall along axes; the Storybook story should show every meaningful
combination in a grid, so drift jumps out visually.

- **Hierarchy** — primary (bold CTA), secondary (supporting),
  tertiary/ghost (quiet). Three only. Do not invent more.
- **State** — default, hover, active/pressed, disabled, loading (where the
  button does work).
- **Size** — only if more than one genuinely exists.
- **Content** — label only, icon + label, icon only.

**Status: in progress, not wired into the live app.** The stories exist; no
screen imports `<np-button>` yet — see the button-role discussion under
band 3 of `standardisation-backlog.md` for why that migration is a design
decision, not a mechanical refactor. `Icon button` (33 screens) has no
dedicated variant yet and is the gap to close next within this component.

### Composed forms

Storybook renders components at every level of the hierarchy, not just small
ones. The full task details form gets its own story, composed from the
already-verified button, field, slider and panel-header stories. Two-level
payoff: verify each small piece once in its own story, then in the composed
story only check the **composition** (spacing, layout, order) — not whether
the slider itself works. A forty-part form becomes "eight already-signed-off
pieces, arranged." Composed stories need mock data to render — hand the
story a sample task to populate fields.

## 7. How Storybook relates to the code

**The components in Storybook are the real application components — the
same code.** A story is a small file that renders the real component in
isolation with given props. There is no copying, porting or translation
step. So the workflow is *not* design-in-Storybook-then-port; it is: build
or fix the real component, and Storybook is the window for verifying it in
isolation. Every screen that imports that component gets the change
automatically.

**Current state is messier:** screens do not yet import one shared
component — they each have bespoke copies. The migration is exactly that
rewiring:

1. Build the one canonical component, verified in Storybook.
2. Go screen by screen, replacing bespoke copies with imports of the shared
   component.

**Status: the tooling for step 1 exists and is used; step 2 has not started
for any component.** Two groups are previewed today (`.storybook/main.mjs`):
the app's existing class names, generated from `static/component-gallery.js`
(the same spec `/components` renders from — one spec, two consumers); and
the extracted Web Components (`<np-button>`, `<np-card>`, `<np-board>`,
`<np-note>`) under `static/components/`, none of which are wired into the
live app yet. `tests/test_storybook_stories.py` keeps the gallery and
Storybook from drifting apart. Run it locally with:

```sh
npm run storybook          # dev server on :6006
npm run build-storybook    # static build
```

## 8. Safety net — avoiding visual blowups

The risk: swapping a component on a screen changes spacing or appearance
unpredictably, requiring every screen to be eyeballed after every change.

**Storybook catches this before the change reaches a screen.** Verify "does
the button component look right" once, for all its states — not "does the
button look right on the board, and in the panel, and in the dialog."

**Rule: before replacing a component on a screen, confirm the canonical
component's story already contains a variant matching what's there. If the
screen uses a compact button and no compact variant exists, close that gap
in Storybook first — do not discover it on the screen afterwards.**

**Visual regression testing is the app-level net**, and it already exists:

```sh
uv run python scripts/capture_screen_audit.py --out .screens/before
# ... edit CSS ...
uv run python scripts/capture_screen_audit.py --out .screens/after
uv run python scripts/compare_screens.py .screens/before .screens/after
```

All 39 views, both themes, exits non-zero if any changed by more than 0.05%
of its pixels, writes a diff image with the moved pixels in magenta. This is
already how band 4 migrations are verified (see "Verifying a migration" in
`standardisation-backlog.md`) — eyeball once per component up front, then
only the diffs. When any component gets rewired into a live screen (§7 step
2), run this before and after.

## 9. Working rules

1. Never hardcode colour, font or spacing values — reference tokens only.
   Enforced by `npm run lint:design` (ratchet against
   `ci/design-system-baseline.json`) and `npm run check:contrast` (no
   baseline — see `contributing.md`).
2. Do not invent components, variants or functions that don't exist. Prior
   ribbon work produced hallucinated buttons mapping to no real function;
   anything that doesn't map to a real function gets stripped.
3. Build/verify the canonical component in Storybook before rewiring any
   screen to it.
4. Check variant coverage against the screen's existing usage before
   swapping (§8).
5. Keep panel shell separate from panel contents.
6. One component definition, many usages — never duplicate a component to
   tweak it for one screen. Add a variant instead.
7. When something doesn't fit the system, stop and flag it rather than
   working around it.
8. Update `docs/_static/img/` screenshots (`cd docs && make screenshots`)
   after any UI layout, navigation, view or front-matter change — per the
   root `CLAUDE.md`.
9. Run the visual-regression capture (§8) before pushing a change that
   rewires a screen onto a shared component, not just the unit/lint suite.

## 10. Order of work

1. **Lock tokens** (colour, typography, 4px spacing scale). ✅ Done — bands 1
   and 3 of the backlog; see `tokens.md`.
2. **Build the UI inventory** (two passes → component list with frequency
   tally). ✅ Done — `ui-structure.json` (pass 1) and
   [`noodleplanner-ui-inventory.md`](noodleplanner-ui-inventory.md) (pass 2,
   §5): 93 screens, 139 components, 952 sightings, sorted into a build
   order.
3. **Build the highest-frequency components** in Storybook against tokens.
   ⏳ Button is in progress (see §6) — its main variants have stories but
   aren't wired into any screen. **Panel header (39 screens), empty state
   (37) and close button (36) rank above it and are not started** — build
   those next, in that order.
4. **Build panel + header** specifically. ☐ Not started — blocked on one
   decision the inventory names: reconcile `.detail-pane-header` and
   `.modal-header` into one header before building the story (§6).
5. **Compose the task details form story** from verified pieces. ☐ Not
   started — blocked on 4.
6. **Rewire screens to shared components**, in inventory frequency order.
   ☐ Not started for any component. `Task details`, `Product details` and
   `Task Inspector` (the three screens already using the drawer's own
   header) are the natural first rewiring targets for panel header once it
   exists, since they need the least reconciliation.
7. **Add visual regression snapshots** once components are stable. ✅ The
   tooling exists and is already used for band-4 migrations
   (`scripts/compare_screens.py`); formalise it as a required step once
   step 6 begins moving live screens.

The honest read of where this stands: the *foundational* work this plan
called for — tokens locked, focus states fixed, duplicate components
identified and merged where they were genuinely duplicates, Storybook wired
up, a screen-diffing safety net built, and now a complete, measured UI
inventory — is done. What has **not** started is the part all of that was
in service of: building panel header, empty state and close button (the
three highest-leverage components, all unbuilt), finishing button's
rewiring, and the screen-by-screen migration in step 6. Those are the next
pieces of work, in that order.
