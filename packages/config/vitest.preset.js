/** Shared Vitest options; spread into each package's vitest.config.ts `test` block. */
export const vitestPreset = {
  globals: false,
  passWithNoTests: true,
  include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'],
};
