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

3.2 and 3.3 are the part that is left, and they are larger than they look:
collapsing 136 button class names reaches templates and JS, not just CSS. Doing
it per view alongside band 4 is more tractable than as one sweep.

3.4 and 3.5 share one source of truth — `static/component-gallery.js`, rendered
by `/components` and by Storybook. Two hand-maintained galleries drift, and the
second one to drift is the one nobody notices.

## Band 4 — Surfaces

The per-view rollout, ordered by the surface map in `ui-structure.json`:
30 project views, 9 portfolio views, 18 modals, 5 slide-in panels, 16 detail
forms, 3 wizard steps, 2 standalone forms.

| | # | Item | Issue |
|---|---|---|---|
| ☐ | 4.1 | Adopt spacing tokens per view, eyeballing each — **not** a find-and-replace, see the spacing audit | [#1194](https://github.com/kevinmcaleer/noodleplanner/issues/1194) |
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

4.1 is the item with real judgement in it. 803 off-scale spacing values, and
each one is a question about that surface rather than a substitution.

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
- **Adopting the warm palette wholesale.** The audit found the app's real
  top-of-distribution greys are cool Bootstrap-era values that predate the
  warm system entirely. Whether they convert is a design decision with a
  visible result, and it wants a person looking at Penpot, not a refactor.
  Bands 1–2 deliberately leave it open.

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

## Also found, not done

**667 dead `var()` fallbacks.** 685 `var()` references carry a literal
fallback; 667 of them name a token that is always defined at `:root`, so the
fallback can never fire. Most encode the superseded #1024 blue identity
(`var(--np-accent, #108BB9)`), which means they are both dead and misleading:
if the token ever went missing, the app would silently revert to the old
palette rather than failing visibly. Removing them is provably zero-change and
would delete 667 stale colour literals.

Not done here because it is a 667-line diff across 20 files with a legitimate
counter-argument — a fallback is cheap insurance — and that is a maintainer's
call, not a refactor's.

The 12 exceptions are load-bearing and must keep theirs: the `--mm-*` mind-map
tokens are declared at component scope rather than `:root`, plus `--bs-primary`
from Bootstrap and `--wb-outline-depth` set inline by JS.

**Docs screenshots.** `docs/_static/img/how-to/cp-01-editor-frontmatter.png`
shows the editor's front matter and predates the highlighting fix, so it is now
wrong. Re-capturing needs `cd docs && make screenshots` in an environment that
can reach the CDN — and note that `docs/capture_screenshots.py` is still
Selenium, so it also needs a chromedriver matching the installed Chrome, which
is the version-skew problem that moved `tests/ui` to Playwright.

## Convergence metric

The single number to watch. Re-run `npm run audit:tokens` after each band.

Two numbers are worth watching, and they measure different things.

**Unique values in use** — re-run `npm run audit:tokens`. The original figures
counted the dead `style.css`; these are the linked stylesheets only:

| Category | Now | After band 2 (predicted) | Token count |
|---|---|---|---|
| Colours | 549 | ~360 | ~40 |
| Font sizes | 68 | 44 | 11 |
| Radii | 36 | 30 | 7 |
| Shadows | 98 | 60 | 5 |
| Spacing values | 48 | 48 (band 4) | 12 |

**Lint findings** — `npm run lint:design`, against
`ci/design-system-baseline.json`. This is the one CI enforces, and it only ever
goes down:

| Rule | Now |
|---|---|
| `raw-colour` | 1,090 |
| `off-scale-spacing` | 803 |
| `token-outside-canonical` | 37 |
| `unpaired-outline-none` | 0 |

`token-outside-canonical` is the smallest and the most tractable: 37
declarations, nearly all the identity palette in `base.css`, which wants moving
into `visual-system.css` wholesale rather than one name at a time.

Band 2 alone does not get these near the token counts, and it is not supposed
to — it removes the duplicates so that band 4's judgement calls are made
against a clean list.
