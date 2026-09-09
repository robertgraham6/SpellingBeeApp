import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks: {
          // Split large libraries into separate chunks so the main
          // app bundle stays small and they can be cached independently.
          'exceljs':  ['exceljs'],
          'supabase': ['@supabase/supabase-js'],
          'router':   ['react-router-dom'],
        },
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true,
  },
});
