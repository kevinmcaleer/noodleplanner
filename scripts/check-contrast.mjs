#!/usr/bin/env node
// WCAG contrast check for the NoodlePlanner design tokens.
//
// Reads the canonical token values straight out of visual-system.css (the
// layer the token audit established as authoritative) and checks the pairings
// the app actually renders -- body text on paper, muted text on a sunken
// surface, ink on marigold, the focus ring against every surface it can land
// on -- in both the light and dark themes.
//
// Usage:
//   node scripts/check-contrast.mjs          # report, exit 1 on any failure
//   node scripts/check-contrast.mjs --json   # machine-readable
//
// Thresholds are WCAG 2.2:
//   - 4.5:1 normal text (AA)
//   - 3:1   large text (AA), UI component boundaries and focus indicators
//     (1.4.11 Non-text Contrast)

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const VISUAL_SYSTEM = join(ROOT, 'packages/noodle-web/src/noodle_web/static/visual-system.css')

// --- Colour maths (sRGB -> relative luminance -> contrast ratio), per
// WCAG 2.x definitions. Only the colour forms the token file actually uses
// are handled; anything else is reported rather than silently scored.
function parseColour(raw) {
	const value = raw.trim()
	let m = /^#([0-9a-f]{3})$/i.exec(value)
	if (m) {
		const [r, g, b] = [...m[1]].map((c) => parseInt(c + c, 16))
		return { r, g, b, a: 1 }
	}
	m = /^#([0-9a-f]{6})$/i.exec(value)
	if (m) {
		const n = parseInt(m[1], 16)
		return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 }
	}
	m = /^#([0-9a-f]{8})$/i.exec(value)
	if (m) {
		const n = parseInt(m[1], 16)
		return { r: (n >>> 24) & 255, g: (n >> 16) & 255, b: (n >> 8) & 255, a: (n & 255) / 255 }
	}
	m = /^rgba?\(([^)]+)\)$/i.exec(value)
	if (m) {
		const parts = m[1].split(/[,\s/]+/).filter(Boolean)
		const [r, g, b] = parts.slice(0, 3).map((p) => (p.endsWith('%') ? Math.round(parseFloat(p) * 2.55) : parseFloat(p)))
		const a = parts[3] === undefined ? 1 : parseFloat(parts[3])
		return { r, g, b, a }
	}
	return null
}

function channelLuminance(c) {
	const s = c / 255
	return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

function luminance({ r, g, b }) {
	return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b)
}

// A translucent foreground is composited over its background before scoring,
// which is what the browser paints. Scoring the raw value instead would
// report a shadow tint as if it were opaque and pass things that don't.
function composite(fg, bg) {
	if (fg.a >= 1) return fg
	return {
		r: fg.r * fg.a + bg.r * (1 - fg.a),
		g: fg.g * fg.a + bg.g * (1 - fg.a),
		b: fg.b * fg.a + bg.b * (1 - fg.a),
		a: 1,
	}
}

function contrast(fgRaw, bgRaw) {
	const bg = parseColour(bgRaw)
	const fg = parseColour(fgRaw)
	if (!fg || !bg) return null
	const f = luminance(composite(fg, bg))
	const b = luminance(bg)
	const [hi, lo] = f > b ? [f, b] : [b, f]
	return (hi + 0.05) / (lo + 0.05)
}

// --- Token extraction. Same approach as token-audit.mjs: pull top-level
// custom properties out of the :root and [data-theme="dark"] blocks, then
// resolve var() indirection within each theme.
function readTokens() {
	const css = readFileSync(VISUAL_SYSTEM, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
	const light = {}
	const dark = {}
	for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
		const selector = m[1].trim()
		const isLight = /(^|,)\s*:root\s*(,|$)/.test(selector) || /^:root\b/.test(selector)
		const isDark = /\[data-theme=["']?dark["']?\]/.test(selector)
		if (!isLight && !isDark) continue
		for (const decl of m[2].split(';')) {
			const idx = decl.indexOf(':')
			if (idx === -1) continue
			const prop = decl.slice(0, idx).trim()
			if (!prop.startsWith('--')) continue
			const value = decl.slice(idx + 1).trim()
			if (isLight) light[prop] = value
			if (isDark || isLight) (isDark ? dark : light)[prop] = value
			// A `:root, [data-theme="dark"]` bridge rule applies to both.
			if (isLight && isDark) dark[prop] = value
		}
	}
	// Dark inherits anything it does not itself override.
	for (const [k, v] of Object.entries(light)) if (!(k in dark)) dark[k] = v

	const resolve = (value, map, seen = new Set()) => {
		const m = /^var\((--[a-zA-Z0-9-]+)\)$/.exec(value?.trim() ?? '')
		if (!m || seen.has(m[1]) || !(m[1] in map)) return value
		seen.add(m[1])
		return resolve(map[m[1]], map, seen)
	}
	const resolveAll = (map) => Object.fromEntries(Object.entries(map).map(([k, v]) => [k, resolve(v, map)]))
	return { light: resolveAll(light), dark: resolveAll(dark) }
}

// --- The pairings. Each is something the app actually renders; a token pair
// that never meets on screen is not worth a threshold.
//   min 4.5 = body-sized text
//   min 3   = large text (>=24px, or >=18.66px bold), UI boundaries, focus
const PAIRINGS = [
	// Text on its surfaces
	{ fg: '--np-ink', bg: '--np-paper', min: 4.5, what: 'primary text on the page' },
	{ fg: '--np-ink', bg: '--np-surface', min: 4.5, what: 'primary text on a card' },
	{ fg: '--np-ink', bg: '--np-surface-alt', min: 4.5, what: 'primary text on a raised surface' },
	{ fg: '--np-ink', bg: '--np-sunken', min: 4.5, what: 'primary text on a sunken surface' },
	{ fg: '--np-ink', bg: '--np-selected', min: 4.5, what: 'primary text on a selected row' },
	{ fg: '--np-body', bg: '--np-paper', min: 4.5, what: 'body text on the page' },
	{ fg: '--np-body', bg: '--np-surface', min: 4.5, what: 'body text on a card' },
	{ fg: '--np-body', bg: '--np-surface-alt', min: 4.5, what: 'body text on a raised surface' },
	{ fg: '--np-muted', bg: '--np-paper', min: 4.5, what: 'muted text on the page' },
	{ fg: '--np-muted', bg: '--np-surface', min: 4.5, what: 'muted text on a card' },
	{ fg: '--np-muted', bg: '--np-surface-alt', min: 4.5, what: 'muted text on a raised surface' },
	{ fg: '--np-faint', bg: '--np-paper', min: 4.5, what: 'faint text on the page' },
	{ fg: '--np-faint', bg: '--np-surface', min: 4.5, what: 'faint text on a card' },

	// Accent
	{ fg: '--np-on-accent', bg: '--np-accent', min: 4.5, what: 'label on a primary button' },
	{ fg: '--np-on-accent', bg: '--np-accent-hover', min: 4.5, what: 'label on a hovered primary button' },
	{ fg: '--np-accent-ink', bg: '--np-accent-tint', min: 4.5, what: 'text on an accent tint' },
	{ fg: '--np-accent-ink', bg: '--np-paper', min: 4.5, what: 'accent text on the page' },

	// Status
	{ fg: '--np-sage-ink', bg: '--np-sage-tint', min: 4.5, what: 'text on a success tint' },
	{ fg: '--np-sage-ink', bg: '--np-paper', min: 4.5, what: 'success text on the page' },
	{ fg: '--np-danger-ink', bg: '--np-danger-tint', min: 4.5, what: 'text on a danger tint' },
	{ fg: '--np-danger-ink', bg: '--np-paper', min: 4.5, what: 'danger text on the page' },

	// The rest of the status ramp (#1194), same shape as danger above. These
	// are what the Bootstrap/Material/Open Color literals scattered through
	// the view stylesheets were replaced by, so a regression here is a
	// regression in every alert, toast and status badge at once.
	{ fg: '--np-success-ink', bg: '--np-success-tint', min: 4.5, what: 'text on a success tint' },
	{ fg: '--np-success-ink', bg: '--np-paper', min: 4.5, what: 'success text on the page' },
	{ fg: '--np-warning-ink', bg: '--np-warning-tint', min: 4.5, what: 'text on a warning tint' },
	{ fg: '--np-warning-ink', bg: '--np-paper', min: 4.5, what: 'warning text on the page' },
	{ fg: '--np-info-ink', bg: '--np-info-tint', min: 4.5, what: 'text on an info tint' },
	{ fg: '--np-info-ink', bg: '--np-paper', min: 4.5, what: 'info text on the page' },

	// The filled variants. A solid status chip is a UI component boundary
	// (SC 1.4.11) rather than text, so 3:1 -- and --np-info is 3.88:1 on
	// white, which is exactly why it is checked at 3 and not at 4.5. Anything
	// putting body text on a filled --np-info swatch has to use the ink/tint
	// pair instead; the comment in visual-system.css says so too.
	// The whiteboard note's deliverable badge (#1248): a `$` glyph on a filled
	// --np-orange square. Its rule used to carry a raw `#111` under a comment
	// claiming `#161616` measured ~6.97:1 -- a claim nothing checked, pointing
	// at a test that measures wbContrastTextColour()'s output rather than any
	// value in that stylesheet. Text on a filled swatch, so 4.5:1. Both tokens
	// are single-valued across themes by design, which is the point of the
	// hue-is-the-meaning palette, so one entry covers both.
	{ fg: '--np-orange-ink', bg: '--np-orange', min: 4.5, what: 'deliverable badge glyph on its badge' },

	// <np-checkbox>'s tick on a checked box (#1245). A non-text indicator, so
	// 3:1 -- and this is the pairing nothing was scoring while kanban and both
	// pilot components filled a checkbox with --np-success and drew a white
	// tick on it: 4.59:1 in light, 2.03:1 in dark. --np-on-success flips with
	// the theme for that reason, so both values are measured here.
	{ fg: '--np-on-success', bg: '--np-success', min: 3, what: 'checkbox tick on a checked box' },

	// A resource avatar's initials on its chip (#1246/#1199). Text, so 4.5:1.
	// The six avatar treatments this replaces all used a gradient background,
	// which this checker cannot parse and so never scored.
	{ fg: '--np-on-info', bg: '--np-info', min: 4.5, what: 'resource avatar initials on their chip' },

	{ fg: '--np-danger', bg: '--np-paper', min: 3, what: 'filled danger against the page' },
	{ fg: '--np-success', bg: '--np-paper', min: 3, what: 'filled success against the page' },
	{ fg: '--np-info', bg: '--np-paper', min: 3, what: 'filled info against the page' },

	// Non-text contrast (WCAG 2.2 SC 1.4.11): the visual boundary of a UI
	// component, and any focus indicator, needs 3:1.
	//
	// --np-border-strong is deliberately not checked here. It is 1.33:1
	// against the page, but it is a decorative separator -- hairlines between
	// rows, the edge of a panel -- and 1.4.11 does not cover those. Controls
	// the user has to find the edge of use --np-border-control instead.
	{ fg: '--np-border-control', bg: '--np-paper', min: 3, what: 'control border against the page' },
	{ fg: '--np-border-control', bg: '--np-surface', min: 3, what: 'control border against a card' },
	{ fg: '--np-border-control', bg: '--np-surface-alt', min: 3, what: 'control border against a raised surface' },
	{ fg: '--np-border-control', bg: '--np-sunken', min: 3, what: 'control border against a sunken surface' },

	// The focus ring is two-layer: an inner halo in --np-paper, then the ring.
	// So the ring always meets --np-paper, never whatever is underneath -- which
	// is the point, because no single colour clears 3:1 against both a dark page
	// and a marigold button. That makes "ring against the page" the assertion
	// that matters; the ring is checked against the other surfaces too because
	// the halo is only 2px and a surface shows through around it.
	{ fg: '--np-focus-ring-color', bg: '--np-paper', min: 3, what: 'focus ring against the page' },
	{ fg: '--np-focus-ring-color', bg: '--np-surface', min: 3, what: 'focus ring against a card' },
	{ fg: '--np-focus-ring-color', bg: '--np-surface-alt', min: 3, what: 'focus ring against a raised surface' },
	{ fg: '--np-focus-ring-color', bg: '--np-sunken', min: 3, what: 'focus ring against a sunken surface' },
]

const tokens = readTokens()
const results = []
for (const theme of ['light', 'dark']) {
	const map = tokens[theme]
	for (const p of PAIRINGS) {
		const fgValue = map[p.fg]
		const bgValue = map[p.bg]
		if (fgValue === undefined || bgValue === undefined) {
			results.push({ theme, ...p, status: 'missing', detail: `${fgValue === undefined ? p.fg : p.bg} is not defined` })
			continue
		}
		const ratio = contrast(fgValue, bgValue)
		if (ratio === null) {
			results.push({ theme, ...p, fgValue, bgValue, status: 'unparsed' })
			continue
		}
		results.push({
			theme, ...p, fgValue, bgValue,
			ratio: Math.round(ratio * 100) / 100,
			status: ratio >= p.min ? 'pass' : 'fail',
		})
	}
}

if (process.argv.includes('--json')) {
	console.log(JSON.stringify({ results }, null, 2))
} else {
	for (const theme of ['light', 'dark']) {
		console.log(`\n${theme.toUpperCase()}`)
		for (const r of results.filter((x) => x.theme === theme)) {
			const mark = r.status === 'pass' ? 'PASS' : r.status === 'fail' ? 'FAIL' : r.status.toUpperCase()
			const ratio = r.ratio === undefined ? '   -  ' : `${r.ratio.toFixed(2)}:1`.padStart(7)
			console.log(`  ${mark.padEnd(9)} ${ratio}  (needs ${r.min}:1)  ${r.what}`)
			if (r.status === 'fail') console.log(`${' '.repeat(13)}${r.fg} ${r.fgValue} on ${r.bg} ${r.bgValue}`)
			if (r.status !== 'pass' && r.detail) console.log(`${' '.repeat(13)}${r.detail}`)
		}
	}
	const bad = results.filter((r) => r.status !== 'pass')
	console.log(`\n${results.length - bad.length}/${results.length} pairings pass.`)
	if (bad.length) console.log(`${bad.length} need attention.`)
}

process.exit(results.some((r) => r.status !== 'pass') ? 1 : 0)
