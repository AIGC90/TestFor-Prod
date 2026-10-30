import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const TRACCAR = process.env.TRACCAR_URL ?? 'http://localhost:8082';
const ERP = process.env.ERP_URL ?? 'http://localhost:3000';

// The browser talks to one origin: /api goes to Traccar (incl. the live WebSocket),
// /erp goes to our API. Production uses the same layout behind nginx.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': { target: TRACCAR, ws: true, changeOrigin: true },
      '/erp': { target: ERP, changeOrigin: true },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
  },
});
