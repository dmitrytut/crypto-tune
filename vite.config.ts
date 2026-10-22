import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/__specs__/**/*.spec.ts'],
    environment: 'node',
  },
});
