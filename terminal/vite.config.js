import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: realpathSync(fileURLToPath(new URL('.', import.meta.url))),
  plugins: [tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8793',
      '/live': 'http://127.0.0.1:8793',
      '/astra': 'http://127.0.0.1:8793',
      '/events': 'http://127.0.0.1:8793',
    }
  },
  build: { chunkSizeWarningLimit: 700 }
});
