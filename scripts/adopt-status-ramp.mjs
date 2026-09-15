#!/usr/bin/env node
/**
 * Replace third-party palette literals with the semantic status ramp (#1194).
 *
 * ## What this is actually fixing
 *
 * The audit called the 605 chromatic literals "semantic -- the colour is the
 * meaning" and left them alone. That was too blunt. Sorting them by origin
 * shows 186 are recognisably **Bootstrap 5, Material Design or Open Color**,
 * three third-party palettes that arrived with whoever wrote each view and
 * have nothing to do with this app's identity. Five different reds mean
 * "danger" (#dc3545, #c62828, #e03131, #c92a2a, #b71c1c); four different
 * greens mean "success". That is not meaning, it is drift, and it is exactly
 * what the epic exists to remove.
 *
 * visual-system.css now names the ramp -- danger/success/warning/info, each
 * with base, tint and ink, in both themes, every pairing gated by
 * check-contrast.mjs. This maps the literals onto it.
 *
 * ## Why an explicit table rather than a classifier
 *
 * An earlier pass here used a regex over the selector to guess the role. It
 * gets the obvious ones (`.alert-warning`) and quietly mangles the rest: 145
 * of the findings have selectors that say nothing about role. A hand-written
 * table is longer but every line is reviewable, and a literal nobody has
 * classified is simply left alone rather than guessed at.
 *
 * ## What this deliberately does not touch
 *
 * - Rules already scoped to `[data-theme="dark"]`. They have made their own
 *   decision, and the tokens flip on their own.
 * - The editor's syntax theme, the RAG ramp, chart series colours -- the
 *   allowlist in lint-design-system.mjs names them and the reasons hold here.
 * - Any literal not in the table below.
 *
 * Usage:
 *   node scripts/adopt-status-ramp.mjs --dry-run
 *   node scripts/adopt-status-ramp.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const STATIC_DIR = join(ROOT, 'packages/noodle-web/src/noodle_web/static')
const INDEX = join(ROOT, 'packages/noodle-web/src/noodle_web/templates/index.html')

const dryRun = process.argv.includes('--dry-run')
const linked = [...readFileSync(INDEX, 'utf8').matchAll(/href="\/static\/([^"?]+\.css)/g)].map((m) => m[1])

// The canonical layer declares the ramp; base.css's chart tokens are a data
// palette; gantt.css carries the editor's syntax theme, which the linter
// allowlist already exempts and which must not be dragged onto UI tokens.
const SKIP_FILES = new Set(['visual-system.css', 'base.css'])
const SKIP_SELECTOR = /\.syntax-|\.line-numbers|\.editor-highlight|\.section-fold|\brag-|\bchart-|\bseries-/

// literal -> token. Grouped by the palette each came from, so the provenance
// stays visible: this is three vendors' idea of "red", not three meanings.
const MAP = {
	// --- danger. Bootstrap $danger, Material red 800/900/600, Open Color red 7/8.
	'#dc3545': '--np-danger',
	'#c62828': '--np-danger',
	'#b71c1c': '--np-danger',
	'#e53935': '--np-danger',
	'#e03131': '--np-danger',
	'#c92a2a': '--np-danger',
	// Bootstrap .alert-danger's own pair.
	'#721c24': '--np-danger-ink',
	'#f8d7da': '--np-danger-tint',

	// --- success. Bootstrap $success (both eras), Material green 800/600/500/700,
	// Open Color green 7/8.
	'#28a745': '--np-success',
	'#198754': '--np-success',
	'#2e7d32': '--np-success',
	'#43a047': '--np-success',
	'#4caf50': '--np-success',
	'#388e3c': '--np-success',
	'#2b8a3e': '--np-success',
	'#37b24d': '--np-success',
	'#155724': '--np-success-ink',
	'#d4edda': '--np-success-tint',

	// --- warning. Bootstrap $warning, Material orange 800/600, Open Color
	// orange 7/9, Bootstrap $orange.
	'#ffc107': '--np-warning',
	'#fd7e14': '--np-warning',
	'#ef6c00': '--np-warning',
	'#fb8c00': '--np-warning',
	'#f59f00': '--np-warning',
	'#e67700': '--np-warning',
	'#856404': '--np-warning-ink',
	'#fff3cd': '--np-warning-tint',

	// --- info. Bootstrap $primary/$info, Material blue 700/800/900,
	// Open Color blue 7/8.
	'#0d6efd': '--np-info',
	'#1976d2': '--np-info',
	'#1565c0': '--np-info',
	'#0d47a1': '--np-info',
	'#1c7ed6': '--np-info',
	'#1971c2': '--np-info',
	'#0c5460': '--np-info-ink',
	'#d1ecf1': '--np-info-tint',
	// The pale end of Material and Open Color, used as badge and chip
	// backgrounds. These have to move with their foregrounds: mapping the text
	// to a ramp token and leaving a hard-coded tint behind it is how you get
	// a mid-tone on a pale ground in light and a light-on-light in dark.
	// check_rendered_contrast.py caught exactly that on five badges.
	'#e3f2fd': '--np-info-tint',
	'#e7f5ff': '--np-info-tint',
	'#e8f5e9': '--np-success-tint',
	'#fbe9e7': '--np-danger-tint',
	'#bf360c': '--np-danger-ink',

	// --- neutrals. Bootstrap's grey scale, which is the other half of the
	// drift: these are surfaces, borders and text that never learned to flip
	// with the theme. Mapped by role, not by lightness -- see the note on
	// #adb5bd below.
	'#212529': '--np-ink',
	'#343a40': '--np-ink',
	'#495057': '--np-body',
	'#6c757d': '--np-muted',
	// #adb5bd is 2.0:1 on a light page -- it fails AA today. --np-faint is the
	// token for de-emphasised text and clears it, so this mapping is a
	// contrast fix as well as a theming one. check_rendered_contrast.py is
	// what proves it did not go the other way.
	'#adb5bd': '--np-faint',
	'#dee2e6': '--np-border',
	'#ced4da': '--np-border',
	'#e9ecef': '--np-border',
	'#f8f9fa': '--np-surface-alt',
}

// Properties a status colour can legitimately land on. `box-shadow` is out:
// a shadow is elevation, and adopt-shadow-tokens.mjs handles those.
const PROP_OK = /^(color|background|background-color|border(-(top|right|bottom|left))?(-color)?|outline(-color)?|fill|stroke)$/

const norm = (v) => {
	const s = v.trim().toLowerCase()
	const m3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(s)
	if (m3) return `#${m3[1]}${m3[1]}${m3[2]}${m3[2]}${m3[3]}${m3[3]}`
	return /^#[0-9a-f]{6}$/.test(s) ? s : null
}

const moves = new Map()
let pairFixes = 0
let total = 0
const perFile = []

for (const rel of linked) {
	if (SKIP_FILES.has(rel)) continue
	const path = join(STATIC_DIR, rel)
	const original = readFileSync(path, 'utf8')
	let count = 0

	// A lookbehind, not a captured delimiter. `(^|[{};])(\s*)(...)` consumes the
	// `}` that ends the previous rule, so the *next* rule has no delimiter left to
	// match against and is skipped -- the scan sees exactly every other rule. On
	// components.css that was 648 rules of 1,270, and it is why an earlier run of
	// this file reported zero occurrences of literals that are plainly in it.
	const out = original.replace(/(?<=^|[{};])(\s*)([^{};@]+?)(\s*)\{([^{}]*)\}/g,
		(whole, ws1, selector, ws2, body) => {
			const sel = selector.trim()
			if (!sel || sel.startsWith('@')) return whole
			if (/\[data-theme=["']?dark["']?\]/.test(sel)) return whole
			if (SKIP_SELECTOR.test(sel)) return whole

			const nextBody = body.replace(/([a-zA-Z-]+)(\s*:\s*)([^;]+)/g, (decl, prop, sep, value) => {
				const p = prop.trim().toLowerCase()
				if (!PROP_OK.test(p)) return decl
				if (/gradient\(/.test(value)) return decl
				const nextValue = value.replace(/#[0-9a-fA-F]{3,6}\b/g, (lit) => {
					const hex = norm(lit)
					const token = hex && MAP[hex]
					if (!token) return lit
					count++
					const key = `${hex} -> ${token}`
					moves.set(key, (moves.get(key) ?? 0) + 1)
					return `var(${token})`
				})
				return `${prop}${sep}${nextValue}`
			})
			// A tint background pairs with the ink, never with the base: the
			// base is a mid-tone chosen to sit on the *page*, and on a tint it
			// is 2-4:1. Any rule that ends up with `background: var(--np-X-tint)`
			// therefore has its `color: var(--np-X)` promoted to `--np-X-ink`.
			// Stated as a rule rather than fixed per-badge because it is one --
			// and it is the rule check-contrast.mjs gates.
			const tint = /background(-color)?\s*:\s*var\(\s*--np-(danger|success|warning|info)-tint\s*\)/.exec(nextBody)
			const paired = tint
				? nextBody.replace(
					new RegExp(`(color\\s*:\\s*)var\\(\\s*--np-${tint[2]}\\s*\\)`, 'g'),
					(_, lead) => { pairFixes++; return `${lead}var(--np-${tint[2]}-ink)` })
				: nextBody
			return `${ws1}${selector}${ws2}{${paired}}`
		})

	if (!count) continue
	if (!dryRun) writeFileSync(path, out)
	perFile.push([rel, count])
	total += count
}

for (const [file, n] of perFile.sort((a, b) => b[1] - a[1])) console.log(String(n).padStart(5), file)
console.log('\nmappings applied:')
for (const [move, n] of [...moves].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${move}`)
console.log(`\n${total} literal(s) ${dryRun ? 'would be' : ''} mapped across ${perFile.length} file(s)`)
console.log(`${pairFixes} tint background(s) had their foreground promoted to the matching ink`)
