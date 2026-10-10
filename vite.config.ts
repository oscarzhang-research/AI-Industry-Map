/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { parse } from 'yaml';

// Relative base + hash routing: the same build works on GitHub Pages, in a sub-folder preview and locally.
const config = parse(readFileSync(new URL('./site.config.yaml', import.meta.url), 'utf8')) as { site?: { experimental?: boolean } };

export default defineConfig({
  base: './',
  plugins: [
    react(),
    {
      name: 'robots-meta',
      transformIndexHtml: (html) => html.replace('%ROBOTS%', config.site?.experimental ? 'noindex, nofollow' : 'index, follow'),
    },
  ],
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1600,
    sourcemap: false,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
