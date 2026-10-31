import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Tests use their own database so they never touch demo data (CI passes DATABASE_URL).
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://fleet:fleet@localhost:5432/erp_test';

// SWC is needed so Nest's decorator metadata (constructor injection) works in tests.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['src/**/*.spec.ts'],
    testTimeout: 20000,
    fileParallelism: false,
    env: { DATABASE_URL },
    globalSetup: ['./src/test-global-setup.ts'],
  },
});
