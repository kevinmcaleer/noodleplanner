#!/usr/bin/env node
/**
 * Replace neutral colour literals with the semantic token for their role (#1194).
 *
 * ## The hazard this is built around
 *
 * The surface and text tokens invert between themes: `--np-paper` is `#FAF8F4`
 * in light and `#201E1A` in dark, `--np-ink` the reverse. So a literal can only
 * become a token when the element it sits on *also* flips. `color: #fff` on a
 * coloured button must stay light in both themes — mapping it to a surface
 * token gives dark text on a dark button in dark mode.
 *
 * That hazard also states the rule. A literal is safe to map when **its
 * lightness matches the token's lightness in the light theme**:
 *
 *   - a *dark* literal in `color` is body text, and `--np-ink` is dark in
 *     light and light in dark, which is exactly what that text should do
 *   - a *light* literal in `background` is a surface, and `--np-surface`
 *     behaves the same way
 *   - a *light* literal in `color` is text on something coloured that does not
 *     flip, so it stays a literal
 *   - a *dark* literal in `background` is a deliberately dark surface — an
 *     editor, a tooltip — so it stays a literal too
 *
 * ## What is deliberately not touched
 *
 * **Chromatic colours.** Of the 878 hex literals the linter reports, 576 carry
 * a hue: status greens and reds, RAG tints, the editor's syntax theme. For
 * those the colour *is* the meaning, and mapping them onto a surface or text
 * token would destroy it. Only the 302 neutrals are candidates. A colour counts
 * as neutral when its channels are within 12/255 of each other.
 *
 * **Rules already scoped to a theme.** A `[data-theme="dark"]` rule has already
 * made its own decision; substituting a token there adds risk for nothing.
 *
 * Residual risk is text over a background this cannot see statically — a fixed
 * tint that does not flip. `scripts/check_rendered_contrast.py` walks the real
 * DOM in both themes and catches exactly that.
 *
 * Usage:
 *   node scripts/adopt-neutral-colours.mjs --dry-run
 *   node scripts/adopt-neutral-colours.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const STATIC_DIR = join(ROOT, 'packages/noodle-web/src/noodle_web/static')
const INDEX = join(ROOT, 'packages/noodle-web/src/noodle_web/templates/index.html')

const dryRun = process.argv.includes('--dry-run')
const linked = [...readFileSync(INDEX, 'utf8').matchAll(/href="\/static\/([^"?]+\.css)/g)].map((m) => m[1])

// The canonical layer declares the tokens; the chart tokens in base.css are a
// data palette, not surfaces.
const SKIP_FILES = new Set(['visual-system.css', 'base.css'])

const norm = (v) => {
	const s = v.trim().toLowerCase()
	if (s === 'white') return '#ffffff'
	if (s === 'black') return '#000000'
	const m3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(s)
	if (m3) return `#${m3[1]}${m3[1]}${m3[2]}${m3[2]}${m3[3]}${m3[3]}`
	return /^#[0-9a-f]{6}$/.test(s) ? s : null
}
const rgb = (hex) => {
	const n = parseInt(hex.slice(1), 16)
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const isNeutral = (hex) => {
	const [r, g, b] = rgb(hex)
	return Math.max(r, g, b) - Math.min(r, g, b) <= 12
}
const luminance = (hex) => {
	const ch = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
	const [r, g, b] = rgb(hex)
	return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)
}

// The candidate token for each role, read from the canonical layer rather than
// transcribed, so this cannot drift from the palette.
const CANONICAL = readFileSync(join(STATIC_DIR, 'visual-system.css'), 'utf8')
const lightValue = (name) => {
	const head = CANONICAL.slice(0, CANONICAL.indexOf('[data-theme="dark"]'))
	const m = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{3,6})\\s*;`).exec(head)
	return m ? norm(m[1]) : null
}
const TEXT_TOKENS = ['--np-ink', '--np-body', '--np-muted', '--np-faint']
const SURFACE_TOKENS = ['--np-surface', '--np-paper', '--np-surface-alt', '--np-sunken', '--np-selected']
const BORDER_TOKENS = ['--np-border', '--np-border-strong', '--np-hairline']

// A literal is only mapped to a token that already *looks like* it in the light
// theme. Bands keyed on lightness alone were the first attempt and mapped
// `background: #ccc` (L=0.61) to --np-sunken (L=0.83) -- a visible lightening
// dressed up as a token substitution. Requiring the two to be within a hair
// means the light theme barely moves and dark mode gains the theming it should
// have had, which is the whole point of the exercise.
//
// 1.1:1 is below the threshold of noticing for a large flat area and well below
// it for a hairline; anything further apart is a redesign, not an adoption.
const MAX_RATIO = 1.1
const contrast = (a, b) => {
	const [hi, lo] = luminance(a) > luminance(b) ? [luminance(a), luminance(b)] : [luminance(b), luminance(a)]
	return (hi + 0.05) / (lo + 0.05)
}

function nearest(candidates, hex) {
	let best = null
	let bestRatio = Infinity
	for (const name of candidates) {
		const value = lightValue(name)
		if (!value) continue
		const r = contrast(value, hex)
		if (r < bestRatio) { bestRatio = r; best = name }
	}
	return bestRatio <= MAX_RATIO ? best : null
}

function tokenFor(prop, hex) {
	if (!isNeutral(hex)) return null
	const l = luminance(hex)
	if (prop === 'color') {
		// A light neutral in `color` is text on something coloured. Leave it.
		return l < 0.35 ? nearest(TEXT_TOKENS, hex) : null
	}
	if (/^background(-color)?$/.test(prop)) {
		// A dark neutral background is a deliberately dark surface. Leave it.
		return l >= 0.50 ? nearest(SURFACE_TOKENS, hex) : null
	}
	if (/^border(-(top|right|bottom|left))?(-color)?$/.test(prop)) {
		// A white border is a separator on something coloured, like white text:
		// it does not follow the theme.
		return l >= 0.50 && l < 0.95 ? nearest(BORDER_TOKENS, hex) : null
	}
	return null
}

const moves = new Map()
let total = 0
const perFile = []

for (const rel of linked) {
	if (SKIP_FILES.has(rel)) continue
	const path = join(STATIC_DIR, rel)
	const original = readFileSync(path, 'utf8')
	let count = 0

	// Rewrite rule by rule so the selector is available: a rule already scoped
	// to a theme has made its own decision and is left alone.
	// A lookbehind, not a captured delimiter. `(^|[{};])(\s*)(...)` consumes the
	// `}` that ends the previous rule, so the *next* rule has no delimiter left to
	// match against and is skipped -- the scan sees exactly every other rule. On
	// components.css that was 648 rules of 1,270, and it is why an earlier run of
	// this file reported zero occurrences of literals that are plainly in it.
	const out = original.replace(/(?<=^|[{};])(\s*)([^{};@]+?)(\s*)\{([^{}]*)\}/g,
		(whole, ws1, selector, ws2, body) => {
			if (!selector.trim() || selector.trim().startsWith('@')) return whole
			if (/\[data-theme=["']?dark["']?\]/.test(selector)) return whole

			// A near-neutral that shares its rule with a *chromatic* colour is
			// half of a deliberate pair, not a stray grey. `.ns-cell.ns-selected`
			// is the case that forced this: `outline: 2px solid #217346` with
			// `background: #e8f4eb`, an Excel-green selection whose fill has a
			// channel spread of exactly 12 and so slipped under the neutrality
			// test. Mapping the fill to --np-surface-alt and leaving the green
			// outline would have broken the pairing while passing every check
			// this script runs.
			const hasChromatic = [...body.matchAll(/#[0-9a-fA-F]{3,6}\b/g)]
				.map((m) => norm(m[0]))
				.some((hex) => hex && !isNeutral(hex))
			if (hasChromatic) return whole

			const nextBody = body.replace(/([a-zA-Z-]+)(\s*:\s*)([^;]+)/g, (decl, prop, sep, value) => {
				const p = prop.trim()
				if (/var\(|gradient\(/.test(value)) return decl
				const nextValue = value.replace(/#[0-9a-fA-F]{3,6}\b|\bwhite\b|\bblack\b/g, (lit) => {
					const hex = norm(lit)
					if (!hex) return lit
					const token = tokenFor(p, hex)
					if (!token) return lit
					count++
					const key = `${p}: ${hex} -> ${token}`
					moves.set(key, (moves.get(key) ?? 0) + 1)
					return `var(${token})`
				})
				return `${prop}${sep}${nextValue}`
			})
			return `${ws1}${selector}${ws2}{${nextBody}}`
		})

	if (!count) continue
	if (!dryRun) writeFileSync(path, out)
	perFile.push([rel, count])
	total += count
}

for (const [file, n] of perFile.sort((a, b) => b[1] - a[1])) console.log(String(n).padStart(5), file)
console.log('\nmappings applied:')
for (const [move, n] of [...moves].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
	console.log(`  ${String(n).padStart(4)}  ${move}`)
}
console.log(`\n${total} literal(s) ${dryRun ? 'would be' : ''} mapped across ${perFile.length} file(s)`)
