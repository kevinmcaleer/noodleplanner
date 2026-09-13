import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Storybook for NoodlePlanner (#1197).
 *
 * ## Why this shape
 *
 * Two kinds of thing need previewing, and they sit at opposite ends of the
 * migration epic #1187 describes:
 *
 * - The **extracted Web Components** under `static/components/` (`<np-button>`,
 *   `<np-card>`, `<np-board>`, `<np-note>`) — real modules with their own
 *   colocated stories, styled in a shadow root that only `--np-*` custom
 *   properties cross.
 * - The **app's existing class names** — the 116 button classes, 119 badge
 *   classes and the rest — which have no component module to write a story
 *   for. Those are generated from `static/component-gallery.js`, the same
 *   module the /components page renders from. One spec, two consumers.
 *
 * The framework is `web-components-vite` because the first group needs a
 * renderer that understands custom elements; it renders the second group's
 * plain DOM nodes just as well, so one config serves both.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = join(HERE, '../packages/noodle-web/src/noodle_web/static');
const INDEX = join(HERE, '../packages/noodle-web/src/noodle_web/templates/index.html');

// The app's stylesheets, in the app's load order, read out of index.html --
// not listed here. A copied list drifts, and Storybook showing a component
// under a stale stylesheet order is worse than not showing it: order is what
// decides which of two equal-specificity rules wins, which is the exact bug
// epic #1187 exists to fix. `tests/test_storybook_stories.py` enforces this.
const stylesheets = [...readFileSync(INDEX, 'utf8').matchAll(/href="\/static\/([^"?]+\.css)/g)].map((m) => m[1]);

/** @type {import('@storybook/web-components-vite').StorybookConfig} */
const config = {
  stories: [
    '../packages/noodle-web/src/noodle_web/static/components/**/*.stories.@(js|ts)',
    '../.storybook/stories/*.stories.js',
  ],
  addons: ['@storybook/addon-a11y', '@storybook/addon-docs'],
  framework: {
    name: '@storybook/web-components-vite',
    options: {},
  },
  // Off by default: a build that phones home from CI is a surprise, and the
  // data is of no use to this project.
  core: { disableTelemetry: true },
  // Serves the app's static directory at /static, so the <link> tags below and
  // the gallery module's own asset paths resolve exactly as they do in the app.
  staticDirs: [{ from: STATIC_DIR, to: '/static' }],
  previewHead: (head) => `
		${head}
		<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
		<link href="https://fonts.googleapis.com/css2?family=Newsreader:wght@300;400;500&family=Instrument+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
		${stylesheets.map((s) => `<link rel="stylesheet" href="/static/${s}">`).join('\n\t\t')}
	`,
  async viteFinal(viteConfig) {
    viteConfig.resolve ??= {};
    viteConfig.resolve.alias = {
      ...viteConfig.resolve.alias,
      // The W3C Design Tokens JSON Penpot imports natively (Design ->
      // Tokens -> Import) — see docs/design/consolidation-and-handoff.md's
      // "Penpot" section. Aliased so story files don't need a `../`-chain
      // back to the repo root.
      '@design-tokens': fileURLToPath(new URL('../docs/design/tokens', import.meta.url)),
    };
    return viteConfig;
  },
};

export default config;
