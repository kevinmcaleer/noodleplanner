#!/usr/bin/env node
// Pull the design tokens out of Penpot into docs/design/tokens/, and regenerate
// the CSS from them (#1319, epic #1317).
//
// Before this, a design change reached the repository only if someone
// remembered to export the token sets from Penpot (Tokens -> Export) and commit
// the files. This makes it one command:
//
//     PENPOT_ACCESS_TOKEN=... npm run design:pull   # fetch over Penpot's RPC API
//     npm run design:pull -- --from dump.json        # or from a file, see below
//     npm run design:pull -- --check                 # say what would change, write nothing
//
// It writes docs/design/tokens/, runs the generator (scripts/design-tokens.mjs)
// and prints what changed, token by token. It does not commit: the `Design
// tokens` workflow (.github/workflows/design-tokens.yml) runs it and opens a
// pull request when the files changed, and a pull with no design change leaves
// the tree clean, so it opens none. docs/design/token-pull.md is the write-up
// of how Penpot was read and why this way.
//
// ## Where the tokens come from
//
// - **Penpot's RPC API** (the default). `get-file` on Penpot 2.x returns the
//   file's token library as `data.tokensLib`, already in the DTCG shape Penpot's
//   own single-file export uses: one object keyed by set name, plus `$themes`
//   and `$metadata`. Needs PENPOT_ACCESS_TOKEN (a personal access token, Your
//   account -> Access tokens), and takes PENPOT_URL and PENPOT_FILE_ID, which
//   default to the NoodlePlanner design file.
// - **`--from <file>`**, any of:
//   - a saved `get-file` response, or Penpot's single-file token export;
//   - a dump from the Penpot MCP plugin (PLUGIN_DUMP below), which is how a
//     Claude session with the plugin connected pulls without an access token.
//
// A manual export over docs/design/tokens/ (multiple files) still works and
// needs none of this; run `npm run design:tokens` after it as before.
//
// ## What is kept from the committed files
//
// Penpot's JSON is the source for every token, but three things in it are not
// design, and taking them from Penpot would put noise in every pull request:
//
// - **Order.** Tokens keep the order they have in the committed file, because
//   the generator writes the CSS in file order, and Penpot does not return a
//   set's tokens in the order they were exported. New tokens go at the end of
//   their set, in Penpot's order.
// - **Theme ids.** A theme's `id` is Penpot's external id, which changes when
//   the file is duplicated or re-imported. A theme that matches a committed one
//   by group and name keeps the committed id.
// - **`$metadata.activeThemes` / `activeSets`.** Which theme the designer last
//   had switched on in the editor. The generator reads `$themes.json`, not these.

import { existsSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { TOKENS_DIR, STYLESHEET, problems, generate, splitStylesheet, flattenSet } from './design-tokens.mjs'

export const DEFAULT_PENPOT_URL = 'https://penpot.kevsrobots.com'
// The NoodlePlanner design file (docs/design/screen-audit-board.md).
export const DEFAULT_FILE_ID = 'f19af5a3-31e2-810f-8008-aed06226922e'

// Run this in the Penpot MCP plugin (`execute_code`) with the design file open,
// save what it returns as a .json file, and pass it to --from. It reads
// `token.value`, not `resolvedValue`: the resolved value drops the alpha of a
// translucent colour and resolves against the active theme only.
export const PLUGIN_DUMP = `const t = penpot.library.local.tokens;
return JSON.stringify({
  source: 'penpot-plugin',
  sets: t.sets.map((s) => ({ name: s.name, tokens: s.tokens.map((k) => ({ name: k.name, type: k.type, value: k.value, description: k.description || '' })) })),
  themes: t.themes.map((th) => ({ group: th.group, name: th.name, description: th.description ?? '', isSource: th.isSource ?? false, id: th['external-id'] ?? '', sets: th.activeSets.map((s) => s.name) })),
});`

// ---------------------------------------------------------------------------
// Reading Penpot's shapes into one: { sets: {name: tree}, order, themes }

// Penpot keeps an internal theme for tokens applied with no theme active. Its
// own export leaves it out, and so does this.
const HIDDEN_THEME = '__PENPOT__HIDDEN__TOKEN__THEME__'

// A dotted name as a nested tree, the way Penpot's export writes it.
function nest(tokens) {
	const tree = {}
	for (const t of tokens) {
		const parts = t.name.split('.')
		let node = tree
		for (const part of parts.slice(0, -1)) node = node[part] ??= {}
		const leaf = { $value: t.value, $type: t.type }
		if (t.description) leaf.$description = t.description
		node[parts.at(-1)] = leaf
	}
	return tree
}

// The plugin reports shadow layers with the DTCG keys already, and a
// `number` token the same as the export does, so its values need no mapping.
function fromPlugin(dump) {
	const sets = {}
	for (const s of dump.sets) sets[s.name] = nest(s.tokens)
	const themes = dump.themes.filter((th) => !String(th.name).startsWith(HIDDEN_THEME)).map((th) => ({
		name: th.name,
		group: th.group,
		description: th.description ?? '',
		isSource: Boolean(th.isSource),
		id: th.id ?? th.externalId ?? '',
		selectedTokenSets: Object.fromEntries(th.sets.map((s) => [s, 'enabled'])),
	}))
	return { sets, order: dump.sets.map((s) => s.name), themes }
}

// Penpot's single-file DTCG export, which is also what get-file returns as
// data.tokensLib.
function fromSingleFile(lib) {
	const order = lib.$metadata?.tokenSetOrder ?? Object.keys(lib).filter((k) => !k.startsWith('$'))
	const sets = {}
	for (const name of order) sets[name] = lib[name] ?? {}
	return { sets, order, themes: (lib.$themes ?? []).filter((th) => !String(th.name).startsWith(HIDDEN_THEME)) }
}

// Any of the shapes --from accepts, or a get-file response.
export function readPenpot(json) {
	// The plugin's execute_code returns the dump as a JSON string.
	if (typeof json === 'string') json = JSON.parse(json)
	if (json?.source === 'penpot-plugin') return fromPlugin(json)
	const lib = json?.data?.tokensLib ?? json?.tokensLib ?? json
	if (lib && typeof lib === 'object' && (lib.$metadata || lib.$themes)) return fromSingleFile(lib)
	if (json?.data && !json.data.tokensLib) throw new Error('the Penpot file has no design tokens (data.tokensLib is empty)')
	throw new Error('not a Penpot token library: expected a get-file response, a single-file token export or a plugin dump')
}

// ---------------------------------------------------------------------------
// Writing it out as the multi-file export, keeping what the committed files say

function readJson(path) {
	return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null
}

// `next`'s keys in `prev`'s order, with new ones after. Recurses into groups,
// not into a token's own fields: those stay as Penpot wrote them.
export function keepOrder(prev, next) {
	if (!prev || typeof prev !== 'object' || Array.isArray(prev) || '$value' in next) return next
	const out = {}
	for (const key of Object.keys(prev)) if (key in next) out[key] = keepOrder(prev[key], next[key])
	for (const key of Object.keys(next)) if (!(key in out)) out[key] = next[key]
	return out
}

const THEME_KEYS = ['name', 'group', 'description', 'isSource', 'id', 'selectedTokenSets']

function themeFiles(themes, committed) {
	const byName = new Map((committed ?? []).map((th) => [`${th.group}/${th.name}`, th]))
	return themes.map((th) => {
		const prev = byName.get(`${th.group}/${th.name}`)
		const merged = { ...th, id: prev?.id ?? th.id ?? '', description: th.description ?? '', isSource: Boolean(th.isSource) }
		return Object.fromEntries(THEME_KEYS.map((k) => [k, merged[k]]))
	})
}

// The files docs/design/tokens/ should hold, as {filename: text}.
export function exportFiles(penpot, dir = TOKENS_DIR) {
	const files = {}
	const text = (obj) => `${JSON.stringify(obj, null, 2)}\n`
	for (const name of penpot.order) files[`${name}.json`] = text(keepOrder(readJson(join(dir, `${name}.json`)), penpot.sets[name]))
	files['$themes.json'] = text(themeFiles(penpot.themes, readJson(join(dir, '$themes.json'))))
	const meta = readJson(join(dir, '$metadata.json')) ?? {}
	files['$metadata.json'] = text({
		tokenSetOrder: penpot.order,
		activeThemes: meta.activeThemes ?? [],
		activeSets: meta.activeSets ?? [],
	})
	return files
}

// Token by token, what `files` changes about `dir`, as sentences.
export function describeChanges(files, dir = TOKENS_DIR) {
	const out = []
	const tokens = (tree) => new Map(flattenSet(tree ?? {}).map((t) => [t.path, t]))
	for (const [file, text] of Object.entries(files)) {
		const path = join(dir, file)
		const before = existsSync(path) ? readFileSync(path, 'utf8') : null
		if (before === text) continue
		if (file.startsWith('$')) { out.push(`${file} changed`); continue }
		const set = file.replace(/\.json$/, '')
		const prev = tokens(before ? JSON.parse(before) : {})
		const next = tokens(JSON.parse(text))
		const changes = []
		for (const [p, t] of next) {
			const was = prev.get(p)
			if (!was) changes.push(`added ${p}`)
			else if (JSON.stringify([was.type, was.value]) !== JSON.stringify([t.type, t.value])) changes.push(`changed ${p}: ${JSON.stringify(was.value)} -> ${JSON.stringify(t.value)}`)
			else if (was.description !== t.description) changes.push(`changed the description of ${p}`)
		}
		for (const p of prev.keys()) if (!next.has(p)) changes.push(`REMOVED ${p}`)
		if (!before) out.push(`${file} is new`)
		out.push(...changes.map((c) => `${set}: ${c}`))
		if (before && !changes.length) out.push(`${file}: formatting or order only`)
	}
	// A committed set Penpot no longer has.
	const known = new Set(Object.keys(files))
	if (existsSync(dir)) {
		for (const f of readdirSync(dir)) if (f.endsWith('.json') && !known.has(f)) out.push(`${f}: REMOVED (the set is gone from Penpot)`)
	}
	return out
}

// ---------------------------------------------------------------------------
// Fetching

export async function fetchFromPenpot({ url = DEFAULT_PENPOT_URL, fileId = DEFAULT_FILE_ID, token, fetchImpl = fetch } = {}) {
	if (!token) throw new Error('PENPOT_ACCESS_TOKEN is not set: create one in Penpot (Your account -> Access tokens), or pass --from <file>')
	const res = await fetchImpl(`${url.replace(/\/$/, '')}/api/rpc/command/get-file?id=${encodeURIComponent(fileId)}`, {
		headers: { accept: 'application/json', authorization: `Token ${token}` },
	})
	const body = await res.text()
	if (!res.ok) throw new Error(`Penpot get-file answered ${res.status}: ${body.slice(0, 300)}`)
	return JSON.parse(body)
}

// ---------------------------------------------------------------------------

function option(argv, flag, fallback) {
	const i = argv.indexOf(flag)
	return i === -1 ? fallback : argv[i + 1]
}

export async function pull({ source, dir = TOKENS_DIR, stylesheet = STYLESHEET, write = true, log = console.log }) {
	const penpot = readPenpot(source)
	const files = exportFiles(penpot, dir)
	const changes = describeChanges(files, dir)
	if (!changes.length) {
		log('design pull: docs/design/tokens/ already matches Penpot')
		return { changed: false, changes }
	}
	log(`design pull: ${changes.length} change(s) from Penpot\n  ${changes.join('\n  ')}`)
	if (!write) return { changed: true, changes }

	for (const [file, text] of Object.entries(files)) writeFileSync(join(dir, file), text)
	for (const f of readdirSync(dir)) if (f.endsWith('.json') && !(f in files)) unlinkSync(join(dir, f))
	const found = problems(dir)
	if (found.length) throw new Error(`the pulled tokens have ${found.length} problem(s):\n  ${found.join('\n  ')}`)
	const css = readFileSync(stylesheet, 'utf8')
	const { before, after } = splitStylesheet(css)
	writeFileSync(stylesheet, before + generate(dir) + after)
	log('design pull: wrote docs/design/tokens/ and regenerated visual-system.css')
	return { changed: true, changes }
}

async function main(argv) {
	const from = option(argv, '--from', null)
	const dir = option(argv, '--tokens', TOKENS_DIR)
	const stylesheet = option(argv, '--stylesheet', STYLESHEET)
	const summary = option(argv, '--summary', null)
	const check = argv.includes('--check')
	if (argv.includes('--plugin-snippet')) {
		console.log(PLUGIN_DUMP)
		return 0
	}
	try {
		const source = from
			? JSON.parse(readFileSync(from, 'utf8'))
			: await fetchFromPenpot({ url: process.env.PENPOT_URL || undefined, fileId: process.env.PENPOT_FILE_ID || undefined, token: process.env.PENPOT_ACCESS_TOKEN })
		const { changed, changes } = await pull({ source, dir, stylesheet, write: !check })
		// For the workflow's pull request body.
		if (summary) {
			writeFileSync(summary, [
				'Tokens pulled from the NoodlePlanner design file in Penpot by `npm run design:pull` (#1319).',
				'',
				...changes.map((c) => `- ${c}`),
				'',
				'Check any **REMOVED** line before merging: it deletes a CSS custom property the app may still use.',
				'',
			].join('\n'))
		}
		return check && changed ? 1 : 0
	} catch (err) {
		console.error(`design pull: ${err.message}`)
		return 2
	}
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exit(await main(process.argv.slice(2)))
