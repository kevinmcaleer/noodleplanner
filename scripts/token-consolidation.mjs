#!/usr/bin/env node
// Token consolidation analysis for the NoodlePlanner web app.
//
// The token audit (scripts/token-audit.mjs) answers "what raw values exist?".
// This script answers the follow-up: "which of them are near-duplicates that
// should collapse onto a single token, and which member should win?"
//
// It clusters every raw colour, font-size, radius and box-shadow found in the
// CSS by perceptual/numeric proximity, then picks a recommended winner per
// cluster -- an existing canonical --np-* token where one is in range,
// otherwise the highest-traffic member.
//
// Usage: node scripts/token-consolidation.mjs
// Writes docs/design/token-consolidation.json.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { analyze } from '@projectwallace/css-analyzer'
import { analysis_to_tokens } from '@projectwallace/css-design-tokens'

const ROOT = new URL('..', import.meta.url).pathname
const STATIC_DIR = join(ROOT, 'packages/noodle-web/src/noodle_web/static')
const VISUAL_SYSTEM = join(STATIC_DIR, 'visual-system.css')
const OUT = join(ROOT, 'docs/design/token-consolidation.json')

// Tuning knobs. Deliberately conservative: a cluster is a *merge candidate*
// for a human to approve, not an automatic rewrite.
const arg = (name, fallback) => {
	const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
	return hit ? parseFloat(hit.split('=')[1]) : fallback
}

// max CIEDE2000 distance within a colour cluster. 2.3 is the classic
// "just noticeable difference" for adjacent patches; 3 keeps clusters to
// colours a person would struggle to tell apart, which is the bar for
// calling two values the same design decision.
const COLOR_DE = arg('color-de', 3)
// Neutrals need a tighter bar than the chromatic colours. Stacked surfaces
// (page / card / hairline) are deliberately only a few ΔE apart, so the
// general threshold would merge a whole surface ramp into one swatch.
const NEUTRAL_DE = arg('neutral-de', 1.6)
const NEUTRAL_CHROMA = 6 // Lab chroma below this counts as neutral
const FONT_SIZE_REL = arg('font-size-rel', 0.04) // max relative difference within a font-size cluster
const RADIUS_PX = arg('radius-px', 1.5) // max px difference within a radius cluster
const SHADOW_GEOM_PX = arg('shadow-px', 2) // max px difference per shadow geometry component

// ---------------------------------------------------------------------------
// CSS discovery -- linked stylesheets only, matching token-audit.mjs. The
// static directory also holds `style.css`, 13k lines that #571's split left
// nothing linking to; scanning it anyway silently pulls dead declarations
// into "usage", which can even flip which spelling a cluster picks as the
// highest-traffic winner.
// ---------------------------------------------------------------------------
const INDEX_HTML = join(ROOT, 'packages/noodle-web/src/noodle_web/templates/index.html')
const linkedRel = [...readFileSync(INDEX_HTML, 'utf8').matchAll(/href="\/static\/([^"?]+\.css)/g)].map((m) => m[1])
const cssFiles = linkedRel.map((rel) => join(STATIC_DIR, rel)).sort()
const combined = cssFiles.map((f) => readFileSync(f, 'utf8')).join('\n')
const analysis = analyze(combined)
const rawTokens = analysis_to_tokens(analysis)

// ---------------------------------------------------------------------------
// Canonical tokens from visual-system.css, so clusters can name an existing
// token as the winner rather than inventing a new one.
// ---------------------------------------------------------------------------
function parseRootCustomProps(css) {
	// visual-system.css is hand-authored and flat; a brace-depth scan is enough.
	css = css.replace(/\/\*[\s\S]*?\*\//g, '')
	const out = { light: {}, dark: {} }
	const blockRe = /([^{}]+)\{([^{}]*)\}/g
	let m
	while ((m = blockRe.exec(css))) {
		const selector = m[1].trim()
		const isLight = selector === ':root'
		const isDark = /\[data-theme=["']?dark["']?\]/.test(selector) && !selector.includes(' ')
		if (!isLight && !isDark) continue
		const bucket = isLight ? out.light : out.dark
		for (const decl of m[2].split(';')) {
			const idx = decl.indexOf(':')
			if (idx < 0) continue
			const prop = decl.slice(0, idx).trim()
			if (!prop.startsWith('--')) continue
			bucket[prop] = decl.slice(idx + 1).trim()
		}
	}
	return out
}

const canonical = parseRootCustomProps(readFileSync(VISUAL_SYSTEM, 'utf8'))

// ---------------------------------------------------------------------------
// Colour maths: sRGB -> Lab -> CIEDE2000, plus helpers for hex round-trip.
// ---------------------------------------------------------------------------
const NAMED = {
	white: '#ffffff', black: '#000000', red: '#ff0000', silver: '#c0c0c0',
	gray: '#808080', grey: '#808080', whitesmoke: '#f5f5f5', gainsboro: '#dcdcdc',
	lightgray: '#d3d3d3', lightgrey: '#d3d3d3', darkgray: '#a9a9a9', darkgrey: '#a9a9a9',
	dimgray: '#696969', dimgrey: '#696969', orange: '#ffa500', gold: '#ffd700',
	green: '#008000', blue: '#0000ff', navy: '#000080', teal: '#008080',
	purple: '#800080', yellow: '#ffff00', crimson: '#dc143c', tomato: '#ff6347',
}

function parseColor(str) {
	if (!str) return null
	let s = String(str).trim().toLowerCase()
	if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }
	if (s === 'currentcolor' || s === 'inherit' || s === 'initial') return null
	if (NAMED[s]) s = NAMED[s]
	if (s.startsWith('#')) {
		const h = s.slice(1)
		const exp = h.length === 3 || h.length === 4
			? h.split('').map((c) => c + c).join('')
			: h
		if (exp.length !== 6 && exp.length !== 8) return null
		if (!/^[0-9a-f]+$/.test(exp)) return null
		return {
			r: parseInt(exp.slice(0, 2), 16),
			g: parseInt(exp.slice(2, 4), 16),
			b: parseInt(exp.slice(4, 6), 16),
			a: exp.length === 8 ? parseInt(exp.slice(6, 8), 16) / 255 : 1,
		}
	}
	const fn = s.match(/^rgba?\(([^)]+)\)$/)
	if (fn) {
		const parts = fn[1].split(/[\s,/]+/).filter(Boolean)
		if (parts.length < 3) return null
		const num = (p, max) => (p.endsWith('%') ? (parseFloat(p) / 100) * max : parseFloat(p))
		const a = parts[3] === undefined ? 1 : num(parts[3], 1)
		return { r: num(parts[0], 255), g: num(parts[1], 255), b: num(parts[2], 255), a }
	}
	const hsl = s.match(/^hsla?\(([^)]+)\)$/)
	if (hsl) {
		const parts = hsl[1].split(/[\s,/]+/).filter(Boolean)
		if (parts.length < 3) return null
		const h = parseFloat(parts[0]) / 360
		const sat = parseFloat(parts[1]) / 100
		const l = parseFloat(parts[2]) / 100
		const a = parts[3] === undefined ? 1 : (parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]))
		const hue2rgb = (p, q, t) => {
			if (t < 0) t += 1
			if (t > 1) t -= 1
			if (t < 1 / 6) return p + (q - p) * 6 * t
			if (t < 1 / 2) return q
			if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
			return p
		}
		let r, g, b
		if (sat === 0) { r = g = b = l } else {
			const q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat
			const p = 2 * l - q
			r = hue2rgb(p, q, h + 1 / 3); g = hue2rgb(p, q, h); b = hue2rgb(p, q, h - 1 / 3)
		}
		return { r: r * 255, g: g * 255, b: b * 255, a }
	}
	return null
}

const toHex = (c) => {
	const h = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
	return `#${h(c.r)}${h(c.g)}${h(c.b)}`.toUpperCase()
}

function srgbToLab({ r, g, b }) {
	const lin = (v) => {
		v /= 255
		return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
	}
	const R = lin(r), G = lin(g), B = lin(b)
	const X = R * 0.4124564 + G * 0.3575761 + B * 0.1804375
	const Y = R * 0.2126729 + G * 0.7151522 + B * 0.0721750
	const Z = R * 0.0193339 + G * 0.1191920 + B * 0.9503041
	const wx = 0.95047, wy = 1, wz = 1.08883
	const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29)
	const fx = f(X / wx), fy = f(Y / wy), fz = f(Z / wz)
	return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) }
}

// CIEDE2000 -- the standard perceptual colour-difference metric. A ΔE of ~2 is
// the "just noticeable" threshold for adjacent patches; we cluster at 5, which
// is "obviously the same colour to anyone not comparing them side by side".
function ciede2000(l1, l2) {
	const { L: L1, a: a1, b: b1 } = l1
	const { L: L2, a: a2, b: b2 } = l2
	const kL = 1, kC = 1, kH = 1
	const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2)
	const Cbar = (C1 + C2) / 2
	const G = 0.5 * (1 - Math.sqrt(Math.pow(Cbar, 7) / (Math.pow(Cbar, 7) + Math.pow(25, 7))))
	const a1p = (1 + G) * a1, a2p = (1 + G) * a2
	const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2)
	const deg = (r) => (r * 180) / Math.PI
	const rad = (d) => (d * Math.PI) / 180
	const h1p = C1p === 0 ? 0 : (deg(Math.atan2(b1, a1p)) + 360) % 360
	const h2p = C2p === 0 ? 0 : (deg(Math.atan2(b2, a2p)) + 360) % 360
	const dLp = L2 - L1
	const dCp = C2p - C1p
	let dhp = 0
	if (C1p * C2p !== 0) {
		dhp = h2p - h1p
		if (dhp > 180) dhp -= 360
		else if (dhp < -180) dhp += 360
	}
	const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dhp) / 2)
	const Lbp = (L1 + L2) / 2
	const Cbp = (C1p + C2p) / 2
	let hbp = h1p + h2p
	if (C1p * C2p !== 0) {
		if (Math.abs(h1p - h2p) > 180) hbp += h1p + h2p < 360 ? 360 : -360
		hbp /= 2
	}
	const T = 1 - 0.17 * Math.cos(rad(hbp - 30)) + 0.24 * Math.cos(rad(2 * hbp))
		+ 0.32 * Math.cos(rad(3 * hbp + 6)) - 0.20 * Math.cos(rad(4 * hbp - 63))
	const dTheta = 30 * Math.exp(-Math.pow((hbp - 275) / 25, 2))
	const Rc = 2 * Math.sqrt(Math.pow(Cbp, 7) / (Math.pow(Cbp, 7) + Math.pow(25, 7)))
	const Sl = 1 + (0.015 * Math.pow(Lbp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbp - 50, 2))
	const Sc = 1 + 0.045 * Cbp
	const Sh = 1 + 0.015 * Cbp * T
	const Rt = -Math.sin(rad(2 * dTheta)) * Rc
	return Math.sqrt(
		Math.pow(dLp / (kL * Sl), 2) +
		Math.pow(dCp / (kC * Sc), 2) +
		Math.pow(dHp / (kH * Sh), 2) +
		Rt * (dCp / (kC * Sc)) * (dHp / (kH * Sh))
	)
}

// ---------------------------------------------------------------------------
// Collect raw values out of the Wallace token extraction
// ---------------------------------------------------------------------------
const EXT_USAGE = 'com.projectwallace.usage-count'
const EXT_AUTHORED = 'com.projectwallace.css-authored-as'
const EXT_PROPS = 'com.projectwallace.css-properties'

function rawGroup(group) {
	return Object.entries(group ?? {}).map(([id, t]) => ({
		id,
		authoredAs: t.$extensions?.[EXT_AUTHORED],
		usage: t.$extensions?.[EXT_USAGE] ?? 0,
		props: t.$extensions?.[EXT_PROPS] ?? [],
	}))
}

// Canonical colour tokens, so a cluster can recommend an existing token.
const canonicalColors = []
for (const [theme, bucket] of [['light', canonical.light], ['dark', canonical.dark]]) {
	for (const [name, value] of Object.entries(bucket)) {
		const rgb = parseColor(value)
		if (!rgb || rgb.a === 0) continue
		canonicalColors.push({ name, theme, value, hex: toHex(rgb), lab: srgbToLab(rgb) })
	}
}

// ---------------------------------------------------------------------------
// Generic greedy clustering: walk members highest-usage-first, and put each
// into the first existing cluster whose seed it is "near". Seeding by usage
// means the highest-traffic value anchors each cluster, which is also the
// value most likely to be the right winner.
// ---------------------------------------------------------------------------
function cluster(members, near) {
	const sorted = [...members].sort((a, b) => b.usage - a.usage)
	const clusters = []
	for (const m of sorted) {
		const hit = clusters.find((c) => near(c.seed, m))
		if (hit) hit.members.push(m)
		else clusters.push({ seed: m, members: [m] })
	}
	return clusters
}

const totalUsage = (c) => c.members.reduce((n, m) => n + m.usage, 0)

// --- Colours ---------------------------------------------------------------
const colorMembers = rawGroup(rawTokens.color)
	.map((m) => {
		const rgb = parseColor(m.authoredAs)
		if (!rgb) return null
		return { ...m, rgb, hex: toHex(rgb), alpha: rgb.a, lab: srgbToLab(rgb) }
	})
	.filter(Boolean)

// Two colours are the same design decision only if they are perceptually
// indistinguishable AND equally transparent. Neutrals get the tighter bar.
const chroma = (lab) => Math.hypot(lab.a, lab.b)
function sameColor(a, b) {
	const limit =
		chroma(a.lab) < NEUTRAL_CHROMA && chroma(b.lab) < NEUTRAL_CHROMA ? NEUTRAL_DE : COLOR_DE
	return ciede2000(a.lab, b.lab) <= limit
}

// Cluster opaque and translucent colours separately: #000 at 10% opacity is a
// different design decision from #000, even though their Lab distance is 0.
// `transparent` (alpha 0) is its own thing again -- it is the absence of a
// colour, never a near-miss of a faint tint -- so it is excluded outright.
const opaque = colorMembers.filter((m) => m.alpha >= 0.999)
const translucent = colorMembers.filter((m) => m.alpha < 0.999 && m.alpha > 0)

const colorClusters = cluster(opaque, sameColor)
	.concat(cluster(translucent, (a, b) => sameColor(a, b) && Math.abs(a.alpha - b.alpha) <= 0.04))
	.map((c) => {
		// Does an existing canonical token already sit inside this cluster?
		let best = null
		for (const t of canonicalColors) {
			if (c.seed.alpha < 0.999) break // only match opaque clusters to tokens
			if (!sameColor(c.seed, t)) continue
			const de = ciede2000(c.seed.lab, t.lab)
			if (!best || de < best.deltaE) best = { ...t, deltaE: +de.toFixed(2) }
		}
		return {
			kind: 'color',
			seedHex: c.seed.hex,
			alpha: +c.seed.alpha.toFixed(3),
			memberCount: c.members.length,
			totalUsage: totalUsage(c),
			existingToken: best,
			recommendation: best ? best.name : c.seed.authoredAs,
			recommendationKind: best ? 'existing-token' : 'highest-traffic-value',
			members: c.members
				.map((m) => ({
					authoredAs: m.authoredAs,
					hex: m.hex,
					alpha: +m.alpha.toFixed(3),
					usage: m.usage,
					props: m.props.slice(0, 6),
					deltaE: +ciede2000(c.seed.lab, m.lab).toFixed(2),
				}))
				.sort((a, b) => b.usage - a.usage),
		}
	})
	.filter((c) => c.memberCount > 1)
	.sort((a, b) => b.totalUsage - a.totalUsage)

// --- Font sizes ------------------------------------------------------------
// Normalise to a comparable number where the unit allows it. em/rem are kept
// in their own space from px: mixing them would need a cascade-aware base size
// per selector, which this static pass can't know.
function parseLength(v) {
	const m = String(v ?? '').trim().match(/^(-?[\d.]+)(px|rem|em|%|pt)?$/)
	if (!m) return null
	const n = parseFloat(m[1])
	if (!Number.isFinite(n)) return null
	const unit = m[2] ?? (n === 0 ? 'px' : null)
	if (!unit) return null
	if (unit === '%') return { n: n / 100, unit: 'em' } // 90% ≡ 0.9em for font-size
	if (unit === 'pt') return { n: (n * 4) / 3, unit: 'px' }
	// em and rem are NOT interchangeable: em is relative to the parent's
	// computed font-size, rem to the root's. They coincide only where nesting
	// happens to land back on the root size, so keep them in separate unit
	// buckets rather than treating "0.9rem" as a spelling of "0.9em" -- a merge
	// across the two can visibly resize text wherever that coincidence doesn't
	// hold (e.g. inside another 0.9em-scaled ancestor).
	return { n, unit }
}

function lengthClusters(members, relTol, absTol) {
	const parsed = members
		.map((m) => ({ ...m, len: parseLength(m.authoredAs) }))
		.filter((m) => m.len)
	const byUnit = new Map()
	for (const m of parsed) {
		if (!byUnit.has(m.len.unit)) byUnit.set(m.len.unit, [])
		byUnit.get(m.len.unit).push(m)
	}
	const out = []
	for (const [unit, group] of byUnit) {
		for (const c of cluster(group, (a, b) => {
			const d = Math.abs(a.len.n - b.len.n)
			return absTol != null ? d <= absTol : d <= Math.abs(a.len.n) * relTol
		})) {
			if (c.members.length < 2) continue
			out.push({
				unit,
				seed: c.seed.authoredAs,
				memberCount: c.members.length,
				totalUsage: totalUsage(c),
				recommendation: c.seed.authoredAs,
				recommendationKind: 'highest-traffic-value',
				members: c.members
					.map((m) => ({ authoredAs: m.authoredAs, usage: m.usage, props: m.props.slice(0, 6) }))
					.sort((a, b) => b.usage - a.usage),
			})
		}
	}
	return out.sort((a, b) => b.totalUsage - a.totalUsage)
}

const fontSizeClusters = lengthClusters(rawGroup(rawTokens.font_size), FONT_SIZE_REL, null)
const radiusClusters = lengthClusters(rawGroup(rawTokens.radius), null, RADIUS_PX)

// --- Box shadows -----------------------------------------------------------
// Compare the first layer's geometry + the alpha of its colour. Copy-paste
// drift almost always shows up as a nudged offset/blur or a tweaked opacity on
// an otherwise identical shadow, which this catches without a full parser.
function shadowSignature(v) {
	const s = String(v ?? '').trim()
	if (!s || s === 'none') return null
	const firstLayer = s.split(/,(?![^(]*\))/)[0]
	const nums = [...firstLayer.matchAll(/(-?[\d.]+)px/g)].map((m) => parseFloat(m[1]))
	if (nums.length < 2) return null
	const colorMatch = firstLayer.match(/rgba?\([^)]*\)|#[0-9a-f]{3,8}/i)
	const rgb = colorMatch ? parseColor(colorMatch[0]) : null
	// var(--np-shadow, ...) layers carry no literal colour of their own -- the
	// token is the colour, so two such layers only clash if the token differs.
	const varMatch = firstLayer.match(/var\((--[\w-]+)/)
	return {
		x: nums[0] ?? 0,
		y: nums[1] ?? 0,
		blur: nums[2] ?? 0,
		spread: nums[3] ?? 0,
		alpha: rgb ? rgb.a : 1,
		// Hue/saturation, not just opacity: rgba(16,139,185,0.4) and
		// rgba(0,0,0,0.4) share an alpha but are visibly different shadows, and
		// merging them would be a real colour change, not a dedup.
		r: rgb ? rgb.r : null,
		g: rgb ? rgb.g : null,
		b: rgb ? rgb.b : null,
		token: varMatch ? varMatch[1] : null,
		inset: /\binset\b/.test(firstLayer),
		layers: s.split(/,(?![^(]*\))/).length,
	}
}

// Two shadow colours are "the same decision" only if they resolve to (about)
// the same RGB -- alpha and geometry alone are not enough, and a shared
// var(--np-shadow) name is a stronger guarantee than any RGB comparison.
const RGB_TOLERANCE = 10
function shadowColorMatches(a, b) {
	if (a.token || b.token) return a.token === b.token
	if (a.r === null || b.r === null) return a.r === b.r
	return Math.abs(a.r - b.r) <= RGB_TOLERANCE &&
		Math.abs(a.g - b.g) <= RGB_TOLERANCE &&
		Math.abs(a.b - b.b) <= RGB_TOLERANCE
}

const shadowMembers = rawGroup(rawTokens.box_shadow)
	.map((m) => ({ ...m, sig: shadowSignature(m.authoredAs) }))
	.filter((m) => m.sig)

const shadowClusters = cluster(shadowMembers, (a, b) =>
	a.sig.inset === b.sig.inset &&
	a.sig.layers === b.sig.layers &&
	Math.abs(a.sig.x - b.sig.x) <= SHADOW_GEOM_PX &&
	Math.abs(a.sig.y - b.sig.y) <= SHADOW_GEOM_PX &&
	Math.abs(a.sig.blur - b.sig.blur) <= SHADOW_GEOM_PX * 2 &&
	Math.abs(a.sig.spread - b.sig.spread) <= SHADOW_GEOM_PX &&
	Math.abs(a.sig.alpha - b.sig.alpha) <= 0.06 &&
	shadowColorMatches(a.sig, b.sig)
)
	.filter((c) => c.members.length > 1)
	.map((c) => ({
		seed: c.seed.authoredAs,
		memberCount: c.members.length,
		totalUsage: totalUsage(c),
		recommendation: c.seed.authoredAs,
		recommendationKind: 'highest-traffic-value',
		members: c.members
			.map((m) => ({ authoredAs: m.authoredAs, usage: m.usage }))
			.sort((a, b) => b.usage - a.usage),
	}))
	.sort((a, b) => b.totalUsage - a.totalUsage)

// ---------------------------------------------------------------------------
const savings = (clusters) => ({
	clusters: clusters.length,
	valuesInvolved: clusters.reduce((n, c) => n + c.memberCount, 0),
	valuesRemovable: clusters.reduce((n, c) => n + c.memberCount - 1, 0),
	declarationsTouched: clusters.reduce((n, c) => n + c.totalUsage, 0),
})

const report = {
	generatedFrom: cssFiles.map((f) => relative(ROOT, f)),
	thresholds: {
		colorDeltaE2000: COLOR_DE,
		neutralDeltaE2000: NEUTRAL_DE,
		neutralChromaCutoff: NEUTRAL_CHROMA,
		fontSizeRelativeTolerance: FONT_SIZE_REL,
		radiusPxTolerance: RADIUS_PX,
		shadowGeometryPxTolerance: SHADOW_GEOM_PX,
	},
	totals: {
		colors: analysis.values.colors.totalUnique,
		fontSizes: Object.keys(rawTokens.font_size ?? {}).length,
		radii: Object.keys(rawTokens.radius ?? {}).length,
		boxShadows: Object.keys(rawTokens.box_shadow ?? {}).length,
	},
	savings: {
		colors: savings(colorClusters),
		fontSizes: savings(fontSizeClusters),
		radii: savings(radiusClusters),
		boxShadows: savings(shadowClusters),
	},
	colorClusters,
	fontSizeClusters,
	radiusClusters,
	shadowClusters,
}

mkdirSync(join(ROOT, 'docs/design'), { recursive: true })
writeFileSync(OUT, JSON.stringify(report, null, '\t') + '\n')

const line = (label, s, total) =>
	`${label.padEnd(12)} ${String(total).padStart(4)} unique -> ${String(total - s.valuesRemovable).padStart(4)} after merge  (${s.clusters} clusters, ${s.declarationsTouched} declarations)`

console.log('Wrote ' + relative(ROOT, OUT))
console.log(line('colors', report.savings.colors, report.totals.colors))
console.log(line('font-sizes', report.savings.fontSizes, report.totals.fontSizes))
console.log(line('radii', report.savings.radii, report.totals.radii))
console.log(line('shadows', report.savings.boxShadows, report.totals.boxShadows))
