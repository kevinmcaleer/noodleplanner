# Standardisation backlog

The prioritised work list for epic [#1187](https://github.com/kevinmcaleer/noodleplanner/issues/1187),
derived from [`token-audit.md`](token-audit.md) (what exists) and
[`consolidation-and-handoff.md`](consolidation-and-handoff.md) (what can be
merged). Read those two first; this file only decides **order**.

Regenerate the evidence behind every number here with:

```sh
npm run audit:tokens   # docs/design/token-audit-data.json
npm run design         # docs/design/token-consolidation.json + ui-structure.json
```

## How this is ordered

Four bands, and the order between them is not a preference — each one makes
the next cheaper or safer:

1. **Foundations** — one answer to "which token wins", then tokens for the
   categories that have none. Nothing below can be done without this, because
   until it lands, "use the token" has two possible meanings.
2. **Mechanical merges** — collapse duplicate spellings onto one value each.
   No visual change, high volume. Done before any redesign so a palette
   decision is taken once rather than once per duplicate.
3. **Components** — the 848 class names, and the interactive states they are
   missing.
4. **Surfaces** — the per-view rollout, where the remaining judgement calls
   live.

Governance (the linter) is deliberately **not** last. It goes in as soon as
band 1 lands, so bands 2–4 do not have to be re-policed by hand.

Within a band, items are ordered by (declarations affected ÷ risk).

**Status: bands 1 and 3 are done, governance is done and gating CI, and band 2
is untouched. Band 4 has had its two provable pieces done and its judgement
calls left.** The ✅/☐ column on each table below says which.

---

## Band 1 — Foundations

Blocks everything. Target: `visual-system.css` is unambiguously the only
place a token is defined.

| | # | Item | Affects | Risk | Issue |
|---|---|---|---|---|---|
| ✅ | 1.1 | Delete the shadowed `:root` token block in `dark-mode.css`, keeping its ~575 component-level dark overrides | 79 conflicting names | Low — the deleted declarations already lose the cascade | [#1192](https://github.com/kevinmcaleer/noodleplanner/issues/1192) |
| ✅ | 1.2 | Resolve the 14 `var()` references with no definition | 14 names | Low, but each needs a judgement (typo vs. removed token vs. set from JS) | [#1192](https://github.com/kevinmcaleer/noodleplanner/issues/1192) |
| ✅ | 1.3 | Add a **spacing scale**. There is none today: 2,522 declarations, 1 indirected | 2,522 declarations | Low to add, high to adopt | [#1191](https://github.com/kevinmcaleer/noodleplanner/issues/1191) |
| ✅ | 1.4 | Add a **font-size scale**. 67 raw values, no token | 765 declarations | Low to add | [#1191](https://github.com/kevinmcaleer/noodleplanner/issues/1191) |
| ✅ | 1.5 | Extend the **radius** and **shadow** token sets to cover real usage | 498 + 198 declarations | Low | [#1191](https://github.com/kevinmcaleer/noodleplanner/issues/1191) |
| ✅ | 1.6 | Delete the 28 unused custom properties, after confirming none are read via `getComputedStyle` | 28 names | Low, given the JS check | [#1192](https://github.com/kevinmcaleer/noodleplanner/issues/1192) |

**1.3 and 1.5 carried a decision, not just an addition.** The canonical radii
(`9px`/`11px`/`14px`) did not match what the app actually uses (`4px` × 200,
`8px` × 125, `12px` × 63). #1191 resolved it in favour of the authored values:
the three semantic names are now aliases onto the real scale, which cost three
changes of 1–2px where the other direction would have changed ~500
declarations to fix nothing a user can see.

Spacing was left open the other way. The app's two interleaved half-scales
(4/8/12/16 and 5/10/15/25/30) mean `10px` and `6px` are deliberately *not* in
the token set, so adopting it is a per-surface judgement rather than a
substitution. See [`tokens.md`](tokens.md).

## Band 2 — Mechanical merges

No visual change by construction: every merge below is between values already
judged perceptually identical (ΔE2000 thresholds in
`token-consolidation.json` → `thresholds`).

| | # | Item | Removes | Declarations | Issue |
|---|---|---|---|---|---|
| ☐ | 2.1 | Merge the 18 shadow clusters | 39 of 104 shadows | 198 | [#1194](https://github.com/kevinmcaleer/noodleplanner/issues/1194) |
| ☐ | 2.2 | Merge the 4 radius clusters (`4px` absorbs `3px`/`5px`; `8px` absorbs `9px`; `12px` absorbs `11px`/`13px`) | 6 of 32 radii | 498 | [#1194](https://github.com/kevinmcaleer/noodleplanner/issues/1194) |
| ☐ | 2.3 | Merge the 14 font-size clusters (`0.85em` absorbs 5 spellings, 176 declarations) | 23 of 67 sizes | 765 | [#1194](https://github.com/kevinmcaleer/noodleplanner/issues/1194) |
| ☐ | 2.4 | Merge the 105 colour clusters onto one spelling each | 209 of 586 colours | 2,671 | [#1194](https://github.com/kevinmcaleer/noodleplanner/issues/1194) |

2.1 is first because it is the smallest and proves the workflow. 2.4 is last
because it is the largest and benefits most from the other three having
shaken out the review process.

## Band 3 — Components

| | # | Item | Affects | Issue |
|---|---|---|---|---|
| ✅ | 3.1 | **Focus states.** 693 button rules, 242 `:hover`, 45 `:focus`. Badges: 119 class names, 4 focus rules | Accessibility across the whole app | [#1193](https://github.com/kevinmcaleer/noodleplanner/issues/1193) |
| ☐ | 3.2 | Collapse the 137 button class names onto a base + variants | 693 rules, 22 files | [#1193](https://github.com/kevinmcaleer/noodleplanner/issues/1193) |
| ☐ | 3.3 | Same for badges (119), cards (94), inputs (68) | 891 rules | [#1193](https://github.com/kevinmcaleer/noodleplanner/issues/1193) |
| ✅ | 3.4 | Component showcase page covering every component × state × theme | — | [#1193](https://github.com/kevinmcaleer/noodleplanner/issues/1193) |
| ✅ | 3.5 | Storybook over the same component definitions | — | [#1197](https://github.com/kevinmcaleer/noodleplanner/issues/1197) |

**3.1 was the highest-priority item in the entire epic**, and it is done:
`visual-system.css` rings every natively focusable element and every
interactive ARIA role, as a `box-shadow` so a component's `outline: none`
cannot suppress it. `tests/ui/test_component_gallery.py` drives a real keyboard
and fails if any control looks the same focused and unfocused.

**3.2 and 3.3 are not refactors, and the original framing of them was wrong.**
The wording assumed the button classes are duplicates waiting to be merged.
They are not. Across the 116 button class names in the linked stylesheets,
exactly **one** group shares a byte-identical base rule — eight classes that
each declare nothing but `min-height: 44px; min-width: 44px`, the WCAG 2.5.5
touch target. 46 of the 116 have a single rule and no variants at all.

So collapsing them is not deduplication; it is deciding that the toolbar
button, the ribbon tab button, the kanban order button and the whiteboard
promote button should all *look the same*, and then changing how they look
across 21 stylesheets, the templates and the JS that sets their class names.
That is a design decision with a visible result, in the same category as the
palette question below — not something a refactor can settle.

What would make it tractable, in order: pick the two or three button roles the
system should actually have (primary, secondary, icon-only?), build them in the
gallery so they can be seen side by side against the 116 that exist, and then
migrate per view with `scripts/compare_screens.py` showing exactly what moved.

3.4 and 3.5 share one source of truth — `static/component-gallery.js`, rendered
by `/components` and by Storybook. Two hand-maintained galleries drift, and the
second one to drift is the one nobody notices.

## Band 4 — Surfaces

The per-view rollout, ordered by the surface map in `ui-structure.json`:
30 project views, 9 portfolio views, 18 modals, 5 slide-in panels, 16 detail
forms, 3 wizard steps, 2 standalone forms.

| | # | Item | Issue |
|---|---|---|---|
| ✅ | 4.1 | Adopt the spacing scale — 1,358 of 1,606 declarations now use a token, and 5 off-grid values remain | [#1194](https://github.com/kevinmcaleer/noodleplanner/issues/1194) |
| ☐ | 4.2 | Migrate the 33 colour-carrying inline `style=""` attributes in the templates | [#1194](https://github.com/kevinmcaleer/noodleplanner/issues/1194) |
| ☐ | 4.3 | Migrate static colour literals in JS-generated markup (214 lines, 22 files), leaving genuinely dynamic colour alone | [#1194](https://github.com/kevinmcaleer/noodleplanner/issues/1194) |
| ✅ | 4.4 | Penpot screen audit board | [#1196](https://github.com/kevinmcaleer/noodleplanner/issues/1196) |
| ✅ | 4.5 | Recover the 54 components stranded in the unlinked `style.css` | [#1194](https://github.com/kevinmcaleer/noodleplanner/issues/1194) |
| ✅ | 4.6 | Substitute the 21 hex literals that exactly equal a theme-invariant identity token | [#1194](https://github.com/kevinmcaleer/noodleplanner/issues/1194) |

4.5 was not on the original list and turned out to be the largest visible
defect in the epic: the #571 CSS split left 54 classes behind in a stylesheet
nothing links, so the progress toast, baseline dialog, AI settings modal and
the editor's front-matter highlighting had been rendering unstyled in
production ever since.

4.1 was done in two passes, and the second one is the interesting one.

**Pass one tokenised what could not move.** 783 declarations whose every value
was already on the scale — `padding: 8px` became `padding: var(--np-space-8)`,
the same number, named. All-or-nothing per declaration, because tokenising only
the on-scale half of `padding: 14px 16px` leaves
`padding: 14px var(--np-space-16)`, which reads as a half-finished edit and
hides that the `14px` is the part still needing a decision.

**Pass two moved things**, which is what this item was always really about.
751 off-grid values snapped to the nearest multiple of 4, ties rounding up.
`10px → 12px` (266), `6px → 8px` (191), `15px → 16px` (92), `14px → 16px` (55),
`5px → 4px` (54), and eight smaller groups.

Two decisions in that, both of which changed the outcome:

- **The rule is the 4px grid, not the eleven named steps.** Values on the grid
  but outside `--np-space-*` are frequently load-bearing rather than sloppy:
  `padding-bottom: 36px` matches the fixed status bar's height, and
  `padding-right: 44px` is clearance for the icon inside a search input.
  Snapping either to the nearest named step misaligns it against the thing it
  was measured against. A first attempt did exactly that to 20 declarations
  before the values were looked at.
- **Ties round up.** 6 sits between 4 and 8, 10 between 8 and 12, 14 between 12
  and 16, so the direction is a real decision. Up, because rounding down
  compounds — a control with `padding: 6px` in a row with `gap: 6px` in a panel
  with `padding: 10px` loses 6px of breathing room at once, and cramped is
  harder to spot in a screenshot than roomy.

Every view moved, which was expected and is the point. The check was not "did
anything change" but "did anything break": all 39 views were inspected in both
themes, with the dense table views (`raid`, `stakeholders`, `user-workload`),
the most layout-sensitive one (`gantt`) and the positional one (`kanban`) read
side by side against their before shots. Nothing clipped, overflowed or
rewrapped. The one wrap that does exist — "Critical Path" over two lines in the
Gantt toolbar — was checked against the before shot and predates this.

| | Before 4.1 | After |
|---|---|---|
| Spacing declarations using a token | 1 of 1,606 | **1,358 of 1,606** |
| Uses off the 4px grid | 894 | **28** |
| `off-scale-spacing` lint findings | 803 | **5** |

The 5 that remain are the ones that should: `padding: 330px 20px 200px` on the
welcome screen and `padding: 250px 0 150px` on the timeline wrapper are
vertical-centring constants, and `margin-left: -6px` / `-5px` are the negative
overlap that stacks resource avatars.

## Governance — runs alongside, from the end of band 1

| | # | Item | Issue |
|---|---|---|---|
| ✅ | G.1 | Linter for hardcoded colours, off-scale spacing, unpaired `outline: none` and tokens outside the canonical layer | [#1195](https://github.com/kevinmcaleer/noodleplanner/issues/1195) |
| ✅ | G.2 | Allowlist for legitimate raw colour (canvas/chart APIs, runtime contrast calculation) | [#1195](https://github.com/kevinmcaleer/noodleplanner/issues/1195) |
| ✅ | G.3 | Wire into CI; flip to failing once band 2 lands | [#1195](https://github.com/kevinmcaleer/noodleplanner/issues/1195) |
| ✅ | G.4 | Contribution guidance: when to add a token vs. a component | [#1195](https://github.com/kevinmcaleer/noodleplanner/issues/1195) |

A linter that fails on day one against ~1,950 pre-existing violations gets
switched off. It went in as a **ratchet** instead of warn-only: a committed
baseline of every known finding, failing only when a count rises or a new
finding appears. That can gate from the start, which warn-only cannot, so it is
in `CI_BLOCKING_JOBS` rather than reporting-only. `npm run check:contrast`
shares the job and has no baseline — there is no legitimate version of body
text at 4:1.

## Explicitly out of scope

- **`packages/obsidian-noodle-planner/styles/styles.css`** — a separate
  surface with its own host theme. It should get the same treatment
  eventually, but its tokens are Obsidian's, not NoodlePlanner's.
- **Vendored libraries** under `static/vendor/` — not ours to restyle.
- **Adopting the warm palette wholesale**, which is now the only substantial
  item left and the reason `raw-colour` still stands at 1,090.

  It is a design decision — the app's top-of-distribution greys are cool
  Bootstrap-era values that predate the warm system entirely, so converting
  them changes how the product looks and wants a person in Penpot. But there is
  also a hard correctness reason it cannot be done mechanically, and that is
  the more important one to know before anyone tries.

  **The surface and text tokens invert between themes.** `--np-paper` is
  `#FAF8F4` in light and `#201E1A` in dark; `--np-ink` is `#23201C` and
  `#FAF8F4`. So a literal can only be replaced by a token when the element it
  sits on *also* flips. `color: #fff` on a coloured button must stay light in
  both themes — mapping it to `--np-paper` produces dark text on a dark button
  in dark mode. The same literal, `#fff`, maps to a token in one rule and must
  stay a literal in the next, and telling the two apart means knowing what the
  element sits on.

  So the work is: classify each of the 1,090 as *follows the theme* or *fixed
  against a coloured background*, then substitute only the first group. The
  classification is the judgement; the substitution after it is mechanical, and
  `scripts/compare_screens.py` will prove each batch.

  **A measurable part of it turned out not to need the decision.** Of the 878
  hex literals the linter reports, 576 carry a hue — status greens and reds,
  RAG tints, the editor's syntax theme — where the colour *is* the meaning.
  Only 302 are neutral, and most of the "cool Bootstrap greyscale" the audit
  found had been living in the dead `var()` fallbacks removed earlier.

  71 of those neutrals were mapped, under two rules that make each one safe by
  construction: the literal's lightness must match the token's in the light
  theme (so a dark literal in `color` becomes `--np-ink`, while a *light* one
  stays a literal because it is text on something coloured that does not flip),
  and the token must already look like the literal — within 1.1:1, below the
  threshold of noticing. Both themes came back pixel-identical, and
  `check_rendered_contrast.py` reports no new failures.

  The rest needs the decision. `raw-colour` stands at 1,053.

  **The dark theme is a second copy of this problem.** `dark-mode.css` carries
  480 per-component `[data-theme="dark"]` declarations: the app themes itself
  per component rather than per token. 24 of them said exactly what the base
  rule already said and were removed as no-ops. The remaining ~456 are a
  separate palette maintained by hand, and collapsing them onto the tokens is
  the same decision as above, seen from the other side.

## Two nav bugs found in passing

Neither is a design-system issue, both are real, and both were found by the
surface map:

- `lessons` is reachable from the nav but no group in `ALL_PROJECT_VIEWS`
  owns it, so `updatePlanSubnav` never marks the sub-nav active while it is
  open.
- `escalations` is listed in `TRACKING_VIEWS` but no `data-view` in the
  markup offers it.

## Verifying a migration

Bands 2 and 4 replace values across 30 views. Reading a diff of `#e0e0e0`
becoming `var(--np-border)` tells you nothing about whether it rendered the
same, so capture before and after and compare:

```sh
uv run python scripts/capture_screen_audit.py --out .screens/before
# ... edit CSS ...
uv run python scripts/capture_screen_audit.py --out .screens/after
uv run python scripts/compare_screens.py .screens/before .screens/after
```

All 39 views, exits non-zero if any changed by more than 0.05% of its pixels,
and writes a diff image per changed view with the moved pixels in magenta.
`--theme dark` and `--width 480` cover the other two axes. Two identical runs
produce a zero diff, so a reported change is a real one.

A change is not automatically wrong — it is the thing to look at. When this
epic's own branch was compared against `main`, exactly one view moved: kanban,
by 0.47%, all of it `#d4d4d4` becoming `#569cd6`/`#ce9178` in the editor pane.
That is the YAML front-matter highlighting that #1194 recovered from the dead
stylesheet, showing up as intended.

**Run captures somewhere that can reach the CDN.** Where `cdn.jsdelivr.net` is
blocked the app renders without Bootstrap or any icon — harmless for an A/B
comparison, misleading as a board.

## Also found

**667 dead `var()` fallbacks — now removed.** Of 685 `var()` references
carrying a literal fallback, 667 named a token declared at `:root`, so the
fallback could never fire. Most encoded the superseded #1024 blue identity
(`var(--np-accent, #108BB9)`), which made them worse than merely dead: if a
token had ever gone missing, the app would have silently reverted to the old
palette rather than failing visibly.

`scripts/strip-dead-fallbacks.mjs` removes them. The safety rule is `:root`
specifically, not "declared anywhere" — `:root` applies in both themes, so a
`[data-theme="dark"]` override changes the value but never leaves it
undefined, whereas a token declared *only* under `[data-theme="dark"]` needs
its fallback because that is what paints in the light theme.

Verified pixel-identical across all 39 views in both themes. Unique colours in
use fell 549 → 519: 30 colours existed *only* inside dead fallbacks.

The 18 kept are load-bearing: the `--mm-*` mind-map tokens are declared at
component scope rather than `:root`, plus `--bs-primary` from Bootstrap's CDN
stylesheet and `--wb-outline-depth` set inline by JS.

**One docs screenshot.** `docs/_static/img/how-to/kb-01-kanban-phase.png`
shows the editor pane with YAML front matter in flat grey, from before the
highlighting fix. It is the only affected image — `cp-01-editor-frontmatter.png`
shows the structured front-matter *panel*, not raw YAML, so the fix does not
touch it.

Re-capturing needs `cd docs && make screenshots` somewhere with real network
access. It could not be done in the sandbox this work was carried out in:
`cdn.jsdelivr.net` is blocked by policy, and while Google Fonts is reachable by
`curl` it is not reachable from the browser, so a capture renders without
Bootstrap, without icons and in fallback fonts. Stubbing all of that from local
copies is possible but would risk a screenshot that differs from the rest of
the set for reasons unrelated to the change, which is worse than one slightly
stale image.

Note also that `docs/capture_screenshots.py` is still Selenium, so it needs a
chromedriver matching the installed Chrome — the version-skew problem that
moved `tests/ui` to Playwright, and which bit this work too.

## Convergence metric

The single number to watch. Re-run `npm run audit:tokens` after each band.

Two numbers are worth watching, and they measure different things.

**Unique values in use** — re-run `npm run audit:tokens`. The original figures
counted the dead `style.css`; these are the linked stylesheets only:

| Category | Now | After band 2 (predicted) | Token count |
|---|---|---|---|
| Colours | 519 | ~340 | ~40 |
| Font sizes | 68 | 44 | 11 |
| Radii | 36 | 30 | 7 |
| Shadows | 98 | 60 | 5 |
| Spacing values | 36 | — done | 12 |

**Lint findings** — `npm run lint:design`, against
`ci/design-system-baseline.json`. This is the one CI enforces, and it only ever
goes down:

| Rule | Now |
|---|---|
| `raw-colour` | 1,090 |
| `off-scale-spacing` | 5 |
| `token-outside-canonical` | 0 |
| `unpaired-outline-none` | 0 |

The `off-scale-spacing` rule now tests the **4px grid** rather than membership
of the eleven named steps, for the reason given under band 4: a rule that flags
`padding-bottom: 36px` where 36px is the status bar's height can never reach
zero, and a rule that can never be satisfied gets ignored.

`token-outside-canonical` reached 0 when the identity palette, the motion
tokens and the status ramp moved from `base.css` and `dark-mode.css` into
`visual-system.css`. Every `--np-*` token is now declared in exactly one file,
which is the property the whole epic exists to establish. Moving them changed
nothing about where they resolve — a custom property resolves from the cascaded
value on the element, not from where in the file it was declared — and that was
confirmed pixel-identical across all 39 views in both themes.

`raw-colour` is now the only rule with real numbers behind it, and it is the
palette decision described below — the one thing in this epic that a person has
to make rather than verify.

Band 2 alone does not get these near the token counts, and it is not supposed
to — it removes the duplicates so that band 4's judgement calls are made
against a clean list.
