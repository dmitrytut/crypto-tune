import { defineConfig } from 'vitest/config';

export default defineConfig({
  // GitHub Pages serves the project site from https://dmitrytut.github.io/crypto-tune/.
  base: '/crypto-tune/',
  test: {
    include: ['src/**/__specs__/**/*.spec.ts'],
    environment: 'node',
  },
});
