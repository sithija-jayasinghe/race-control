import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const serverUrl = process.env.VITE_SERVER_URL ?? 'http://127.0.0.1:4000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // In dev, the browser talks to the server through Vite so cookies stay same-origin.
    proxy: {
      '/api': {
        target: serverUrl,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
