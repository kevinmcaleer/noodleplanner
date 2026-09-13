#!/usr/bin/env node
/**
 * Delete `[data-theme="dark"]` declarations that repeat the base rule (#1194).
 *
 * The app themes itself with 480 per-component `[data-theme="dark"] .x { … }`
 * overrides. 37 of those declarations now say exactly what the plain `.x` rule
 * says — same property, same value — so the override wins on specificity and
 * paints the same pixel. 26 were already like that; the other 11 became so when
 * the base rules adopted the tokens the overrides were already using.
 *
 * Removing one is a no-op by construction: the base declaration is what applies
 * instead, and it is byte-identical.
 *
 * Only whole declarations are removed, and a rule left with nothing goes too.
 * Where the override sets other properties as well, those stay.
 *
 * Usage:
 *   node scripts/drop-redundant-dark-overrides.mjs --dry-run
 *   node scripts/drop-redundant-dark-overrides.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const STATIC_DIR = join(ROOT, 'packages/noodle-web/src/noodle_web/static')
const INDEX = join(ROOT, 'packages/noodle-web/src/noodle_web/templates/index.html')

const dryRun = process.argv.includes('--dry-run')
const linked = [...readFileSync(INDEX, 'utf8').matchAll(/href="\/static\/([^"?]+\.css)/g)].map((m) => m[1])
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '')
const tidy = (v) => v.trim().replace(/\s+/g, ' ').toLowerCase()
const DARK_PREFIX = /^\[data-theme=["']?dark["']?\]\s+/

// --- Pass 1: every non-dark declaration, keyed selector|property.
const base = new Map()
for (const rel of linked) {
	const css = stripComments(readFileSync(join(STATIC_DIR, rel), 'utf8'))
	for (const m of css.matchAll(/(^|[{};])\s*([^{};@]+?)\s*\{([^{}]*)\}/g)) {
		const prelude = m[2].trim()
		if (!prelude || prelude.startsWith('@')) continue
		for (const sel of prelude.split(',').map((x) => x.trim()).filter(Boolean)) {
			if (DARK_PREFIX.test(sel)) continue
			for (const decl of m[3].split(';')) {
				const i = decl.indexOf(':')
				if (i === -1) continue
				const prop = decl.slice(0, i).trim()
				if (prop.startsWith('--') || /[{}]/.test(prop)) continue
				base.set(`${sel}|${prop}`, tidy(decl.slice(i + 1)))
			}
		}
	}
}

// --- Pass 2: drop the dark declarations that duplicate them.
let removed = 0
let rulesEmptied = 0
const perFile = []

for (const rel of linked) {
	const path = join(STATIC_DIR, rel)
	const original = readFileSync(path, 'utf8')
	let count = 0

	const out = original.replace(/(^|[{};])(\s*)([^{};@]+?)(\s*)\{([^{}]*)\}/g,
		(whole, lead, ws1, prelude, ws2, body) => {
			const selectors = prelude.split(',').map((x) => x.trim()).filter(Boolean)
			// Only a rule whose every selector is dark-scoped: a grouped rule
			// mixing dark and non-dark selectors would need splitting, and there
			// are none worth the machinery.
			if (!selectors.length || !selectors.every((s) => DARK_PREFIX.test(s))) return whole

			const plain = selectors.map((s) => s.replace(DARK_PREFIX, ''))
			const kept = []
			for (const decl of body.split(';')) {
				if (!decl.trim()) continue
				const i = decl.indexOf(':')
				if (i === -1) { kept.push(decl); continue }
				const prop = decl.slice(0, i).trim()
				const value = tidy(decl.slice(i + 1))
				// Redundant only if it duplicates the base for *every* selector
				// this rule covers.
				const duplicate = plain.every((s) => base.get(`${s}|${prop}`) === value)
				if (duplicate && !prop.startsWith('--')) { count++; continue }
				kept.push(decl)
			}
			if (!count) return whole
			if (!kept.some((d) => d.trim())) {
				rulesEmptied++
				return lead // the whole rule was redundant
			}
			return `${lead}${ws1}${prelude}${ws2}{${kept.join(';')};\n}`
		})

	if (!count) continue
	if (!dryRun) writeFileSync(path, out)
	perFile.push([rel, count])
	removed += count
}

for (const [file, n] of perFile.sort((a, b) => b[1] - a[1])) console.log(String(n).padStart(5), file)
console.log(`\n${removed} redundant dark declaration(s) ${dryRun ? 'would be' : ''} removed; ${rulesEmptied} rule(s) emptied entirely`)
