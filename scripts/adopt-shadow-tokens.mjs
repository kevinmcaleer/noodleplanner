#!/usr/bin/env node
/**
 * Map neutral shadow colours onto the shadow tokens (#1194).
 *
 * `box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1)` appears 37 times, `0.15` 14
 * times, and so on down a tail of one-offs. --np-shadow and
 * --np-shadow-strong already hold exactly those two values in the light
 * theme, so the substitutions below are the identity there.
 *
 * In dark they are not, and that is the point. --np-shadow is 0.3 in dark and
 * --np-shadow-strong 0.5, because a 10%-black shadow on a #201E1A surface is
 * invisible -- the elevation simply disappears. Every one of these literals is
 * a card, menu or dialog that has been flat in dark mode since it was written.
 *
 * Only the exact light-theme values are mapped. The rest of the tail (0.08,
 * 0.12, 0.18, 0.2, 0.25 ...) is left alone: rounding those to the nearest
 * token would change the light theme to buy the same dark-mode fix, and that
 * is a different trade to offer than "no visible change in light, elevation
 * restored in dark".
 *
 * Tinted glows -- rgba(16,139,185,.4) and friends -- are not shadows in this
 * sense. They are focus and state affordances in the identity blue, they do
 * not want a neutral token, and they are skipped.
 *
 * Usage:
 *   node scripts/adopt-shadow-tokens.mjs --dry-run
 *   node scripts/adopt-shadow-tokens.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const STATIC_DIR = join(ROOT, 'packages/noodle-web/src/noodle_web/static')
const INDEX = join(ROOT, 'packages/noodle-web/src/noodle_web/templates/index.html')

const dryRun = process.argv.includes('--dry-run')
const linked = [...readFileSync(INDEX, 'utf8').matchAll(/href="\/static\/([^"?]+\.css)/g)].map((m) => m[1])
const SKIP_FILES = new Set(['visual-system.css'])

// Only the two the light theme already resolves to, so light is byte-exact.
const MAP = new Map([
	[0.1, '--np-shadow'],
	[0.15, '--np-shadow-strong'],
])

let total = 0
const perFile = []
const moves = new Map()

for (const rel of linked) {
	if (SKIP_FILES.has(rel)) continue
	const path = join(STATIC_DIR, rel)
	const original = readFileSync(path, 'utf8')
	let count = 0

	const out = original.replace(/(?<=^|[{};])(\s*)([^{};@]+?)(\s*)\{([^{}]*)\}/g,
		(whole, ws1, selector, ws2, body) => {
			const sel = selector.trim()
			if (!sel || sel.startsWith('@')) return whole
			if (/\[data-theme=["']?dark["']?\]/.test(sel)) return whole

			const nextBody = body.replace(/([a-zA-Z-]+)(\s*:\s*)([^;]+)/g, (decl, prop, sep, value) => {
				if (!/^(box-shadow|text-shadow)$/.test(prop.trim().toLowerCase())) return decl
				const nextValue = value.replace(/rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*([0-9.]+)\s*\)/gi, (lit, a) => {
					const token = MAP.get(parseFloat(a))
					if (!token) return lit
					count++
					const key = `${lit.replace(/\s+/g, '')} -> ${token}`
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
console.log('\nmappings:')
for (const [move, n] of [...moves].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${move}`)
console.log(`\n${total} shadow colour(s) ${dryRun ? 'would be' : ''} mapped across ${perFile.length} file(s)`)
