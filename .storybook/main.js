/**
 * Storybook for NoodlePlanner (#1197).
 *
 * ## Why this shape
 *
 * The app has no bundler and no component modules -- the UI is one large
 * index.html plus vanilla JS that mutates it by id. There is no `Button` to
 * write a story for, and extracting one is a large architectural change that
 * should be justified on its own merits rather than adopted as a side effect
 * of a token cleanup.
 *
 * So Storybook is pointed at what does exist: the app's real class names
 * against the app's real stylesheets, rendered as HTML. `@storybook/html-vite`
 * needs no framework and no build step in the app itself. Nothing here changes
 * how NoodlePlanner is served.
 *
 * The stories are generated from `static/component-gallery.js`, the same
 * module the /components page renders from. One spec, two consumers.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const STATIC_DIR = join(HERE, '../packages/noodle-web/src/noodle_web/static')
const INDEX = join(HERE, '../packages/noodle-web/src/noodle_web/templates/index.html')

// The app's stylesheets, in the app's load order, read out of index.html --
// not listed here. A copied list drifts, and Storybook showing a component
// under a stale stylesheet order is worse than not showing it: order is what
// decides which of two equal-specificity rules wins, which is the exact bug
// epic #1187 exists to fix.
const stylesheets = [...readFileSync(INDEX, 'utf8').matchAll(/href="\/static\/([^"?]+\.css)/g)].map((m) => m[1])

const config = {
	framework: { name: '@storybook/html-vite', options: {} },
	// Off by default: a build that phones home from CI is a surprise, and the
	// data is of no use to this project.
	core: { disableTelemetry: true },
	stories: ['../.storybook/stories/*.stories.js'],
	// Serves the app's static directory at /static, so the <link> tags below
	// and the gallery module's own path both resolve exactly as they do in the
	// app.
	staticDirs: [{ from: STATIC_DIR, to: '/static' }],
	previewHead: (head) => `
		${head}
		<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
		<link href="https://fonts.googleapis.com/css2?family=Newsreader:wght@300;400;500&family=Instrument+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
		${stylesheets.map((s) => `<link rel="stylesheet" href="/static/${s}">`).join('\n\t\t')}
	`,
}

export default config
