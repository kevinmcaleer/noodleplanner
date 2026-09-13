#!/usr/bin/env node
/**
 * Replace on-scale spacing literals with their token (#1194).
 *
 * `padding: 8px` becomes `padding: var(--np-space-8)`. Only values that are
 * already on the #1191 scale are touched, so this cannot move anything: it is
 * the same number, named.
 *
 * ## Why the off-scale values are left alone
 *
 * The app carries two interleaved half-scales — 4/8/12/16 and 5/10/15/25/30 —
 * laid down by different authors. `10px` (267 uses) and `6px` (193) are the
 * 2nd and 5th most-used spacing values and appear in 24 of 27 stylesheets, so
 * snapping them to the nearest token would visibly move a quarter of the app's
 * layout in one commit. Which of `8px` or `12px` a given `10px` should become
 * is a question about that surface, and a person should answer it looking at
 * the surface.
 *
 * Leaving them raw is what makes them findable: after this pass, a bare pixel
 * value in a spacing property *is* the remaining work, and
 * `npm run lint:design -- --list off-scale-spacing` enumerates it.
 *
 * Also skipped:
 *   - `0`, which is grid-agnostic and clearer as `0`
 *   - negative values, where a token would need wrapping in calc() and the
 *     result reads worse than the literal
 *   - anything already inside var()/calc()/clamp()
 *   - visual-system.css, where the scale is defined
 *
 * Usage:
 *   node scripts/adopt-spacing-tokens.mjs --dry-run
 *   node scripts/adopt-spacing-tokens.mjs
 *
 * Verify with a before/after capture — see scripts/compare_screens.py.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const STATIC_DIR = join(ROOT, 'packages/noodle-web/src/noodle_web/static')
const INDEX = join(ROOT, 'packages/noodle-web/src/noodle_web/templates/index.html')

const dryRun = process.argv.includes('--dry-run')
const linked = [...readFileSync(INDEX, 'utf8').matchAll(/href="\/static\/([^"?]+\.css)/g)].map((m) => m[1])

const SCALE = new Set([2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64])
const SPACING_PROPS = new Set([
	'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
	'margin-block', 'margin-inline',
	'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
	'padding-block', 'padding-inline',
	'gap', 'row-gap', 'column-gap',
])
const SKIP_FILES = new Set(['visual-system.css'])

/**
 * Rewrite the declarations of one stylesheet.
 *
 * Works on the raw text a declaration at a time rather than parsing the whole
 * sheet: the values being changed are always inside `prop: value;`, and a
 * text-level pass keeps every comment, blank line and bit of formatting
 * exactly where the author put it — which matters for a 1,000-line diff that
 * someone has to read.
 */
function rewrite(css) {
	let count = 0
	const out = css.replace(/([a-zA-Z-]+)(\s*:\s*)([^;{}]+)(;)/g, (whole, prop, sep, value, end) => {
		if (!SPACING_PROPS.has(prop.trim())) return whole
		// Already indirected, or a keyword like `auto`/`inherit`: leave it.
		if (/var\(|calc\(|clamp\(|min\(|max\(|env\(/.test(value)) return whole
		// All-or-nothing per declaration. Tokenising only the on-scale half of
		// `padding: 14px 16px` leaves `padding: 14px var(--np-space-16)`, which
		// reads as a half-finished edit and hides that the 14px is the part
		// still needing a decision. A declaration that is not wholly on the
		// scale stays wholly raw, and is therefore obviously outstanding.
		const parts = value.trim().split(/\s+/)
		const tokenised = []
		let anyScale = false
		for (const part of parts) {
			if (part === '0' || part === 'auto' || part === '!important') {
				tokenised.push(part)
				continue
			}
			const m = /^(\d+)px$/.exec(part)
			if (!m) return whole // a unit this pass does not judge: leave the lot
			const n = parseInt(m[1], 10)
			if (!SCALE.has(n)) return whole // off-scale: the whole declaration waits
			anyScale = true
			tokenised.push(`var(--np-space-${n})`)
		}
		if (!anyScale) return whole
		count += tokenised.filter((t) => t.startsWith('var(')).length
		return `${prop}${sep}${tokenised.join(' ')}${end}`
	})
	return { css: out, count }
}

let total = 0
const perFile = []
for (const rel of linked) {
	if (SKIP_FILES.has(rel)) continue
	const path = join(STATIC_DIR, rel)
	const original = readFileSync(path, 'utf8')
	const { css, count } = rewrite(original)
	if (!count) continue
	if (!dryRun) writeFileSync(path, css)
	perFile.push([rel, count])
	total += count
}

for (const [file, n] of perFile.sort((a, b) => b[1] - a[1])) {
	console.log(String(n).padStart(5), file)
}
console.log(`\n${total} spacing value(s) ${dryRun ? 'would be' : ''} tokenised across ${perFile.length} file(s)`)
