import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev, /api is proxied to the Spring Boot backend so the browser sees a single origin.
// BACKEND_URL points it elsewhere (e.g. a second backend on another port); default http://localhost:8080.
// Vite runs this file in Node; declared here rather than adding @types/node for one variable.
declare const process: { env: Record<string, string | undefined> };
const backend = process.env.BACKEND_URL ?? 'http://localhost:8080';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': backend,
    },
  },
});
