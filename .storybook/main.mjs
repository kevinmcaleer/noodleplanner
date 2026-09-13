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
};

export default config;
