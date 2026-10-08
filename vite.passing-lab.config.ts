import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist-passing-lab',
    rollupOptions: { input: 'passing-lab.html' },
  },
});
