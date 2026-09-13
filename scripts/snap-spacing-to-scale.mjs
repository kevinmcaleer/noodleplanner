#!/usr/bin/env node
/**
 * Snap off-scale spacing values onto the #1191 scale (#1194, item 4.1).
 *
 * The companion to `adopt-spacing-tokens.mjs`. That one tokenised the
 * declarations that were already on the scale, which could not move anything.
 * This one moves things: `padding: 10px` becomes `padding: var(--np-space-12)`,
 * two pixels wider than it was.
 *
 * ## Why this is not a find-and-replace even though it looks like one
 *
 * The app carries two interleaved half-scales — 4/8/12/16 and 5/10/15/25/30 —
 * so the values being snapped are not stragglers: `10px` and `6px` are the
 * most-used off-scale values and appear in 23 of 27 stylesheets. Applied
 * blind, this changes the density of the whole app at once.
 *
 * So it is applied **per file**, and each file's effect is captured and
 * compared across all 39 views before the next one. A file whose diff shows
 * something breaking — a table overflowing, a control clipped — is reverted
 * and left for a person. `--only <file>` exists for exactly that loop.
 *
 * ## The rounding rule
 *
 * Nearest multiple of 4; on a tie, round up. Ties are the interesting case and
 * they are common (6 sits between 4 and 8, 10 between 8 and 12, 14 between 12
 * and 16), so the direction is a real decision rather than a detail. Up,
 * because rounding down compounds: a control with `padding: 6px` inside a row
 * with `gap: 6px` inside a panel with `padding: 10px` loses 6px of breathing
 * room in one commit, and cramped is harder to spot in a screenshot than roomy.
 *
 * Left alone:
 *   - anything already on the 4px grid, whatever its value — see the note on
 *     GRID below, this is the part that matters
 *   - `0`, `1px` and `2px`, which are finer than the grid and legitimately so
 *   - negative values, where a token needs wrapping in calc() and reads worse
 *   - anything not in px, which is tracking its container by design
 *   - values above 64px. `padding-left: 250px` is a layout constant, not a
 *     spacing step.
 *
 * Usage:
 *   node scripts/snap-spacing-to-scale.mjs --dry-run
 *   node scripts/snap-spacing-to-scale.mjs --only views/kanban.css
 *   node scripts/snap-spacing-to-scale.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const STATIC_DIR = join(ROOT, 'packages/noodle-web/src/noodle_web/static')
const INDEX = join(ROOT, 'packages/noodle-web/src/noodle_web/templates/index.html')

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null

const linked = [...readFileSync(INDEX, 'utf8').matchAll(/href="\/static\/([^"?]+\.css)/g)].map((m) => m[1])

// The rule is the 4px grid, not the named steps. `--np-space-*` is the
// preferred vocabulary, but plenty of on-grid values outside it are
// load-bearing rather than sloppy: `padding-bottom: 36px` matches the fixed
// status bar's height, `padding-right: 44px` is clearance for the icon inside
// a search input, and snapping either to the nearest named step misaligns the
// thing it was measured against. So on-grid values are left exactly as they
// are, and only off-grid ones move.
const GRID = 4
const MAX = 64
// 1px and 2px are finer than the grid and legitimately so -- a hairline gap is
// not a spacing step and rounding it to 4px doubles it.
const FINE = new Set([0, 1, 2])
const onGrid = (n) => FINE.has(n) || n % GRID === 0
// Every off-grid value in the app happens to snap to a named step, so the
// output is always a token rather than another literal.
const NAMED = new Set([2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64])
const SPACING_PROPS = new Set([
	'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
	'margin-block', 'margin-inline',
	'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
	'padding-block', 'padding-inline',
	'gap', 'row-gap', 'column-gap',
])
// visual-system.css is not skipped: it declares the scale, but the
// declarations that do so (`--np-space-8: 8px`) are custom properties, not
// spacing properties, so they never match. Its component rules should follow
// the grid like anything else.
const SKIP_FILES = new Set()

/** Nearest grid step, ties up. null means "leave this alone". */
function snap(n) {
	if (onGrid(n)) return n     // already on the grid, whatever its value
	if (n > MAX) return null    // a layout constant, not a spacing step
	const down = Math.floor(n / GRID) * GRID
	const up = down + GRID
	// `<=` is what makes a tie round up.
	const to = (n - down) <= (up - n) && (n - down) < (up - n) ? down : up
	return NAMED.has(to) ? to : null
}

const moves = new Map() // "10px -> 12px" -> count

function rewrite(css) {
	let count = 0
	const out = css.replace(/([a-zA-Z-]+)(\s*:\s*)([^;{}]+)(;)/g, (whole, prop, sep, value, end) => {
		if (!SPACING_PROPS.has(prop.trim())) return whole
		if (/var\(|calc\(|clamp\(|min\(|max\(|env\(/.test(value)) return whole
		const parts = value.trim().split(/\s+/)
		const next = []
		let changed = false
		for (const part of parts) {
			if (part === '0' || part === 'auto' || part === '!important') { next.push(part); continue }
			const m = /^(\d+)px$/.exec(part)
			if (!m) return whole // a unit or keyword this pass does not judge
			const n = parseInt(m[1], 10)
			const to = snap(n)
			if (to === null) return whole // a layout constant, or no token for it
			if (to !== n) {
				changed = true
				const key = `${n}px -> ${to}px`
				moves.set(key, (moves.get(key) ?? 0) + 1)
			}
			// An on-grid value with no named token keeps its literal; the
			// declaration is still correct, it just is not spelled as a token.
			next.push(to === 0 ? '0' : NAMED.has(to) ? `var(--np-space-${to})` : `${to}px`)
		}
		if (!changed) return whole
		count += next.filter((t) => t.startsWith('var(')).length
		return `${prop}${sep}${next.join(' ')}${end}`
	})
	return { css: out, count }
}

let total = 0
const perFile = []
for (const rel of linked) {
	if (SKIP_FILES.has(rel)) continue
	if (only && rel !== only) continue
	const path = join(STATIC_DIR, rel)
	const original = readFileSync(path, 'utf8')
	const { css, count } = rewrite(original)
	if (!count) continue
	if (!dryRun) writeFileSync(path, css)
	perFile.push([rel, count])
	total += count
}

for (const [file, n] of perFile.sort((a, b) => b[1] - a[1])) console.log(String(n).padStart(5), file)
console.log('\nvalue changes:')
for (const [move, n] of [...moves].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${move}`)
console.log(`\n${total} declaration value(s) ${dryRun ? 'would move' : 'moved'} across ${perFile.length} file(s)`)
