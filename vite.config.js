import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// When building for GitHub Pages, use the repo name as the base path.
// Set VITE_BASE_URL=/Rawstream/ in the CI environment.
const base = process.env.VITE_BASE_URL || './';

export default defineConfig({
  plugins: [react()],
  base,
  server: {
    port: 3000,
    open: true
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
