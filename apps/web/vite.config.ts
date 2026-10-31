import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const serverUrl = process.env.VITE_SERVER_URL ?? 'http://127.0.0.1:4000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    // In dev, the browser talks to the server through Vite so cookies stay same-origin.
    proxy: {
      '/api': {
        target: serverUrl,
        rewrite: (path) => path.replace(/^\/api/, ''),
        // The team live channel is a WebSocket.
        ws: true,
      },
    },
  },
});
