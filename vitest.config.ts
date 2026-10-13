import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary'],
      include: ['src/**/*.ts'],
      thresholds: {
        lines: 85,
        statements: 80,
        functions: 90,
        branches: 65,
      },
    },
  },
})
