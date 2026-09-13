// Which `outline: none` declarations remove a focus indicator without
// providing a replacement in the same rule?
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
const ROOT = '/home/user/noodleplanner/'
const S = ROOT + 'packages/noodle-web/src/noodle_web/static'
const index = readFileSync(ROOT + 'packages/noodle-web/src/noodle_web/templates/index.html', 'utf8')
const linked = [...index.matchAll(/href="\/static\/([^"?]+\.css)/g)].map((m) => m[1])

const onFocus = []
const notOnFocus = []
for (const rel of linked) {
	const text = readFileSync(join(S, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
	for (const m of text.matchAll(/(?:^|[{};])\s*([^{};@]+?)\s*\{([^{}]*)\}/g)) {
		const sel = m[1].trim()
		const body = m[2]
		if (!/outline\s*:\s*(none|0)\b/.test(body)) continue
		// Does the same rule give something back?
		const replacement = /box-shadow\s*:|border(-[a-z]+)?\s*:|background(-color)?\s*:|outline\s*:\s*(?!none|0)/.test(body)
		const entry = { file: rel, sel: sel.replace(/\s+/g, ' '), replacement }
		if (/:focus/.test(sel)) onFocus.push(entry)
		else notOnFocus.push(entry)
	}
}
console.log('`outline: none` in a :focus/:focus-visible rule:', onFocus.length)
console.log('  ...with no replacement indicator in the same rule:',
	onFocus.filter((e) => !e.replacement).length)
for (const e of onFocus.filter((e) => !e.replacement)) console.log('    ', e.file, e.sel)
console.log()
console.log('`outline: none` in a non-focus rule (resting state):', notOnFocus.length)
const byFile = new Map()
for (const e of notOnFocus) byFile.set(e.file, (byFile.get(e.file) ?? 0) + 1)
for (const [f, n] of [...byFile].sort((a, b) => b[1] - a[1])) console.log('    ', n, f)
