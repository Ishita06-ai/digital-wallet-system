const { defineConfig } = require('./node_modules/.pnpm/vitest@3.2.7_lightningcss@1.33.0/node_modules/vitest/dist/config.cjs');

module.exports = defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: './test/setup.js',
    testTimeout: 30000,
    hookTimeout: 120000
  }
});