import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset URLs: the same build works at https://crypto-tune.com/ and under the old
  // https://dmitrytut.github.io/crypto-tune/ path, so DNS cutover and deploy order do not matter.
  base: './',
  test: {
    include: ['src/**/__specs__/**/*.spec.ts'],
    environment: 'node',
  },
});
