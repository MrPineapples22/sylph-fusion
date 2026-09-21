import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: realpathSync(fileURLToPath(new URL('.', import.meta.url))),
  plugins: [tailwindcss()],
  build: { chunkSizeWarningLimit: 700 }
});
