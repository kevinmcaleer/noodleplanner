#!/usr/bin/env node
/**
 * Apply band 2's mechanical merges (#1194): collapse near-duplicate spellings
 * of the same shadow, radius, font-size or colour onto one value each, per
 * the clusters in `docs/design/token-consolidation.json`
 * (`npm run design:consolidation` regenerates it).
 *
 * "No visual change by construction" holds only for the clusters below --
 * two bugs in the clustering itself were fixed first because they would have
 * broken that guarantee:
 *
 *   - box-shadow clustering compared geometry and alpha but not colour, so it
 *     was grouping `rgba(16, 139, 185, 0.4)` (a brand-blue tint) with
 *     `rgba(0, 0, 0, 0.4)` (black) as "the same shadow". Fixed to require the
 *     RGB (or the `var(--np-shadow...)` name) to match too.
 *   - font-size clustering treated `em` and `rem` as the same unit ("same
 *     numeric scale, different base"). They are not: `em` is relative to the
 *     *parent's* computed font-size, `rem` to the root's, and they coincide
 *     only where nesting happens to land back on the root size. Fixed to keep
 *     them in separate unit buckets.
 *
 * ## What this script does and does not touch
 *
 * Only `recommendationKind: "highest-traffic-value"` colour clusters are
 * applied -- a literal spelling replacing another literal spelling of a
 * perceptually identical colour (ΔE2000 within the consolidation script's
 * threshold), which is safe under any property or theme. The
 * `"existing-token"` colour clusters are skipped: replacing a literal with a
 * *token* carries the light/dark inversion hazard `adopt-neutral-colours.mjs`
 * was built to reason about (a token's dark value can differ from what the
 * literal was chosen for), and that classification needs the property-role
 * check that script already does, not a blind text substitution here.
 *
 * Shadow and colour literals are routed by property so the same rgba() text
 * inside a `box-shadow` is only ever touched by the shadow merge, never
 * double-processed by the colour merge too.
 *
 * Usage:
 *   node scripts/consolidate-tokens.mjs --dry-run
 *   node scripts/consolidate-tokens.mjs
 *
 * Verify with a before/after capture -- see scripts/compare_screens.py.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const STATIC_DIR = join(ROOT, 'packages/noodle-web/src/noodle_web/static')
const INDEX = join(ROOT, 'packages/noodle-web/src/noodle_web/templates/index.html')
const CONSOLIDATION = join(ROOT, 'docs/design/token-consolidation.json')

const dryRun = process.argv.includes('--dry-run')
const linked = [...readFileSync(INDEX, 'utf8').matchAll(/href="\/static\/([^"?]+\.css)/g)].map((m) => m[1])

// The canonical layer declares the tokens; base.css carries the chart data
// palette. Neither is a merge target.
const SKIP_FILES = new Set(['visual-system.css', 'base.css'])

const data = JSON.parse(readFileSync(CONSOLIDATION, 'utf8'))

function literalMap(clusters, { onlyKind } = {}) {
	const map = new Map()
	for (const c of clusters) {
		if (onlyKind && c.recommendationKind !== onlyKind) continue
		for (const m of c.members) {
			if (m.authoredAs === c.recommendation) continue
			map.set(m.authoredAs, c.recommendation)
		}
	}
	return map
}

const shadowMap = literalMap(data.shadowClusters)
const radiusMap = literalMap(data.radiusClusters)
const fontSizeMap = literalMap(data.fontSizeClusters)
const colorMap = literalMap(data.colorClusters, { onlyKind: 'highest-traffic-value' })

const RADIUS_PROP = /^(border(-top-left|-top-right|-bottom-left|-bottom-right)?-radius)$/
const FONT_SIZE_PROP = /^font-size$/
const SHADOW_PROP = /^box-shadow$/

// Matches the same literal shapes the consolidation script clusters:
// 3/4/6/8-digit hex and rgba()/rgb(). Word-bounded so `#f8f9fa` cannot
// half-match inside a longer token, and skipped entirely when the value is
// already indirected via var()/calc() (a fallback's literal is load-bearing,
// not a spelling to normalise).
const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g

const counts = { shadow: 0, radius: 0, fontSize: 0, color: 0 }
const perFile = []

for (const rel of linked) {
	if (SKIP_FILES.has(rel)) continue
	const path = join(STATIC_DIR, rel)
	const original = readFileSync(path, 'utf8')
	let fileCount = 0

	const out = original.replace(/([a-zA-Z-]+)(\s*:\s*)([^;{}]+)(;)/g, (whole, prop, sep, value, end) => {
		const p = prop.trim()
		const trimmed = value.trim()

		if (SHADOW_PROP.test(p)) {
			const hit = shadowMap.get(trimmed)
			if (!hit) return whole
			counts.shadow++
			fileCount++
			return `${prop}${sep}${hit}${end}`
		}

		if (RADIUS_PROP.test(p)) {
			if (/var\(|calc\(|\//.test(trimmed)) return whole // elliptical or indirected: leave it
			const parts = trimmed.split(/\s+/)
			let changed = false
			const next = parts.map((part) => {
				const hit = radiusMap.get(part)
				if (!hit) return part
				changed = true
				return hit
			})
			if (!changed) return whole
			counts.radius += parts.filter((part) => radiusMap.has(part)).length
			fileCount++
			return `${prop}${sep}${next.join(' ')}${end}`
		}

		if (FONT_SIZE_PROP.test(p)) {
			const hasImportant = /!\s*important$/.test(trimmed)
			const bare = hasImportant ? trimmed.replace(/!\s*important$/, '').trim() : trimmed
			const hit = fontSizeMap.get(bare)
			if (!hit) return whole
			counts.fontSize++
			fileCount++
			return `${prop}${sep}${hit}${hasImportant ? ' !important' : ''}${end}`
		}

		if (SHADOW_PROP.test(p) || /var\(/.test(value)) return whole

		let localCount = 0
		const nextValue = value.replace(COLOR_LITERAL, (lit) => {
			const hit = colorMap.get(lit)
			if (!hit) return lit
			localCount++
			return hit
		})
		if (!localCount) return whole
		counts.color += localCount
		fileCount += localCount
		return `${prop}${sep}${nextValue}${end}`
	})

	if (!fileCount) continue
	if (!dryRun) writeFileSync(path, out)
	perFile.push([rel, fileCount])
}

for (const [file, n] of perFile.sort((a, b) => b[1] - a[1])) console.log(String(n).padStart(5), file)
console.log(`\nshadow ${counts.shadow}  radius ${counts.radius}  font-size ${counts.fontSize}  color ${counts.color}`)
const total = counts.shadow + counts.radius + counts.fontSize + counts.color
console.log(`${total} declaration(s) ${dryRun ? 'would be' : ''} merged across ${perFile.length} file(s)`)
