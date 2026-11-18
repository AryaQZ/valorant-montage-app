import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { outDir: resolve(__dirname, 'dist-electron/main'), rollupOptions: { input: { index: resolve(__dirname, 'electron/main.ts') } } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { outDir: resolve(__dirname, 'dist-electron/preload'), rollupOptions: {
      input: { index: resolve(__dirname, 'electron/preload.ts') },
      output: { format: 'cjs', entryFileNames: 'index.cjs' },
    } },
  },
  renderer: {
    root: resolve(__dirname, 'renderer'),
    plugins: [react()],
    server: { port: 5173, strictPort: true },
    build: { outDir: resolve(__dirname, 'dist-electron/renderer'), emptyOutDir: true,
      rollupOptions: { input: resolve(__dirname, 'renderer/index.html') } },
  },
});
