import { fileURLToPath } from 'node:url';

/** @type {import('@storybook/web-components-vite').StorybookConfig} */
const config = {
  stories: [
    '../packages/noodle-web/src/noodle_web/static/components/**/*.stories.@(js|ts)',
  ],
  addons: ['@storybook/addon-a11y', '@storybook/addon-docs'],
  framework: {
    name: '@storybook/web-components-vite',
    options: {},
  },
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
